// The browser-side fan-out behind the homepage's IP-routing table.
//
// One row = one question: when this browser reaches that service, which
// address does the service see? Cloudflare answers it — `GET
// https://<host>/cdn-cgi/trace` returns plain text with an `ip=` line and
// `Access-Control-Allow-Origin: *`, so the request goes from the visitor's own
// machine to the real destination, along the exact path their network routes
// it. Nothing is proxied through this server, which matters twice over: the
// answer is about the visitor's route rather than ours, and a page view does
// not turn into 44 outbound requests from a third party's host.
//
// What the table is for: a network that splits sends mainland domains out one
// exit and everything else out another. That shows up here as two different
// addresses in one screenful, and the summary row counts them.
//
// A row that never answers is reported as unknown. It is not marked failed,
// because "failed" would be a claim about the visitor's network when the real
// cause may simply be that a destination stopped fronting on Cloudflare.

import { ref, shallowRef, onScopeDispose } from 'vue';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';

const TRACE_PATH = '/cdn-cgi/trace';
// Eight at a time. All forty-four at once saturates a home uplink and starts
// timing out on exactly the slow paths the table exists to reveal.
const CONCURRENCY = 8;
const TRACE_TIMEOUT_MS = 10000;

// `ip=1.2.3.4` / `loc=US` / `colo=LAX` — a flat key=value body, no JSON. Both
// halves are trimmed: this is a hand-rolled text format from a third party,
// and a stray space on either side of the `=` is not worth losing a row over.
const parseTrace = (text) => {
    const out = {};
    for (const line of String(text || '').split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
    return out;
};

const traceOne = async (host) => {
    try {
        const res = await fetchWithTimeout(`https://${host}${TRACE_PATH}`, {
            cache: 'no-store',
            timeoutMs: TRACE_TIMEOUT_MS,
        });
        if (!res.ok) return { state: 'unknown' };
        const fields = parseTrace(await res.text());
        if (!fields.ip) return { state: 'unknown' };
        return { state: 'ok', ip: fields.ip, loc: fields.loc || null, colo: fields.colo || null };
    } catch {
        // A dead or blocking destination is the ordinary case on a real
        // network, and the row's own answer is the interesting part.
        return { state: 'unknown' };
    }
};

// Walk `items` with a bounded pool; `onDone(index, result)` is called as each
// worker settles, so rows fill in order of response rather than in list order.
const pooled = async (items, worker, onDone, limit) => {
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            onDone(i, await worker(items[i]));
        }
    });
    await Promise.all(runners);
};

export function useSiteSplit({ sites, geoLookup } = {}) {
    // rows is replaced wholesale rather than mutated: forty-four objects the
    // table re-reads on every answer is the kind of deep reactivity that makes
    // a page stutter while it loads.
    const rows = shallowRef((sites || []).map((s) => ({ ...s, state: 'pending', ip: null, loc: null, colo: null })));
    const geolocations = ref({});
    const running = ref(false);
    const done = ref(false);
    let cancelled = false;
    let inflight = null;

    // One lookup per distinct egress address, fired the moment that address is
    // first seen rather than batched after every destination has answered. A
    // split network produces two or three exits out of forty-four rows, so this
    // is two or three requests — and batching them to the end meant the
    // Geolocation column sat empty until the slowest destination in the list
    // replied, which reads as "this site reports nothing" when the truth is
    // "we have not looked yet".
    const pendingLookups = new Set();
    // Reactive mirror of the set's size: the table needs to know that an
    // answered row may still be waiting on its geolocation, which is a
    // different state from "the destination reports nothing".
    const locating = ref(0);
    const locate = (ip) => {
        if (!ip || cancelled || geolocations.value[ip] || pendingLookups.has(ip)) return;
        pendingLookups.add(ip);
        locating.value = pendingLookups.size;
        geoLookup(ip)
            .then((geo) => {
                if (!cancelled) geolocations.value = { ...geolocations.value, [ip]: geo };
            })
            .catch(() => {
                // Absent, not false: a row with no geo says so rather than
                // showing an address that looks like it was never resolved.
                if (!cancelled) geolocations.value = { ...geolocations.value, [ip]: null };
            })
            .finally(() => {
                pendingLookups.delete(ip);
                locating.value = pendingLookups.size;
            });
    };

    const run = async () => {
        if (inflight) return inflight;
        cancelled = false;
        running.value = true;
        done.value = false;
        const current = rows.value.map((r) => ({ ...r, state: 'pending' }));
        rows.value = current;

        inflight = pooled(current, (row) => traceOne(row.host), (i, result) => {
            if (cancelled) return;
            current[i] = { ...current[i], ...result };
            rows.value = [...current];
            if (result.state === 'ok') locate(result.ip);
        }, CONCURRENCY).then(() => {
            if (cancelled) return;
            running.value = false;
            done.value = true;
            inflight = null;
        });
        return inflight;
    };

    const cancel = () => {
        cancelled = true;
        running.value = false;
        inflight = null;
        pendingLookups.clear();
    };

    onScopeDispose(cancel);

    return { rows, geolocations, running, locating, done, run, cancel };
}

export { parseTrace };
