// The browser-side fan-out behind the homepage's IP-routing table.
//
// One row = one question, and there are two questions a row can answer. "When
// this browser reaches *this* service, which address does the service see?" —
// Cloudflare's `/cdn-cgi/trace` answers that in plain text with a wildcard CORS
// header, so the request goes from the visitor's own machine along the exact path
// their network routes it, and this server carries none of the traffic. And "can
// this browser reach it at all, and how long does the path take?" — a `no-cors`
// timed request, whose opaque answer is fine because only the completion and the
// duration are being read.
//
// A row tries the first and falls back to the second, because most national
// services are not fronted by Cloudflare and never will be. A row therefore ends
// in one of four real states, and they mean different things: an egress address, a
// measured round trip, a destination that refused every connection, and a row
// nothing could be learned from. Collapsing the third into the fourth would throw
// away the single most useful finding for someone in a censored network — that the
// site did not answer *them* — so the state travels on the row and the table shows
// which of the four it is.
//
// Which rows exist is not decided here. The signals this file reads about the
// machine are posted to `/api/split` and the answer comes back as a work order;
// the judgement about where the visitor is sitting is made on the server and never
// shipped to the browser, for the reasons in `api/split.js`. What stays here is
// only the part that cannot live anywhere else: reading a browser, and timing a
// connection from inside it.
//
// Which address the visitor *is* is decided here — but by `utils/egress-attribution.js`
// over the rows this file already measured, not by anything kept. Nothing is stored.

import { ref, shallowRef, computed, watch, onScopeDispose } from 'vue';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { onAppEvent } from '../utils/app-events.js';
import { probeTone } from '../utils/latency-probes.js';
import { classifyEgress } from '../utils/egress-attribution.js';
import {
    readClock, readLanguages, readKeyboard, readOperatingSystem,
    geoSliceFromCards, networkSlice,
} from '../utils/split-signals.js';

const TRACE_PATH = '/cdn-cgi/trace';
// Six seconds. A Cloudflare edge answers a trace in well under one, so anything
// still silent at six is not coming, and the old ten held up the whole wave on
// destinations that were simply gone.
const TRACE_TIMEOUT_MS = 6000;
const PING_TIMEOUT_MS = 5000;
// Eight at a time. The whole plan at once saturates a home uplink and starts
// timing out on exactly the slow paths the table exists to reveal.
const CONCURRENCY = 8;
// Twelve for the world floor — it is the row a visitor reads as "my latency", and
// the variance across a cold path is the information. Four for a destination that
// gave no address, where the round trip is only the consolation prize.
const WORLD_SAMPLES = 12;
const FALLBACK_SAMPLES = 4;
// How long to hold the first plan waiting for the IP cards. Their geolocation is
// the heaviest single signal, so starting without it would build the table out of
// a clock and a keyboard alone; three seconds is longer than every source that
// answers and short enough that nobody stares at an empty card.
const PROFILE_GRACE_MS = 3000;
const PLAN_TIMEOUT_MS = 8000;

const PENDING = 'pending';
const OK = 'ok';
const UNKNOWN = 'unknown';

