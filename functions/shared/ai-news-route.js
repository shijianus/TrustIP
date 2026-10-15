// The /api/ai-news read endpoint for the edge function, from api/ai-news.js.
//
// The store is built once per isolate, so a warm instance answers from memory for
// the TTL; a cold start reads the feeds again, which is the edge's documented
// scope for every cache here.

import { json } from './respond.js';
import { fetchUpstream } from './fetch-upstream.js';
import { createAiNewsStore } from './ai-news-store.js';

const THIRTY_MIN_CACHE = 30 * 60;

const store = createAiNewsStore({
    fetchText: fetchUpstream,
    onFeedError: (feed, error) => console.warn('[ai-news] feed unavailable', { feed: feed.id, error: error?.message }),
});

export default async () => {
    const body = await store.get();
    if (!body.sources.some((s) => s.ok)) return json({ error: 'Upstream request failed' }, { status: 502 });
    return json(body, { cacheSeconds: THIRTY_MIN_CACHE });
};
