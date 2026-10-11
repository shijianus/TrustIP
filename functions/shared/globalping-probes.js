// Globalping probe inventory for the frontend country pickers (MTR, latency,
// censorship check). Same proxying rationale as api/globalping-probes.js: the raw
// /v1/probes list is hundreds of kilobytes of per-probe detail the UI never
// renders, and coverage changes slowly, so the compact answer goes out with a
// week of edge cache.
//
// The one deviation is the timeout. `fetchUpstream` defaults to 8s, which suits a
// registry lookup; this is a single large listing that measured ~900 KB and took
// well over that from a constrained network, so an 8s budget made the route 500
// on a healthy upstream. A route that fails on time is not a faithful port.

import { fetchUpstream } from './fetch-upstream.js';
import { buildProbeInventory } from './globalping-inventory.js';
import { json } from './respond.js';

const GLOBALPING_PROBES_URL = 'https://api.globalping.io/v1/probes';
const ONE_WEEK_CACHE = 7 * 24 * 60 * 60;
const PROBES_TIMEOUT_MS = 20000;

export default async () => {
    try {
        const response = await fetchUpstream(GLOBALPING_PROBES_URL, { timeoutMs: PROBES_TIMEOUT_MS });
        if (!response.ok) throw new Error(`Globalping probes responded with status ${response.status}`);
        return json(buildProbeInventory(await response.json()), { cacheSeconds: ONE_WEEK_CACHE });
    } catch (error) {
        console.error('[globalping-probes] handler failed', { error: error?.message });
        return json({ error: error?.message || String(error) }, { status: 500, cacheSeconds: ONE_WEEK_CACHE });
    }
};
