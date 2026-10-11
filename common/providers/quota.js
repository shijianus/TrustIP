// Per-vendor spending limits for the keyed provider lists.
//
// The switch that enables a vendor (`TRUST_PROVIDERS`) is a decision about *whether*
// to ask; this file is about *how often*. Every one of these feeds is a metered
// subscription or a free tier, and the same key also serves the geolocation cards —
// which means an audit script walking a /8 through `/api/dossier` spends it at a rate
// nobody agreed to, and the failure it produces is not an outage but a *data gap*: an
// exhausted key answers `unavailable`, and a page that had opinions about proxy,
// hosting and abuse quietly stops having them. Counting is what turns that from a
// surprise into a policy.
//
// The ceiling is deliberately configuration, not a table of vendor pricing baked in
// here. A free tier is the vendor's commercial decision and it changes without asking
// this repository; a number copied from a pricing page would rot into a wrong budget
// that silently throttles a deployment that can afford more — or, worse, one that
// thinks it is protected when the real ceiling moved. `TRUST_PROVIDER_DAILY_MAX` is
// the operator's own answer to "how many lookups per vendor am I willing to spend
// per day", and 0 (the default) means the deployment has not decided, so nothing is
// withheld.
//
// What the counter protects is *this process*'s spend, and that limit is stated rather
// than glossed: two pm2 instances each count to the ceiling and the key is charged
// twice. A shared budget would need an atomic increment, which Workers KV does not
// offer — a read-modify-write on an eventually-consistent store races, and a counter
// that loses updates under concurrency is a number nobody can act on. Per-process
// accounting is the honest shape: exact within one process, conservative across
// restarts (the day resets), and the deployment that runs N instances sets N times the
// intent, which is a decision an operator can actually see.

// Resets on the UTC calendar day, not a rolling window: these quotas are per-day by
// the vendors' own wording, and a rolling window would let a burst at 23:50 and another
// at 00:10 spend twice the day the vendor is counting.
const utcDay = () => new Date().toISOString().slice(0, 10);

const spent = new Map();
let day = utcDay();

/**
 * The declared ceiling, or 0 for "not decided", which means no throttling.
 *
 * A whole number or nothing: `parseInt` would read `1.9x` as a budget of one, and a
 * typo in a budget variable should cost a deployment its throttle, not hand it a
 * number it never wrote.
 *
 * @returns {number}
 */
export const dailyMax = () => {
    const raw = Number(process.env.TRUST_PROVIDER_DAILY_MAX ?? '');
    return Number.isInteger(raw) && raw > 0 ? raw : 0;
};

const rollover = () => {
    const today = utcDay();
    if (today === day) return;
    day = today;
    spent.clear();
};

/**
 * Whether this vendor is being skipped for budget reasons *before* the ask.
 *
 * @param {string} source
 * @returns {boolean}
 */
export const outOfBudget = (source) => {
    rollover();
    const max = dailyMax();
    return max > 0 && (spent.get(source) || 0) >= max;
};

/**
 * Charge one lookup to the vendor that was actually asked. The registry calls it
 * after the adapter returns, and skips the charge for an `unavailable` answer, so a
 * vendor with no key configured does not also eat the budget of the ones that
 * answered.
 *
 * @param {string} source
 */
export const recordAsk = (source) => {
    rollover();
    spent.set(source, (spent.get(source) || 0) + 1);
};

/**
 * How many lookups this process has charged to a vendor today. A status surface, and
 * the test's way of seeing the counter move.
 *
 * @param {string} source
 * @returns {number}
 */
export const spentToday = (source) => {
    rollover();
    return spent.get(source) || 0;
};

/**
 * Zero every counter. Tests start a day clean; the request path never calls it.
 *
 * @internal
 */
export const resetQuota = () => {
    spent.clear();
    day = utcDay();
};
