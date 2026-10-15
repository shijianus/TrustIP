// /api/ai-news — headlines from the AI publishers' own RSS / Atom feeds, merged
// newest first (feed list, parser and merge in common/ai-news.js).
//
// Key-free: every feed is public. The upstream cost is bounded by the shared
// read-through cache (common/ai-news-store.js) — at most one fetch per feed per
// AI_NEWS_TTL_MS, whatever the request rate — so the route needs no per-request
// fan-out budget beyond its limiter. Always 200 with `sources` naming any feed it
// could not read; 502 only when no feed answered and nothing was cached.
import { fetchUpstream } from '../common/fetch-with-timeout.js';
import logger from '../common/logger.js';
import { createAiNewsStore } from '../common/ai-news-store.js';

const store = createAiNewsStore({
    fetchText: fetchUpstream,
    onFeedError: (feed, err) => logger.warn({ err, feed: feed.id }, 'ai-news: feed unavailable'),
});

export default async (req, res) => {
    try {
        const body = await store.get();
        if (!body.sources.some((s) => s.ok)) {
            return res.status(502).json({ error: 'Upstream request failed' });
        }
        res.json(body);
    } catch (error) {
        logger.error({ err: error }, 'ai-news handler failed');
        res.status(502).json({ error: 'Upstream request failed' });
    }
};
