// /api/ooni-blocking — per-country blocking view for a domain over the last
// 30 days, built from OONI's open aggregation API (web_connectivity test,
// probe_cc × blocking_type axes). Powers the default view of the frontend
// CensorshipCheck tool; classification lives in common/ooni-blocking.js.
//
// OONI matches `domain` against the exact tested hostname, so a single query
// misses most of the dataset (e.g. `bbc.com` has ~6 rows while `www.bbc.com`
// has 152 countries). We query the apex and www. variants in parallel and
// merge; one variant failing only degrades the merge, both failing is a 500.
//
// The date window is computed server-side and aligned to UTC days so the
// cache key (the URL) stays stable within a day — the route is wrapped in
// `cacheable()` and CF absorbs repeat lookups of popular domains.

import { fetchUpstream } from '../common/fetch-with-timeout.js';
import { classifyOoniCountries, OONI_WINDOW_DAYS } from '../common/ooni-blocking.js';
import logger from '../common/logger.js';

const OONI_AGGREGATION_URL = 'https://api.ooni.io/api/v1/aggregation';

// OONI builds a 30-day aggregation on demand: 3s for a quiet domain, 15–50s for
// a popular one (google.com ≈ 15s, twitter.com ≈ 49s measured from a US vantage),
// so the shared 8s upstream default turned every popular domain into a 500. The
// browser's request has no timeout of its own, so the bound that matters is this.
export const OONI_TIMEOUT_MS = 55000;

// The answer is a function of (domain, UTC day), and computing it costs OONI
// tens of seconds, so it is held in process for the day it describes — the edge
// cache does the same, but a self-hosted deployment has no edge. Concurrent asks
// for the same key share one upstream round trip. Bounded: a scanner walking
// domains evicts the oldest entry rather than growing the map.
const ANSWER_CACHE_MAX = 500;
const answers = new Map();

export const resetOoniCache = () => answers.clear();

const remember = (key, promise) => {
    if (answers.size >= ANSWER_CACHE_MAX) answers.delete(answers.keys().next().value);
    answers.set(key, promise);
    // A failure is not an answer: drop it so the next visitor asks again.
    promise.catch(() => { if (answers.get(key) === promise) answers.delete(key); });
    return promise;
};

const utcDay = (date) => date.toISOString().slice(0, 10);

const fetchAggregationOnce = async (hostname, since, until) => {
    const params = new URLSearchParams({
        domain: hostname,
        test_name: 'web_connectivity',
        since,
        until,
        axis_x: 'probe_cc',
        axis_y: 'blocking_type',
    });
    const response = await fetchUpstream(`${OONI_AGGREGATION_URL}?${params}`, { timeoutMs: OONI_TIMEOUT_MS });
    if (!response.ok) {
        throw new Error(`OONI aggregation responded with status ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data.result) ? data.result : [];
};

// OONI's API intermittently throws 5xx under load. Those fail fast, so one
// immediate retry usually rides out the blip. Timeouts (AbortError) are NOT
// retried — a saturated upstream would just cost the visitor another 8s.
const fetchAggregation = async (hostname, since, until) => {
    try {
        return await fetchAggregationOnce(hostname, since, until);
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        return await fetchAggregationOnce(hostname, since, until);
    }
};

export default async (req, res) => {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Presence, shape and lowercasing guaranteed by requireValidDomain.
    const domain = req.query.domain;
    const apex = domain.replace(/^www\./, '');
    const variants = [...new Set([apex, `www.${apex}`])];

    const now = new Date();
    const until = utcDay(now);
    const since = utcDay(new Date(now.getTime() - OONI_WINDOW_DAYS * 24 * 60 * 60 * 1000));

    try {
        const settled = await Promise.allSettled(variants.map((v) => {
            const key = `${v}|${since}|${until}`;
            return answers.get(key) ?? remember(key, fetchAggregation(v, since, until));
        }));
        const fulfilled = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
        if (fulfilled.length === 0) {
            throw settled[0].reason;
        }
        if (fulfilled.length < settled.length) {
            logger.warn({ domain }, 'ooni-blocking: one hostname variant query failed, serving partial merge');
        }
        res.json({
            domain: apex,
            since,
            until,
            countries: classifyOoniCountries(fulfilled.flat()),
        });
    } catch (error) {
        logger.error({ err: error, domain }, 'ooni-blocking handler failed');
        res.status(500).json({ error: 'Upstream request failed' });
    }
};
