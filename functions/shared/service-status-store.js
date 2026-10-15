// Snapshot cache for the service-status routes.
//
// The Express original keeps a background `setInterval` that refreshes all
// providers every 5 minutes and lets handlers read memory only. An edge function
// gets no such clock: an isolate can be created per request and frozen between
// them, so a timer would either never fire or fire after nobody is listening.
// The same freshness window is therefore carried by the snapshot's own age —
// `REFRESH_INTERVAL_MS` — and a request that finds it stale pays the fan-out.
//
// Everything else is unchanged: providers refresh in parallel, a failed summary
// keeps last-known-good instead of flipping a healthy provider to `unknown`, and
// an incidents-only blip reuses the prior incident list.

import { fetchUpstream } from './fetch-upstream.js';
import { STATUS_PROVIDERS } from './service-status-providers.js';
import { assembleProvider } from './service-status-transform.js';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// One provider is two requests; neither may hold the visitor's response open
// past this, because a hung status page would otherwise be an outage here.
const PROVIDER_BUDGET_MS = 10000;

let snapshot = { updatedAt: null, providers: [] };
let inFlight = null;

const fetchJson = async (url) => {
    const res = await fetchUpstream(url);
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    return res.json();
};

const withBudget = (promise) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('provider budget exceeded')), PROVIDER_BUDGET_MS);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
});

// Refresh one provider. Never throws.
const refreshProvider = async (provider, previous) => {
    const [summary, incidents] = await Promise.allSettled([
        withBudget(fetchJson(`${provider.api}/api/v2/summary.json`)),
        withBudget(fetchJson(`${provider.api}/api/v2/incidents.json`)),
    ]);
    const summaryJson = summary.status === 'fulfilled' ? summary.value : null;
    const incidentsJson = incidents.status === 'fulfilled' ? incidents.value : null;

    if (!summaryJson) {
        if (previous && previous.indicator !== 'unknown') return previous;
        console.warn('[service-status] summary fetch failed (no prior data)', { provider: provider.id });
    }

    const entry = assembleProvider(provider, summaryJson, incidentsJson);
    if (!incidentsJson && previous?.incidents?.length) {
        entry.incidents = previous.incidents;
    }
    return entry;
};

const refreshServiceStatus = () => {
    const prevById = new Map(snapshot.providers.map((p) => [p.id, p]));
    // One provider throwing must not empty the whole snapshot.
    return Promise.all(STATUS_PROVIDERS.map((p) =>
        refreshProvider(p, prevById.get(p.id))
            .then((entry) => entry ?? prevById.get(p.id) ?? assembleProvider(p, null, null))
            .catch(() => prevById.get(p.id) ?? assembleProvider(p, null, null))))
        .then((providers) => {
            snapshot = { updatedAt: new Date().toISOString(), providers };
            return snapshot;
        });
};

// Concurrent requests that all find the cache expired share one fan-out.
export const getSnapshot = async () => {
    const age = snapshot.updatedAt ? Date.now() - Date.parse(snapshot.updatedAt) : Infinity;
    if (age < REFRESH_INTERVAL_MS) return snapshot;
    if (!inFlight) {
        inFlight = refreshServiceStatus()
            .catch((error) => {
                console.error('[service-status] refresh tick failed', error?.message);
                return snapshot;
            })
            .finally(() => { inFlight = null; });
    }
    return inFlight;
};

// Overview: every provider's status light, without the heavier components /
// incidents arrays, so the initial page load stays small.
export const getServiceStatusOverview = async () => {
    const current = await getSnapshot();
    return {
        updatedAt: current.updatedAt,
        providers: current.providers.map(({
            id, name, page, indicator, category, lastIncidentAt,
        }) => ({
            id, name, page, indicator, category: category ?? null, lastIncidentAt: lastIncidentAt ?? null,
        })),
    };
};

// One provider's full cached entry (or null if not in the snapshot yet).
export const getProviderDetail = async (id) => {
    const current = await getSnapshot();
    return current.providers.find((p) => p.id === id) || null;
};
