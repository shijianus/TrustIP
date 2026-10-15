// The AI-egress measurement: which address each AI service actually sees, and what
// can honestly be said when a service declines to say.
//
// The question this answers is the split tunnel's: a visitor who pays for a tunnel
// to reach ChatGPT wants to know which address *that* request goes out with, because
// the answer decides whether the service sees them as being in a country it serves.
// Cloudflare's `/cdn-cgi/trace` echoes the client address in plain text with a
// wildcard CORS header, so the measurement happens in the visitor's browser along
// their real path and this server carries none of it — the same mechanism the
// homepage's routing table is built on, and the reason nothing here needs a key.
//
// Four failure states are the design, not the error handling:
//
//   `no-endpoint`  — the host answered something other than a trace (a 404, a 403,
//                    or a 200 with no `ip=` line). The destination is not fronted by
//                    Cloudflare, or has that path blocked. A structural fact about
//                    the site.
//   `timeout`      — it was still silent at six seconds.
//   `blocked`      — the fetch threw. A browser will not say whether that was a CORS
//                    refusal, a DNS failure, a censored path or a dead NIC, and this
//                    code cannot recover what the platform hides: the copy names the
//                    ambiguity rather than guessing at one of four causes.
//   `answered`     — an address, and the only state that may carry a country, a
//                    verdict or a score.
//
// Nothing is inferred across those boundaries. A row that did not answer gets no
// flag, no region verdict and no score — and a missing control row means the split
// marker is withheld for every row, because "different from what" has no answer.
//
// The trust score is asked once per *distinct* address rather than once per row: two
// services behind the same tunnel exit are one address, and `/api/trustscore` fans
// out into eight registry reads per query.

import { computed, ref } from 'vue';

import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { summarizeSteps, traceOutcome } from './use-test-log.js';
import { parseTrace } from '../utils/parse-trace.js';
import { isValidIP } from '../utils/valid-ip.js';
import {
    AI_EGRESS_ALL, EGRESS_CONTROL, nonCountryLoc, regionVerdict,
} from '../utils/ai-service-regions.js';

const TRACE_PATH = '/cdn-cgi/trace';
// Six seconds, the same budget the routing table gives an echo: a Cloudflare edge
// answers a trace well inside one, so anything still silent here is not coming.
const TRACE_TIMEOUT_MS = 6000;
// A trust lookup fans out into ~8 registry reads plus a blocklist pass, so it gets
// the generous budget the dossier panel already uses rather than a probe's.
const TRUST_TIMEOUT_MS = 15000;

export const EGRESS_STATE = {
    pending: 'pending',
    answered: 'answered',
    noEndpoint: 'noEndpoint',
    timeout: 'timeout',
    blocked: 'blocked',
};

export const TRUST_STATE = {
    idle: 'idle',
    loading: 'loading',
    ready: 'ready',
    failed: 'failed',
};

// An aborted fetch is the one failure a browser names. Anything else that throws is
// lumped into `blocked`, for the reason in the header: the platform does not tell
// us which of four things happened, and neither can we.
export const traceFailureState = (err) => (
    err?.name === 'AbortError' ? EGRESS_STATE.timeout : EGRESS_STATE.blocked
);

/**
 * Ask one destination for the address it sees this browser coming from.
 *
 * @param {string} host
 * @returns {Promise<object>} an `EGRESS_STATE` tag, and on `answered` the trace fields
 */
export const readTrace = async (host) => {
    const started = performance.now();
    try {
        const res = await fetchWithTimeout(`https://${host}${TRACE_PATH}`, {
            cache: 'no-store',
            timeoutMs: TRACE_TIMEOUT_MS,
        });
        if (!res.ok) return { state: EGRESS_STATE.noEndpoint, status: res.status };
        const fields = parseTrace(await res.text());
        // A 200 with no usable `ip=` is not an answer: some middleboxes serve a
        // captive-portal page at every path, and the port let it through. Only
        // syntactic validation here, deliberately — `isValidIP`, not
        // `isUsablePublicIP` — because an echo that names a private address is a
        // real finding about this network, not a value to throw away.
        if (!fields.ip || !isValidIP(fields.ip)) {
            return { state: EGRESS_STATE.noEndpoint, status: res.status };
        }
        return {
            state: EGRESS_STATE.answered,
            ip: fields.ip,
            loc: fields.loc || null,
            colo: fields.colo || null,
            warp: fields.warp || null,
            ms: Math.round(performance.now() - started),
            status: res.status,
        };
    } catch (err) {
        return { state: traceFailureState(err) };
    }
};

