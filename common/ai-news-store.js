// Read-through cache in front of the AI news feeds.
//
// A visitor's request never fans out to ten publishers: the first request after
// the TTL refreshes every feed in parallel, concurrent requests share that one
// refresh, and everybody else reads memory. A feed that fails keeps its last good
// document (stale beats absent for a headline list), so one publisher's outage
// costs freshness for that publisher, not a row-less page.
//
// Injected `fetchText` keeps this file free of runtime imports — the Express
// route passes `fetchUpstream`, the edge function its own — so it is mirrored
// byte for byte into functions/shared/ and unit-tested with a stub.

import { AI_NEWS_FEEDS, mergeFeeds } from './ai-news.js';

export const AI_NEWS_TTL_MS = 30 * 60 * 1000;
// Feeds are small but some publishers are slow; one feed's ceiling, not the total.
export const AI_NEWS_FEED_TIMEOUT_MS = 10000;
// Larger than any feed in the list (OpenAI's full archive is ~0.8 MB); a document
// past this is refused rather than parsed.
export const AI_NEWS_MAX_BYTES = 3 * 1024 * 1024;

/**
 * @param {object} deps
 * @param {(url: string, init: object) => Promise<Response>} deps.fetchText
 * @param {(feed: object, error: unknown) => void} [deps.onFeedError]
 * @param {() => number} [deps.clock]
 * @param {number} [deps.ttlMs]
 */
export const createAiNewsStore = ({ fetchText, onFeedError = () => {}, clock = Date.now, ttlMs = AI_NEWS_TTL_MS, feeds = AI_NEWS_FEEDS }) => {
    const lastGood = new Map();
    let body = null;
    let fetchedAt = 0;
    let inFlight = null;

    const readFeed = async (feed) => {
        try {
            const res = await fetchText(feed.url, {
                timeoutMs: AI_NEWS_FEED_TIMEOUT_MS,
                headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8' },
            });
            if (!res.ok) throw new Error(`upstream ${res.status}`);
            const xml = await res.text();
            if (xml.length > AI_NEWS_MAX_BYTES) throw new Error('feed too large');
            if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error('not a feed');
            lastGood.set(feed.id, xml);
            return { feed, xml };
        } catch (error) {
            onFeedError(feed, error);
            return { feed, xml: lastGood.get(feed.id) ?? null, stale: lastGood.has(feed.id) };
        }
    };

    const refresh = async () => {
        const results = await Promise.all(feeds.map(readFeed));
        body = mergeFeeds(results, { now: new Date(clock()) });
        fetchedAt = clock();
        return body;
    };

    return {
        get: async () => {
            if (body && clock() - fetchedAt < ttlMs) return body;
            if (!inFlight) inFlight = refresh().finally(() => { inFlight = null; });
            return inFlight;
        },
    };
};
