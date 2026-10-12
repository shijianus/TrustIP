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
// Fail-open rule: a request whose client cannot be identified is *not* put in a
// shared bucket. Everyone anonymous would mean every visitor paying for one
// abuser's traffic, which is the opposite of the point. The platform sets
// `X-Forwarded-For` for real connections, so the fallback path is a misconfigured
// proxy rather than a normal visitor.

// The headers a deployment fronting this function sets, in order of trust.
// `cf-connecting-ip` and `x-real-ip` are written by the proxy, not the client;
// `X-Forwarded-For` is a chain, and only its first hop claims to be the client —
// every later one is something an upstream proxy added, so it proves nothing about
// who connected.
export const clientIpOf = (headers) => {
    const direct = headers.get('cf-connecting-ip') || headers.get('x-real-ip');
    if (direct) return direct.trim() || null;

    const chain = headers.get('x-forwarded-for');
    if (!chain) return null;
    const first = chain.split(',')[0].trim();
    return first || null;
};

/**
 * A fixed-window counter per client.
 *
 * A window rather than a token bucket because what is being protected is a
 * vendor's daily/monthly request allowance: the unit of the problem is "how many
 * did this address ask for", and a window says that directly.
 *
 * @param {object} options
 * @param {number} options.limit     requests allowed per window; <= 0 disables
 * @param {number} options.windowMs  window length
 * @param {() => number} [options.now] clock, injected so tests do not wait
 * @returns {{ check: (key: string|null) => { allowed: boolean, retryAfterSeconds: number },
 *            size: () => number }}
 */
export const createRateLimiter = ({ limit, windowMs, now = () => Date.now() }) => {
    const buckets = new Map();
    // Entries expire per key, but nothing wakes up to notice. Sweep when the map
    // outgrows a comfortable size: an idle deployment must not keep every visitor
    // of the day, and a busy one should not pay an O(n) walk on each request.
    const SWEEP_AT = 2048;

    const sweep = (moment) => {
        for (const [key, bucket] of buckets) {
            if (bucket.resetAt <= moment) buckets.delete(key);
        }
    };

    return {
        check(key) {
            if (!(limit > 0)) return { allowed: true, retryAfterSeconds: 0 };
            if (!key) return { allowed: true, retryAfterSeconds: 0 };

            const moment = now();
            if (buckets.size >= SWEEP_AT) sweep(moment);

            const bucket = buckets.get(key);
            if (!bucket || bucket.resetAt <= moment) {
                buckets.set(key, { count: 1, resetAt: moment + windowMs });
                return { allowed: true, retryAfterSeconds: 0 };
            }

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
