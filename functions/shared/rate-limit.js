// Per-client rate limiting for the edge function, which has none of the Express
// app's `express-rate-limit` / `express-slow-down` middleware.
//
// Why this exists at all: a key-free hosted deployment is the one place where an
// anonymous visitor can drive upstream calls directly, and several of the routes
// here answer from a third party's free quota. Without a ceiling, one script
// walking addresses spends the quota every real visitor depends on. The platform's
// own gateway may throttle, but that is not something this repo can observe or
// assert, so the app carries its own limit and states its scope honestly.
//
// Scope, stated because it is the whole of the limitation: the bucket lives in one
// isolate's memory. A warm instance enforces it; a new instance starts fresh, and
// N concurrent instances each spend the ceiling. That is the same arithmetic
// `common/providers/quota.js` documents for the vendor budget — a shared counter
// would need atomic state this runtime does not offer. It is a brake on a single
// abuser, not a distributed firewall.
//
// Who a request is: only the address the platform itself writes. The edge
// deployment sits behind Cloudflare, which sets `CF-Connecting-IP` at the edge
// and overwrites any copy the client sent, so that header is the one claim a
// visitor cannot choose. `X-Forwarded-For` and `X-Real-IP` are never read: their
// first hop is whatever the client typed, so keying on them lets a script mint a
// fresh bucket per request.
//
// A request without that header is not waved through. It lands in one shared
// `unknown` bucket: on this platform its absence means something other than a
// normal visitor reached the function, and failing open would turn "strip the
// header" into "no limit at all".
export const UNKNOWN_CLIENT = 'unknown';

export const clientIpOf = (headers) => {
    const direct = String(headers.get('cf-connecting-ip') ?? '').trim();
    return direct || UNKNOWN_CLIENT;
};

/**
 * A fixed-window counter per client.
 *
 * A window rather than a token bucket because what is being protected is a
 * vendor's daily/monthly request allowance: the unit of the problem is "how many
 * did this address ask for", and a window says that directly.
 *
 * Memory is bounded twice. Expired buckets are swept, at most once per
 * `sweepIntervalMs` so a busy isolate never pays an O(n) walk per request. And the
 * map never holds more than `maxKeys`: it is kept in least-recently-used order
 * (a hit re-inserts its key at the tail), so a new client past the cap evicts the
 * client idle the longest, never the one currently being counted.
 *
 * @param {object} options
 * @param {number} options.limit     requests allowed per window; <= 0 disables
 * @param {number} options.windowMs  window length
 * @param {number} [options.maxKeys] most buckets held at once
 * @param {number} [options.sweepIntervalMs] least time between expiry sweeps
 * @param {() => number} [options.now] clock, injected so tests do not wait
 * @returns {{ check: (key: string|null) => { allowed: boolean, retryAfterSeconds: number },
 *            size: () => number }}
 */
export const createRateLimiter = ({
    limit, windowMs, maxKeys = 10_000, sweepIntervalMs = 1_000, now = () => Date.now(),
}) => {
    const buckets = new Map();
    const cap = Math.max(1, Math.floor(maxKeys));
    let lastSweep = -Infinity;

    const sweep = (moment) => {
        lastSweep = moment;
        for (const [key, bucket] of buckets) {
            if (bucket.resetAt <= moment) buckets.delete(key);
        }
    };

    // Map iteration order is insertion order, so the first key is the least
    // recently used one.
    const evictOldest = () => {
        const oldest = buckets.keys().next();
        if (!oldest.done) buckets.delete(oldest.value);
    };

    return {
        check(rawKey) {
            if (!(limit > 0)) return { allowed: true, retryAfterSeconds: 0 };
            const key = (typeof rawKey === 'string' && rawKey.trim()) || UNKNOWN_CLIENT;

            const moment = now();
            if (moment - lastSweep >= sweepIntervalMs) sweep(moment);

            const bucket = buckets.get(key);
            if (!bucket || bucket.resetAt <= moment) {
                buckets.delete(key);
                while (buckets.size >= cap) evictOldest();
                buckets.set(key, { count: 1, resetAt: moment + windowMs });
                return { allowed: true, retryAfterSeconds: 0 };
            }

            buckets.delete(key);
            buckets.set(key, bucket);
            bucket.count += 1;
            if (bucket.count <= limit) return { allowed: true, retryAfterSeconds: 0 };

            return {
                allowed: false,
                retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - moment) / 1000)),
            };
        },
        size: () => buckets.size,
    };
};

// Defaults chosen against how a real page visit behaves, not against what an
// attacker sends: `/` fans out to the routing table's destinations and the IP
// cards in one load, so a visitor legitimately spends tens of requests before the
// panel has even finished rendering. The ceiling sits an order of magnitude above
// that — low enough that a script hammering `/ipsb?ip=` hits it in seconds, high
// enough that no browser page does.
export const RATE_LIMIT_DEFAULTS = {
    limit: 600,
    windowMs: 15 * 60 * 1000,
};

// `SITE_RATE_LIMIT` — requests per window per client. 0 or a non-number disables
// the limiter, which is the same escape hatch `SECURITY_RATE_LIMIT` gives the
// Express app: a deployment behind a gateway that already throttles should not
// stack a second blind limit on top. A number *below* one honest page visit is
// almost always a typo, so the window is left generous and the operator lowers it
// deliberately rather than being surprised by a site that rejects visitors.
export const rateLimitConfig = (env = {}) => {
    const raw = String(env.SITE_RATE_LIMIT ?? '').trim();
    if (!raw) return { ...RATE_LIMIT_DEFAULTS };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return { ...RATE_LIMIT_DEFAULTS };
    return { limit: Math.max(0, Math.floor(parsed)), windowMs: RATE_LIMIT_DEFAULTS.windowMs };
};