// The five fields the panel renders out of a trust response. Everything else —
// the per-signal ladder, the vendor payloads — belongs to the dossier page, and
// shipping it here would be a second copy of a panel this build already has.
const pickTrust = (body) => ({
    score: Number.isFinite(body.score) ? body.score : null,
    band: Number.isFinite(body.band) ? body.band : null,
    cls: body.cls || null,
    confidence: body.confidence?.level || null,
    generatedAt: body.generatedAt || null,
});

/**
 * Score one exit address. Returns the fields to render, or null when the answer
 * is not usable — a failed score is a missing column, never a zero.
 *
 * @param {string} ip
 * @returns {Promise<object|null>}
 */
export const readTrust = async (ip) => {
    try {
        const res = await fetchWithTimeout(
            `/api/trustscore?ip=${encodeURIComponent(ip)}`,
            { timeoutMs: TRUST_TIMEOUT_MS },
        );
        if (!res.ok) return null;
        return pickTrust(await res.json());
    } catch {
        return null;
    }
};

/**
 * Whether this row's exit disagrees with the control's, and whether that is sayable.
 *
 * `null` is a real answer here: with no control address there is nothing to
 * compare against, and rendering "not split" would be a claim about a network this
 * page failed to measure.
 *
 * @param {string|null} exitIp  this row's address, if it answered
 * @param {string|null} controlIp
 * @returns {boolean|null}
 */
export const judgeSplit = (exitIp, controlIp) => {
    if (!exitIp || !controlIp) return null;
    return exitIp !== controlIp;
};

/**
 * Everything the renderer needs about one row's address, decided from the trace
 * alone. Pure, so the honest-failure rules are testable without a browser.
 *
 * @param {object} service  an `AI_EGRESS_ALL` entry
 * @param {object} trace    a `readTrace` result
 * @param {string|null} controlIp
 * @returns {object}
 */
export const judgeRow = (service, trace, controlIp) => {
    const answered = trace?.state === EGRESS_STATE.answered;
    if (!answered) {
        return { state: trace?.state || EGRESS_STATE.pending, split: null, verdict: null, locNote: null };
    }
    const isControl = service.host === EGRESS_CONTROL.host;
    return {
        state: EGRESS_STATE.answered,
        ip: trace.ip,
        loc: trace.loc,
        colo: trace.colo,
        warp: trace.warp,
        ms: trace.ms,
        // The control answers "which address is 首頁 IP", not "is Cloudflare's
        // service available here" — it has no availability list, and none is needed.
        verdict: isControl ? null : regionVerdict(service, trace.loc),
        locNote: nonCountryLoc(trace.loc),
        split: judgeSplit(trace.ip, controlIp),
    };
};

/**
 * The panel's whole data flow: four echoes in parallel, then one score per
 * distinct address those echoes named.
 *
 * @returns {{rows: import('vue').Ref<Array<object>>, running: import('vue').Ref<boolean>,
 *   controlIp: import('vue').ComputedRef<string|null>, splitSeen: import('vue').ComputedRef<boolean>,
 *   run: () => Promise<void>}}
 */
