// One network's PeeringDB record from the public API, for deployments that do
// not hold the local index (common/peeringdb-db.js, downloaded only with the
// Cloudflare key). Same expanded shape as lookupPeeringdb — the API answer is
// projected through the index builder's own row projections, so a field means
// the same thing whichever path produced it.
//
// GET https://www.peeringdb.com/api/net?asn=<n>&depth=2 — anonymous works; a
// PEERINGDB_API_KEY (free, from a PeeringDB account) is sent as
// `Authorization: Api-Key <key>` and lifts the anonymous per-IP throttle.
// Contact data (poc_set) is never read.
//
// Cached per ASN in this process: a record or an "AS has no PeeringDB entry"
// for a day (operators edit their entry rarely), a failure for ten minutes. A
// 429 pauses every lookup until its Retry-After (default 60 s) instead of
// spending the throttle again on each visitor.
//
// PEERINGDB_API=false turns the fallback off; the local index is unaffected.

import { fetchUpstream } from './fetch-with-timeout.js';
import logger from './logger.js';
import { projectRow, buildPeeringdbIndex, tablesFromIndex, expandNet, isPeeringdbLoaded, lookupPeeringdb } from './peeringdb-db.js';

export const PEERINGDB_API_BASE = 'https://www.peeringdb.com/api/net';
export const PEERINGDB_API_TIMEOUT_MS = 5000;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_AFTER_S = 60;
const CACHE_MAX = 5000;

export const isPeeringdbApiEnabled = () => process.env.PEERINGDB_API !== 'false';
export const hasPeeringdbApiKey = () => Boolean(process.env.PEERINGDB_API_KEY);

const cache = new Map();
let pausedUntil = 0;

/** Test hook: forget every cached answer and any 429 pause. */
export const resetPeeringdbApiCache = () => {
    cache.clear();
    pausedUntil = 0;
};

/**
 * The API's `data[0]` (depth=2) → the expanded record expandNet returns, or
 * null when the network carries nothing the index would keep. Pure.
 */
export const recordFromApi = (net) => {
    if (!net || typeof net !== 'object' || !Number(net.asn)) return null;
    const asn = Number(net.asn);
    const netixlan = (Array.isArray(net.netixlan_set) ? net.netixlan_set : []).filter((r) => r && typeof r === 'object');
    const netfac = (Array.isArray(net.netfac_set) ? net.netfac_set : []).filter((r) => r && typeof r === 'object');
    // The exchange rows carry the IX's name only; city / country stay empty.
    const ix = netixlan.map((r) => projectRow.ix({ id: r.ix_id, name: r.name, status: 'ok' }));
    const index = buildPeeringdbIndex({
        net: [projectRow.net(net)],
        ix,
        netixlan: netixlan.map((r) => projectRow.netixlan({ ...r, asn })),
        netfac: netfac.map((r) => projectRow.netfac({ ...r, net_id: net.id })),
    });
    return expandNet(tablesFromIndex(index), asn);
};

const remember = (asn, value, ttl) => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(asn, { value, expires: Date.now() + ttl });
};

const retryAfterSeconds = (res) => {
    const seconds = Number(res.headers.get('retry-after'));
    return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : DEFAULT_RETRY_AFTER_S;
};

/**
 * Ask the API about one ASN.
 *
 * @returns {Promise<{ status: 'record'|'no-record'|'error', record?: object,
 *   reason?: string, retryAfter?: number, source: string }>}
 */
export const fetchPeeringdbNet = async (asn, { fetchImpl = fetchUpstream } = {}) => {
    const key = Number(asn);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    if (pausedUntil > Date.now()) {
        return { status: 'error', reason: 'rate-limited', retryAfter: Math.ceil((pausedUntil - Date.now()) / 1000), source: 'peeringdb-api' };
    }
    const headers = hasPeeringdbApiKey() ? { Authorization: `Api-Key ${process.env.PEERINGDB_API_KEY}` } : undefined;
    try {
        const res = await fetchImpl(`${PEERINGDB_API_BASE}?asn=${key}&depth=2`, { headers, timeoutMs: PEERINGDB_API_TIMEOUT_MS });
        if (res.status === 429) {
            const retryAfter = retryAfterSeconds(res);
            pausedUntil = Date.now() + retryAfter * 1000;
            logger.warn({ asn: key, retryAfter }, 'peeringdb-api: throttled; pausing lookups');
            return { status: 'error', reason: 'rate-limited', retryAfter, source: 'peeringdb-api' };
        }
        if (!res.ok) {
            const value = { status: 'error', reason: `http-${res.status}`, source: 'peeringdb-api' };
            remember(key, value, FAILURE_TTL_MS);
            return value;
        }
        const body = await res.json();
        const record = recordFromApi(Array.isArray(body?.data) ? body.data[0] : null);
        const value = record
            ? { status: 'record', record, source: 'peeringdb-api' }
            : { status: 'no-record', source: 'peeringdb-api' };
        remember(key, value, RECORD_TTL_MS);
        return value;
    } catch (err) {
        logger.warn({ err, asn: key }, 'peeringdb-api: lookup failed');
        const value = { status: 'error', reason: 'request-failed', source: 'peeringdb-api' };
        remember(key, value, FAILURE_TTL_MS);
        return value;
    }
};

/**
 * The network's PeeringDB record from whichever path this deployment has:
 * the local index when loaded, else the API (when enabled).
 *
 * @returns {Promise<{ status, record?, source, reason?, retryAfter? }>}
 *   status 'record' | 'no-record' | 'error' | 'disabled'
 */
export const resolvePeeringdbNet = async (asn, deps = {}) => {
    const { loaded = isPeeringdbLoaded, lookup = lookupPeeringdb, apiEnabled = isPeeringdbApiEnabled, fetchNet = fetchPeeringdbNet } = deps;
    if (!Number(asn)) return { status: 'no-record', source: null };
    if (loaded()) {
        const record = lookup(asn);
        return record ? { status: 'record', record, source: 'peeringdb-index' } : { status: 'no-record', source: 'peeringdb-index' };
    }
    if (!apiEnabled()) return { status: 'disabled', source: null };
    return fetchNet(asn);
};
