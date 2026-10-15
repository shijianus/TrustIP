// Specs for the AI news feed module (common/ai-news.js) and its read-through
// cache (common/ai-news-store.js): RSS and Atom parsing, entity / CDATA / HTML
// handling, tagging, per-feed caps, the merge, and the cache's TTL, sharing and
// stale-on-error rules. Literal XML and a stubbed fetch — no network.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    AI_NEWS_FEEDS, parseFeed, plainText, clip, tagsFor, feedItems, mergeFeeds, decodeEntities,
    PER_FEED_LIMIT, MERGED_LIMIT,
} from '../common/ai-news.js';
import { createAiNewsStore } from '../common/ai-news-store.js';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>OpenAI News</title>
<item><title><![CDATA[Introducing GPT-6 for the API]]></title><link>https://openai.com/index/gpt-6/</link>
<pubDate>Wed, 14 Oct 2026 17:00:00 GMT</pubDate><description><![CDATA[<p>Our newest model &amp; tools.</p>]]></description></item>
<item><title>Older &amp; wiser</title><link>https://openai.com/index/older/</link><pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate>
<description>&lt;b&gt;escaped&lt;/b&gt; html summary</description></item>
<item><title>No link here</title><pubDate>Mon, 12 Oct 2026 09:00:00 GMT</pubDate></item>
<item><title>Bad scheme</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Release notes from claude-code</title>
<entry><title>v2.1.300</title><link rel="alternate" type="text/html" href="https://github.com/anthropics/claude-code/releases/tag/v2.1.300"/>
<updated>2026-10-15T02:00:00Z</updated><content type="html">&lt;ul&gt;&lt;li&gt;Fixed MCP reconnects&lt;/li&gt;&lt;/ul&gt;</content></entry>
<entry><title>v2.1.299</title><link rel="self" href="https://example.invalid/self"/><link href="https://github.com/anthropics/claude-code/releases/tag/v2.1.299"/>
<published>2026-10-13T02:00:00Z</published></entry>
</feed>`;

const feedOf = (id) => AI_NEWS_FEEDS.find((f) => f.id === id);

describe('AI_NEWS_FEEDS', () => {
    it('lists unique https feeds, the vendors the reference tags name among them', () => {
        const ids = AI_NEWS_FEEDS.map((f) => f.id);
        assert.equal(new Set(ids).size, ids.length);
        for (const f of AI_NEWS_FEEDS) assert.match(f.url, /^https:\/\//, f.id);
        for (const id of ['openai', 'anthropic', 'claude-code', 'codex', 'gemini', 'mcp']) assert.ok(ids.includes(id), id);
    });

    it('names the mirror for the one publisher without a feed of its own', () => {
        const thirdParty = AI_NEWS_FEEDS.filter((f) => !/openai\.com|github\.com\/(anthropics|openai)|deepmind\.google|blog\.google|modelcontextprotocol\.io|huggingface\.co|techcrunch\.com|theverge\.com/.test(f.url));
        assert.deepEqual(thirdParty.map((f) => f.id), ['anthropic']);
        assert.ok(feedOf('anthropic').via);
    });
});

describe('text helpers', () => {
    it('decodes named and numeric entities, leaves unknown ones', () => {
        assert.equal(decodeEntities('a &amp; b &#39;c&#39; &#x4E2D; &bogus;'), "a & b 'c' 中 &bogus;");
    });

    it('plainText unwraps CDATA, strips tags, handles escaped HTML and collapses space', () => {
        assert.equal(plainText('<![CDATA[<p>Hi&nbsp; <b>there</b></p>]]>'), 'Hi there');
        assert.equal(plainText('&lt;b&gt;escaped&lt;/b&gt; html'), 'escaped html');
        assert.equal(plainText('<script>alert(1)</script>ok'), 'ok');
    });

    it('clip cuts on a word boundary with an ellipsis', () => {
        assert.equal(clip('short', 10), 'short');
        const out = clip('alpha beta gamma delta epsilon', 18);
        assert.equal(out, 'alpha beta gamma…');
    });
});

describe('parseFeed', () => {
    it('reads RSS items and drops rows without an http(s) link', () => {
        const rows = parseFeed(RSS);
        assert.deepEqual(rows.map((r) => r.title), ['Introducing GPT-6 for the API', 'Older & wiser']);
        assert.equal(rows[0].link, 'https://openai.com/index/gpt-6/');
        assert.equal(rows[0].publishedAt, '2026-10-14T17:00:00.000Z');
        assert.equal(rows[0].summary, 'Our newest model & tools.');
        assert.equal(rows[1].summary, 'escaped html summary');
    });

    it('reads Atom entries, preferring the alternate link over rel=self', () => {
        const rows = parseFeed(ATOM);
        assert.equal(rows.length, 2);
        assert.equal(rows[0].link, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.300');
        assert.equal(rows[0].publishedAt, '2026-10-15T02:00:00.000Z');
        assert.equal(rows[0].summary, 'Fixed MCP reconnects');
        assert.equal(rows[1].link, 'https://github.com/anthropics/claude-code/releases/tag/v2.1.299');
    });

    it('answers an empty list for garbage', () => {
        assert.deepEqual(parseFeed('<html>nope</html>'), []);
        assert.deepEqual(parseFeed(null), []);
    });
});

describe('tagging and per-feed items', () => {
    it('adds headline tags after the feed\'s own, without duplicates', () => {
        assert.deepEqual(tagsFor({ tags: ['OpenAI'] }, 'Introducing GPT-6 for the API'), ['OpenAI', 'API']);
        assert.deepEqual(tagsFor({ tags: [] }, 'Claude Code adds MCP servers'), ['Claude Code', 'Claude', 'MCP']);
        assert.deepEqual(tagsFor({ tags: [] }, 'ChatGPT gets Codex'), ['Codex', 'ChatGPT']);
    });

    it('stamps source, sorts newest first and honours skip', () => {
        const items = feedItems(feedOf('claude-code'), ATOM);
        assert.equal(items[0].source, 'claude-code');
        assert.equal(items[0].sourceName, 'Claude Code');
        assert.deepEqual(items[0].tags.slice(0, 2), ['Claude', 'Claude Code']);
        const codex = feedItems(feedOf('codex'), ATOM.replace('v2.1.300', 'rust-v0.163.0-alpha.13'));
        assert.deepEqual(codex.map((i) => i.title), ['v2.1.299']);
    });

    it('caps a feed at PER_FEED_LIMIT', () => {
        const many = `<rss><channel>${Array.from({ length: 20 }, (_, i) => `<item><title>t${i}</title><link>https://x.test/${i}</link><pubDate>${new Date(Date.UTC(2026, 0, i + 1)).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
        const items = feedItems(feedOf('openai'), many);
        assert.equal(items.length, PER_FEED_LIMIT);
        assert.equal(items[0].title, 't19');
    });
});

describe('mergeFeeds', () => {
    it('merges newest first, dedupes links, counts tags and reports failed sources', () => {
        const body = mergeFeeds([
            { feed: feedOf('openai'), xml: RSS },
            { feed: feedOf('claude-code'), xml: ATOM },
            { feed: feedOf('anthropic'), xml: null },
            { feed: feedOf('codex'), xml: RSS }, // same links as openai → kept once
        ], { now: new Date('2026-10-15T03:00:00Z') });
        assert.equal(body.updatedAt, '2026-10-15T03:00:00.000Z');
        assert.deepEqual(body.items.map((i) => i.title), ['v2.1.300', 'Introducing GPT-6 for the API', 'v2.1.299', 'Older & wiser']);
        assert.deepEqual(body.sources.map((s) => [s.id, s.ok]), [['openai', true], ['claude-code', true], ['anthropic', false], ['codex', true]]);
        assert.equal(body.sources.find((s) => s.id === 'anthropic').via, feedOf('anthropic').via);
        const tags = Object.fromEntries(body.tags.map((t) => [t.tag, t.count]));
        assert.equal(tags.Claude, 2);
        assert.equal(tags.OpenAI, 2);
        assert.ok(body.items.length <= MERGED_LIMIT);
    });
});

describe('createAiNewsStore', () => {
    const okResponse = (text) => ({ ok: true, status: 200, text: async () => text });
    const feeds = [feedOf('openai'), feedOf('claude-code')];

    it('fetches every feed once per TTL and shares a refresh between concurrent callers', async () => {
        let now = 0;
        const calls = [];
        const store = createAiNewsStore({
            feeds, clock: () => now, ttlMs: 1000,
            fetchText: async (url) => { calls.push(url); return okResponse(url.includes('github') ? ATOM : RSS); },
        });
        const [a, b] = await Promise.all([store.get(), store.get()]);
        assert.equal(a, b);
        assert.equal(calls.length, 2);
        now = 500;
        await store.get();
        assert.equal(calls.length, 2);
        now = 1500;
        await store.get();
        assert.equal(calls.length, 4);
    });

    it('serves a failed feed\'s last good document and names the failure', async () => {
        let now = 0;
        let fail = false;
        const errors = [];
        const store = createAiNewsStore({
            feeds, clock: () => now, ttlMs: 10,
            onFeedError: (feed) => errors.push(feed.id),
            fetchText: async (url) => {
                if (fail && url.includes('openai')) return { ok: false, status: 503, text: async () => '' };
                return okResponse(url.includes('github') ? ATOM : RSS);
            },
        });
        await store.get();
        fail = true; now = 100;
        const body = await store.get();
        assert.deepEqual(errors, ['openai']);
        assert.ok(body.items.some((i) => i.source === 'openai'), 'stale openai rows kept');
        assert.equal(body.sources.find((s) => s.id === 'openai').ok, true);
    });

    it('refuses a document that is not a feed', async () => {
        const store = createAiNewsStore({
            feeds: [feedOf('openai')],
            fetchText: async () => okResponse('<html><body>captcha</body></html>'),
        });
        const body = await store.get();
        assert.equal(body.items.length, 0);
        assert.equal(body.sources[0].ok, false);
    });
});