// `log` (optional) is a `useTestLog()` handle (composables/use-test-log.js): each
// echo and each trust lookup is recorded there, and the run begins and finishes it.
export const useAiEgress = ({ log } = {}) => {
    const CONTROL_INDEX = AI_EGRESS_ALL.findIndex((service) => service.host === EGRESS_CONTROL.host);

    const rows = ref(AI_EGRESS_ALL.map((service) => ({
        ...service,
        state: EGRESS_STATE.pending,
        ip: null,
        loc: null,
        colo: null,
        warp: null,
        ms: null,
        verdict: null,
        locNote: null,
        split: null,
        trustState: TRUST_STATE.idle,
        trust: null,
    })));
    const running = ref(false);

    const controlIp = computed(() => {
        const control = rows.value.find((row) => row.host === EGRESS_CONTROL.host);
        return control?.state === EGRESS_STATE.answered ? control.ip : null;
    });

    // The header's one-line answer to "am I splitting?" — true only when at least
    // one service named a *different* address, never when the rows simply failed.
    const splitSeen = computed(() => rows.value.some(
        (row) => row.host !== EGRESS_CONTROL.host && row.split === true,
    ));

    const measure = async () => {
        const pending = AI_EGRESS_ALL.map((service) => (log
            ? log.timed(
                { kind: 'trace', target: service.host, endpoint: `https://${service.host}${TRACE_PATH}`, protocol: 'HTTPS GET' },
                () => readTrace(service.host),
                traceOutcome,
            )
            : readTrace(service.host)));
        const traces = await Promise.allSettled(pending);
        const traced = AI_EGRESS_ALL.map((service, i) => (
            traces[i].status === 'fulfilled' ? traces[i].value : { state: EGRESS_STATE.blocked }
        ));

        // The ruler every other row is measured against. `judgeSplit` returns null
        // without it, so a control that failed to answer withholds the split marker
        // from every row rather than leaving the visitor with four uncomparable
        // addresses and no statement about them.
        const control = traced[CONTROL_INDEX]?.state === EGRESS_STATE.answered
            ? traced[CONTROL_INDEX].ip
            : null;

        const next = AI_EGRESS_ALL.map((service, i) => ({
            ...service,
            ...judgeRow(service, traced[i], control),
            trustState: TRUST_STATE.idle,
            trust: null,
        }));
        rows.value = next;

        // Scored after the echoes land, and once per address: the control's address
        // is usually also a service's address, and a second lookup of it would be a
        // duplicate fan-out to eight registries for a number already on screen.
        const addresses = [...new Set(next.map((row) => row.ip).filter(Boolean))];
        if (!addresses.length) return;
        rows.value = next.map((row) => ({
            ...row,
            trustState: row.ip ? TRUST_STATE.loading : TRUST_STATE.idle,
        }));
        const scores = new Map();
        await Promise.allSettled(addresses.map(async (ip) => {
            scores.set(ip, await (log
                ? log.timed(
                    { kind: 'trust', target: ip, endpoint: `/api/trustscore?ip=${ip}`, protocol: 'HTTPS GET' },
                    () => readTrust(ip),
                    (body) => (body ? { result: 'ok', value: `score ${body.score ?? '—'} · band ${body.band ?? '—'}` } : { result: 'fail', error: 'no score' }),
                )
                : readTrust(ip)));
        }));
        rows.value = rows.value.map((row) => {
            if (!row.ip) return { ...row, trustState: TRUST_STATE.idle };
            const trust = scores.get(row.ip) || null;
            return {
                ...row,
                trustState: trust ? TRUST_STATE.ready : TRUST_STATE.failed,
                trust,
            };
        });
    };

    // Held across both phases: a Refresh pressed while the scores are still landing
    // would otherwise start a second echo pass over the same four hosts.
    const run = async () => {
        if (running.value) return;
        running.value = true;
        log?.begin({ services: AI_EGRESS_ALL.map((service) => service.host).join(', '), control: EGRESS_CONTROL.host });
        try {
            await measure();
        } finally {
            running.value = false;
            if (log) {
                const verdict = summarizeSteps(log.record.value?.steps || [], { kinds: ['trace'] });
                log.finish(splitSeen.value
                    ? { verdict: 'partial', reason: 'aiSplit', params: { ...verdict.params, control: controlIp.value || '—' } }
                    : verdict);
            }
        }
    };

    return { rows, running, controlIp, splitSeen, run };
};
