// The latency strip under "my IP": six destinations, twelve timed requests
// each, drawn as dots so the variance is visible before any number is read.
//
// These are `no-cors` requests made by the visitor's browser. Opaque means the
// response body and status are unreadable — which is fine, because the only
// thing being measured here is whether a connection completed and how long it
// took. That also keeps the probe honest about what it is: a path measurement,
// not a verdict on the destination.
//
// Twelve samples rather than one, because a cold path's first packet always
// loses. A single figure would report the handshake; the dot row shows the
// shape, and the number beside it is the fastest of the run.

import { ref, shallowRef, onScopeDispose } from 'vue';
import { PROBE_SAMPLES, probeTone } from '../data/site-split.js';

const SAMPLE_TIMEOUT_MS = 5000;

const timeOne = async (url) => {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
    try {
        await fetch(url, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
        return { ok: true, ms: performance.now() - started };
    } catch {
        return { ok: false, ms: null };
    } finally {
        clearTimeout(timer);
    }
};

export function useConnectivityProbes({ probes = [], samples = PROBE_SAMPLES } = {}) {
    const rows = shallowRef(probes.map((p) => ({ ...p, dots: [], ms: null, tone: 'wait' })));
    const running = ref(false);
    let cancelled = false;
    let inflight = null;

    const probeOne = async (row) => {
        const dots = [];
        for (let i = 0; i < samples && !cancelled; i++) {
            const result = await timeOne(`https://${row.host}/`);
            dots.push({ ...result, tone: result.ok ? probeTone(result.ms) : 'fail' });
        }
        return dots;
    };

    const run = async () => {
        if (inflight) return inflight;
        cancelled = false;
        running.value = true;
        const current = probes.map((p) => ({ ...p, dots: [], ms: null, tone: 'wait' }));
        rows.value = current;

        // Every destination probed at once; within a destination the samples
        // run one after another, so a slow site cannot delay a fast one's
        // first dot.
        inflight = Promise.all(current.map(async (row, i) => {
            const dots = await probeOne(row);
            if (cancelled) return;
            const good = dots.filter((d) => d.ok);
            current[i] = {
                ...row,
                dots,
                ms: good.length ? Math.min(...good.map((d) => d.ms)) : null,
                tone: good.length ? probeTone(Math.min(...good.map((d) => d.ms))) : 'fail',
            };
            rows.value = [...current];
        })).then(() => {
            if (cancelled) return;
            running.value = false;
            inflight = null;
        });
        return inflight;
    };

    const cancel = () => {
        cancelled = true;
        running.value = false;
        inflight = null;
    };

    onScopeDispose(cancel);

    return { rows, running, run, cancel };
}
