// The address-level cache behind the trust lookups: one process' LRU, and Cloudflare
// Workers KV when a deployment configures it.
//
// `common/trust-signals.js` answers a question about one address with about eight
// registry reads — reverse DNS, the RIR allocation, the AS organisation, RIPEstat
// prefix and RPKI facts. Those move on the clock of a routing table, not of a
// request, and the same address is asked again the moment a visitor shares the link
// it was measured for. The in-process Map this replaced already did that much; what
// it could not do was survive a restart or a second instance, so a deployment running
// two processes asked RIPEstat twice for every address, and an overnight data
// refresh emptied the whole cache and re-asked the world.
//
// So: memory first, KV behind it, and the *same* answer either way. A KV hit is
// promoted into memory on the way out, which is what keeps a warm process from
// putting a network call in front of every lookup.
//
// Both halves are allowed to fail, and neither is allowed to fail a lookup. A KV read
// that times out, 500s or returns something unparseable is a cache miss — the producer
// runs and the response is the one the deployment would have got with no cache at all.
// A write failure is invisible for the same reason: this is a cost optimisation, not a
// data path, and treating it as one would make Cloudflare's control plane a
// dependency of every IP page.
//
// The value carries its own expiry inside the stored JSON. KV's `expiration_ttl` does
// the real removal, but a reader cannot ask KV how much of it is left, and an entry
// that arrived from a copied namespace, a restored backup or a clock skew has to be
// judged by the freshness it claims rather than by the fact that it exists.

import { fetchUpstream } from './fetch-with-timeout.js';
import logger from './logger.js';

// Bumping this is how a shape change invalidates every stored entry, rather than
// leaving a deployment reading last week's evidence object through this week's fields.
const CACHE_VERSION = 'trust:v1';

// 2000 addresses. A scanner walking a /8 would otherwise grow this without bound.
const MEMORY_MAX = 2000;

// KV stores values up to tens of megabytes; a trust evidence object is a few
// kilobytes. Past this the write is skipped rather than attempted — a value that big
// is a bug upstream of here, and it would make every read of it slow as well as big.
const MAX_VALUE_BYTES = 64 * 1024;

// The cache is a cost optimisation, so it gets a shorter leash than a registry: three
// seconds, and then answer as though there were no cache.
const KV_TIMEOUT_MS = 3000;

const memory = new Map();

// The same three CLOUDFLARE_* variables the share-report storage uses, read per call
// so a late-loaded `.env` and the test suite both work.
const kvConfig = () => {
    const apiKey = process.env.CLOUDFLARE_API_KEY || process.env.CLOUDFLARE_API;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    const namespaceId = process.env.CLOUDFLARE_KV_NAMESPACE_ID;
    if (!apiKey || !accountId || !namespaceId) return null;
    return { apiKey, accountId, namespaceId };
};

/**
 * Which store this instance is using. Reported rather than assumed, because a
 * deployment that believes it has a shared cache and does not is paying for the
 * registry reads twice.
 *
 * @returns {'kv'|'memory'}
 */
export const sharedCacheBackend = () => (kvConfig() ? 'kv' : 'memory');

// Reading an entry moves it to the back of the Map, so the entry the cap evicts is the
// one this process has not asked for in the longest time. Plain insertion order would
// evict a still-hot address that merely got there first.
const memoryRead = (key) => {
    const hit = memory.get(key);
    if (!hit) return undefined;
    if (hit.expires <= Date.now()) {
        memory.delete(key);
        return undefined;
    }
    memory.delete(key);
    memory.set(key, hit);
    return hit.value;
};

const memoryWrite = (key, value, ttlSeconds) => {
    while (memory.size >= MEMORY_MAX) {
        const oldest = memory.keys().next().value;
        if (oldest === undefined) break;
        memory.delete(oldest);
    }
    memory.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
};

const kvValueUrl = (config, key) => `https://api.cloudflare.com/client/v4/accounts/${config.accountId}`
    + `/storage/kv/namespaces/${config.namespaceId}/values/${encodeURIComponent(`${CACHE_VERSION}:${key}`)}`;

// `{ value, ttlSeconds }` when the stored entry still claims to be fresh, undefined
// when it does not — including when KV handed back an HTML error page.
const parseStored = (text) => {
    try {
        const stored = JSON.parse(text);
        if (!stored || typeof stored !== 'object' || typeof stored.expires !== 'number') return undefined;
        const left = Math.round((stored.expires - Date.now()) / 1000);
        if (left <= 0) return undefined;
        return { value: stored.value, ttlSeconds: left };
    } catch {
        return undefined;
    }
};

/**
 * Look one key up: this process' memory, then the shared store.
 *
 * @param {string} key  the caller's namespaced key, without the version prefix
 * @returns {Promise<any|undefined>} the value, or undefined for "ask the producer"
 */
export const readEntry = async (key) => {
    const hot = memoryRead(key);
    if (hot !== undefined) return hot;

    const config = kvConfig();
    if (!config) return undefined;

    try {
        const res = await fetchUpstream(kvValueUrl(config, key), {
            method: 'GET',
            timeoutMs: KV_TIMEOUT_MS,
            headers: { Authorization: `Bearer ${config.apiKey}` },
        });
        if (!res.ok) return undefined;
        const stored = parseStored(await res.text());
        if (!stored) return undefined;
        // Promoted, on the freshness the entry claimed rather than this key's usual
        // TTL: a value recovered from a backup must not get a second full day.
        memoryWrite(key, stored.value, stored.ttlSeconds);
        return stored.value;
    } catch (err) {
        logger.warn({ err, key }, 'trust-cache: KV read failed, answering without the cache');
        return undefined;
    }
};

/**
 * Store one key — memory immediately, the shared store when it is configured.
 *
 * @param {string} key
 * @param {any} value  anything JSON round-trips
 * @param {number} ttlSeconds
 */
export const writeEntry = (key, value, ttlSeconds) => {
    const seconds = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 1;
    memoryWrite(key, value, seconds);

    const config = kvConfig();
    if (!config) return;

    const stored = JSON.stringify({ expires: Date.now() + seconds * 1000, value });
    const bytes = Buffer.byteLength(stored, 'utf8');
    if (bytes > MAX_VALUE_BYTES) {
        logger.warn({ key, bytes }, 'trust-cache: value too large to share');
        return;
    }

    // A sub-second TTL is meaningful in memory (and the freshness tests use one); the
    // shared store counts in whole seconds, so it rounds up rather than sharing
    // nothing at all.
    const kvTtl = Math.max(1, Math.round(seconds));

    // Multipart form is what the KV write endpoint takes — a raw body answers 400 —
    // and the write is deliberately not awaited: making a caller wait on Cloudflare's
    // control plane to return a verdict it has already computed is a slower page for
    // no extra correctness.
    const form = new FormData();
    form.append('value', stored);
    form.append('metadata', '{}');
    fetchUpstream(`${kvValueUrl(config, key)}?expiration_ttl=${kvTtl}`, {
        method: 'PUT',
        timeoutMs: KV_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${config.apiKey}` },
        body: form,
    }).then((res) => {
        if (!res.ok) logger.warn({ key, status: res.status }, 'trust-cache: KV write refused');
    }).catch((err) => {
        logger.warn({ err, key }, 'trust-cache: KV write failed');
    });
};

/**
 * Forget everything this process is remembering.
 *
 * The test suite needs to start a clock clean; nothing in the request path calls this,
 * and a deployment that wants to invalidate a verdict uses the edge cache it already
 * owns, not this.
 *
 * @internal
 */
export const resetTrustCache = () => {
    memory.clear();
};