// `ip=1.2.3.4` / `loc=US` / `colo=LAX` — a flat key=value body, no JSON. Both
// halves are trimmed: this is a hand-rolled text format from a third party, and a
// stray space on either side of the `=` is not worth losing a row over.
const parseTrace = (text) => {
    const out = {};
    for (const line of String(text || '').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return out;
};

// The exits this page can name: the addresses the visitor's own sources resolved
// first, then what a STUN server reflected back, then every distinct one a
// destination echoed. A source that saw a second address means a second exit whether
// or not some destination ever reported it, and leaving it out is how a table of
// forty rows concludes one exit for a network that has two.
//
// The lists keep the order they were given, so the strip under the opening card does
// not reshuffle every time a destination answers.
export const mergeEgressIps = (...lists) => [...new Set(lists.flat().filter(Boolean))];

// The round trip is timed around the echo rather than measured separately: the one
// request the row was going to make anyway is the cheapest honest sample of the
// path to that destination, and a second probe per row would double the load on
// the visitor's uplink to find out what they already know.
const traceOne = async (host) => {
    const started = performance.now();
    try {
        const res = await fetchWithTimeout(`https://${host}${TRACE_PATH}`, {
            cache: 'no-store',
            timeoutMs: TRACE_TIMEOUT_MS,
        });
        if (!res.ok) return null;
        const fields = parseTrace(await res.text());
        if (!fields.ip) return null;
        return { ip: fields.ip, loc: fields.loc || null, colo: fields.colo || null, ms: performance.now() - started };
    } catch {
        // A dead, blocking or non-Cloudflare destination is the ordinary case on
        // a real network, which is why this returns null rather than an error: the
        // caller's next question is the round trip.
        return null;
    }
};

const timeOne = async (host) => {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
    try {
        await fetch(`https://${host}/`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
        return { ok: true, ms: performance.now() - started };
    } catch {
        return { ok: false, ms: null };
    } finally {
        clearTimeout(timer);
    }
};

// Samples run one after another within a destination so a cold path shows its
// shape, and the figure reported is the fastest of the run.
const probeLatency = async (host, samples, stopped) => {
    const dots = [];
    for (let i = 0; i < samples && !stopped(); i++) {
        const result = await timeOne(host);
        dots.push({ ...result, tone: result.ok ? probeTone(result.ms) : 'fail' });
    }
    const good = dots.filter((d) => d.ok);
    const ms = good.length ? Math.min(...good.map((d) => d.ms)) : null;
    return { dots, ms, reachable: good.length > 0, tone: ms == null ? 'fail' : probeTone(ms) };
};

// Walk `items` with a bounded pool; `onDone(result)` is called as each worker
// settles, so rows fill in order of response rather than in list order.
const pooled = async (items, worker, onDone, limit) => {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            onDone(await worker(items[i]));
        }
    });
    await Promise.all(runners);
};

export function useSiteSplit({ geoLookup, ownGeolocations, knownExits, leaks } = {}) {
    // Rows are replaced wholesale rather than mutated: dozens of objects the table
    // re-reads on every answer is the kind of deep reactivity that makes a page
    // stutter while it loads.
    const rows = shallowRef([]);
    // Addresses this combed the table had to look up for itself. The visitor's own
    // exits are folded in over the top at `geolocations` below.
    const lookedUp = ref({});
    const running = ref(false);
    const done = ref(false);
    // The work order did not arrive, so there is nothing to probe. The table says
    // so rather than showing an empty frame — and rather than falling back to a
    // locally-held copy of the destination list, which is the leak that would be
    // easiest to reintroduce here.
    const planFailed = ref(false);

    let cancelled = false;
    let inflight = null;
    let startedOnce = false;
    // host → the row as it last answered, so a re-plan reuses finished work and a
    // destination is never asked twice in one page view.
    const measured = new Map();
    const asked = new Set();
    // The shape of the last work order, so a re-plan that changes nothing does not
    // touch a table that is already filling in.
    let lastPlanKey = null;

    // --- signals -------------------------------------------------------------

    const cards = ref([]);
    const browserSignals = ref({});
    // The homepage's quiet STUN pass, injected by whoever runs it. A missing
    // `leaks` is not the same state as an empty one — "this build never looked" and
    // "nothing leaked" are different sentences about the same network, and the
    // primary-address rule reads the difference.
    const leakRef = leaks ?? { value: [] };
    // The visitor's own country, resolved once and kept. Which source answered the
    // IP cards decides whether they carry a country *code* at all — ip-api does,
    // several others answer a name in the visitor's language — so a card without a
    // code is looked up through the same key-free source the table asks about every
    // other exit, which also means the two can never disagree about one address.
    const ownCountry = ref({ available: false, reason: 'absent' });

    // `run()` waits on this instead of polling for the address cards, and the
    // subscriber below resolves it the moment they land.
    let resolveCards = null;
    const cardsSettled = new Promise((resolve) => { resolveCards = resolve; });

    const unsubscribe = [
        onAppEvent('ipinfo:finished', (payload) => {
            cards.value = payload?.cards || [];
            resolveCards();
            resolveOwnCountry(cards.value);
            onSignalArrived();
        }),
    ];
    // A STUN answer lands seconds after the first wave is under way, and it is the
    // one signal that can add a country the address half of the page missed.
    watch(() => leakRef.value, () => onSignalArrived());

    let ownLookupRunning = false;
    const resolveOwnCountry = async (cardList) => {
        const direct = geoSliceFromCards(cardList);
        if (direct.available) {
            ownCountry.value = direct;
            return;
        }
        if (ownLookupRunning || !geoLookup) return;
        const v4 = cardList.find((c) => c.ip && !String(c.ip).includes(':'));
        const own = (v4 || cardList.find((c) => c.ip))?.ip;
        if (!own || cancelled) return;
        ownLookupRunning = true;
        try {
            const geo = await geoLookup(own);
            const cc = String(geo?.country_code || '').toUpperCase();
            if (/^[A-Z]{2}$/.test(cc)) ownCountry.value = { available: true, countries: [cc] };
        } catch {
            // Still unmeasured; the server's ranking simply leans on the rest.
        } finally {
            ownLookupRunning = false;
        }
    };

    const currentSignals = () => ({
        ...browserSignals.value,
        geo: ownCountry.value,
        net: networkSlice({ cards: cards.value, leaks: leakRef.value }),
    });

    // Ask for the work order. The response is a list of destinations and nothing
    // else — no ranking, no weights — because the reasoning is not this file's
    // business and must not end up in the bundle.
    const requestPlan = async () => {
        try {
            const res = await fetchWithTimeout('/api/split', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ signals: currentSignals() }),
                timeoutMs: PLAN_TIMEOUT_MS,
                cache: 'no-store',
            });
            if (!res.ok) throw new Error(`split ${res.status}`);
            const plan = await res.json();
            if (!Array.isArray(plan.rows) || !plan.rows.length) throw new Error('empty plan');
            planFailed.value = false;
            return plan.rows;
        } catch {
            // Nothing to probe. The catalog is not mirrored here — a local copy
            // would be the whole destination list, sitting in a published bundle —
            // so the honest answer is an empty table that says why.
            planFailed.value = true;
            return [];
        }
    };

    // --- geolocation of the exits -------------------------------------------

    // One address, one answer. The IP cards have already geolocated the visitor's
    // own exits, and a second source asked about the same string eventually
    // disagrees with the first — an address card saying one city beside a table
    // row saying another is not two facts, it is one of them being wrong. The
    // card's answer therefore wins, and the lookup below is skipped for those
    // addresses rather than run and then overwritten.
    const geolocations = computed(() => ({
        ...lookedUp.value,
        ...(ownGeolocations?.value || {}),
    }));

    const pendingLookups = new Set();
    const locating = ref(0);
    const locate = (ip) => {
        if (!ip || cancelled || geolocations.value[ip] || pendingLookups.has(ip)) return;
        pendingLookups.add(ip);
        locating.value = pendingLookups.size;
        geoLookup(ip)
            .then((geo) => {
                if (!cancelled) lookedUp.value = { ...lookedUp.value, [ip]: geo };
            })
            .catch(() => {
                // Absent, not false: a row with no geo says so rather than showing
                // an address that looks like it was never resolved.
                if (!cancelled) lookedUp.value = { ...lookedUp.value, [ip]: null };
            })
            .finally(() => {
                pendingLookups.delete(ip);
                locating.value = pendingLookups.size;
            });
    };

    // --- one row, end to end -------------------------------------------------

    const blank = (row) => ({
        ...row,
        state: PENDING,
        measured: null,
        ip: null,
        loc: null,
        colo: null,
        dots: [],
        ms: null,
        tone: 'wait',
        reachable: null,
    });

    const measureRow = async (row) => {
        if (row.method === 'ping') {
            const latency = await probeLatency(row.host, WORLD_SAMPLES, () => cancelled);
            // Every sample failing is still an answer: the destination declined
            // the connection. Only a row we never got to run is unknown.
            return {
                ...row,
                state: latency.dots.length ? OK : UNKNOWN,
                measured: latency.dots.length ? 'latency' : null,
                ip: null, loc: null, colo: null,
                dots: latency.dots, ms: latency.ms, tone: latency.tone, reachable: latency.reachable,
            };
        }

        const trace = await traceOne(row.host);
        if (trace) {
            locate(trace.ip);
            return {
                ...row, state: OK, measured: 'trace',
                ...trace, dots: [], tone: probeTone(trace.ms), reachable: true,
            };
        }
        if (cancelled) return blank(row);

        // No address to report, so ask the weaker question instead of leaving the
        // row blank: a connection that completes is a fact about a split even when
        // the site will not say whose address it saw.
        const latency = await probeLatency(row.host, FALLBACK_SAMPLES, () => cancelled);
        return {
            ...row,
            state: latency.dots.length ? OK : UNKNOWN,
            measured: latency.dots.length ? 'latency' : null,
            ip: null, loc: null, colo: null,
            dots: latency.dots, ms: latency.ms, tone: latency.tone, reachable: latency.reachable,
        };
    };

    const runPlan = async (planRows) => {
        // A host already answered, or already being asked, is not worth a second.
        const current = planRows.map((row) => measured.get(row.host) || blank(row));
        const todo = current.filter((row) => !measured.has(row.host) && !asked.has(row.host));
        todo.forEach((row) => asked.add(row.host));
        rows.value = [...current];
        if (!todo.length) return;
        running.value = true;

        await pooled(todo, measureRow, (result) => {
            if (cancelled) return;
            const at = current.findIndex((row) => row.host === result.host);
            if (at < 0) return;
            current[at] = result;
            measured.set(result.host, result);
            rows.value = [...current];
        }, CONCURRENCY);

        running.value = false;
    };

    // --- the adaptive loop ---------------------------------------------------

    // A wave of ~40 destinations takes as long as the visitor's slowest one, and a
    // signal landing during it must not start a second wave writing the same array.
    // So it is folded into the end of the wave it arrived in.
    let waving = false;
    let replanQueued = false;
    // False until the first work order exists: a signal that lands before it is
    // simply part of that first request.
    let allowReplan = false;

    const replan = async () => {
        if (waving) {
            replanQueued = true;
            return;
        }
        waving = true;
        try {
            const planRows = await requestPlan();
            if (cancelled) return;
            const key = planRows.map((r) => r.host).join();
            if (key === lastPlanKey) return;
            lastPlanKey = key;
            await runPlan(planRows);
        } finally {
            waving = false;
        }
        if (replanQueued && !cancelled) {
            replanQueued = false;
            await replan();
        }
    };

    const onSignalArrived = () => { if (allowReplan) replan(); };

    const run = async () => {
        if (inflight) return inflight;
        if (startedOnce) {
            // A deliberate re-test: forget every answer and ask again, including
            // whether the work order still names the same destinations.
            measured.clear();
            asked.clear();
            lastPlanKey = null;
        }
        startedOnce = true;
        cancelled = false;
        done.value = false;
        running.value = true;
        allowReplan = false;

        inflight = (async () => {
            const [os, ime] = await Promise.all([readOperatingSystem(), readKeyboard()]);
            browserSignals.value = { os, ime, tz: readClock(), lang: readLanguages() };
            resolveOwnCountry(cards.value);

            // Wait for the address cards, but never longer than the grace window:
            // a visitor whose IP sources are all dead still deserves a table, and
            // one whose sources are slow should not wait for them.
            await Promise.race([cardsSettled, new Promise((resolve) => setTimeout(resolve, PROFILE_GRACE_MS))]);
            await replan();
            if (cancelled) return;

            allowReplan = true;
            done.value = true;
            running.value = false;
            inflight = null;
        })();
        return inflight;
    };

    const cancel = () => {
        cancelled = true;
        running.value = false;
        inflight = null;
        allowReplan = false;
        pendingLookups.clear();
        unsubscribe.forEach((stop) => stop());
    };

    onScopeDispose(cancel);

    // --- what the page renders ----------------------------------------------

    const egressIps = computed(() => mergeEgressIps(
        knownExits?.value,
        leakRef.value.map((leaked) => leaked.ip),
        rows.value.filter((r) => r.ip).map((r) => r.ip),
    ));

    // An exit is printed with a country beside it, so an address the cards did not
    // geocode — one no visible source resolved, or one whose detail lookup has not
    // landed — is asked the same key-free source the rows' addresses use. `locate`
    // skips what is already known or already in flight, so this fires on every
    // change to the list without ever asking one address twice.
    if (geoLookup) watch(egressIps, (ips) => ips.forEach(locate), { immediate: true });

    const answered = computed(() => rows.value.filter((r) => r.state === OK).length);
    // One table, in the order the server sent it. The ranking rows used to be
    // lifted out into a block of their own on the grounds that they have no
    // address to put in the middle column; they are rows here, and a row that
    // measured a round trip instead of an address says so in its own cell.
    const tableRows = computed(() => rows.value);

    // Which of these addresses the visitor actually is, and which ones only some of
    // the table was willing to be reached from. Both halves of that are displayed,
    // because on a split network they are two different true sentences and the page
    // picking one would be the page making a claim it did not measure.
    const attribution = computed(() => classifyEgress({
        rows: rows.value,
        ownExits: knownExits?.value || [],
        leaks: leakRef.value,
        geolocations: geolocations.value,
    }));

    return {
        rows, tableRows, geolocations,
        running, locating, done, planFailed,
        egressIps, distinct: egressIps, answered,
        attribution,
        run, cancel,
    };
}

export { parseTrace };
