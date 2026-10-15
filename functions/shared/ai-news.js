// The AI news feed: which publishers it reads, how their RSS / Atom is parsed,
// and how the per-feed lists merge into one newest-first timeline.
//
// Pure — no I/O, no logger — so the Express route (api/ai-news.js) and the edge
// function (functions/shared/ai-news-route.js) share it byte for byte
// (`tests/site-functions.test.js` pins the mirror) and every rule below is
// unit-tested with literal XML (`tests/ai-news.test.js`).
//
// What a row is: a headline the publisher syndicated in its own feed, the link
// back to the publisher's page, its date, and the first sentences of the feed's
// own summary. Nothing is rewritten and no article body is copied — a feed is
// published to be read this way, and the row always sends the reader to the
// source. Every feed below is the publisher's own, except Anthropic's: it ships
// no RSS, so its newsroom arrives through the community mirror named in `via`,
// and the row says so.

// One row per feed. `tags` are attached to every item of that feed; `TAG_RULES`
// adds topic tags from the headline itself. `skip` drops items whose title
// matches (pre-release builds would otherwise bury the release notes).
export const AI_NEWS_FEEDS = [
    { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml', tags: ['OpenAI'] },
    {
        id: 'anthropic', name: 'Anthropic', url: 'https://raw.githubusercontent.com/Olshansk/rss-feeds/main/feeds/feed_anthropic_news.xml',
        tags: ['Claude'], via: 'github.com/Olshansk/rss-feeds',
    },
    { id: 'claude-code', name: 'Claude Code', url: 'https://github.com/anthropics/claude-code/releases.atom', tags: ['Claude', 'Claude Code'] },
    { id: 'codex', name: 'OpenAI Codex', url: 'https://github.com/openai/codex/releases.atom', tags: ['OpenAI', 'Codex'], skip: /alpha|beta|-rc/i },
    { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', tags: ['Gemini'] },
    { id: 'gemini', name: 'Google Gemini', url: 'https://blog.google/products/gemini/rss/', tags: ['Gemini'] },
    { id: 'mcp', name: 'Model Context Protocol', url: 'https://blog.modelcontextprotocol.io/index.xml', tags: ['MCP'] },
    { id: 'huggingface', name: 'Hugging Face', url: 'https://huggingface.co/blog/feed.xml', tags: [] },
    { id: 'techcrunch', name: 'TechCrunch AI', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', tags: [] },
    { id: 'theverge', name: 'The Verge AI', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', tags: [] },
];

export const AI_NEWS_FEED_IDS = new Set(AI_NEWS_FEEDS.map((f) => f.id));

// Topic tags read from the headline, the reference site's tag row.
export const TAG_RULES = [
    ['Claude Code', /\bclaude code\b/i],
    ['Claude', /\b(claude|anthropic)\b/i],
    ['Codex', /\bcodex\b/i],
    ['ChatGPT', /\bchatgpt\b/i],
    ['OpenAI', /\b(openai|gpt-?\d|sora)\b/i],
    ['Gemini', /\b(gemini|deepmind)\b/i],
    ['MCP', /\b(mcp|model context protocol)\b/i],
    ['API', /\bapi\b/i],
];

// How many items each feed contributes, and how many rows the merged list keeps.
// A feed that posts ten times a day must not push a monthly one off the page.
export const PER_FEED_LIMIT = 8;
export const MERGED_LIMIT = 60;
export const SUMMARY_MAX = 240;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// XML / HTML entity decoding for the five named ones plus numeric references.
export const decodeEntities = (text) => String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match);

const safeCodePoint = (n) => {
    try { return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : ''; } catch { return ''; }
};

const unwrapCdata = (text) => String(text ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

// Feed text → plain text: CDATA unwrapped, entities decoded (twice — summaries
// often carry escaped HTML), tags stripped, whitespace collapsed.
export const plainText = (raw) => {
    const once = decodeEntities(unwrapCdata(raw));
    const html = /<[a-z!/]/i.test(once) ? once : decodeEntities(once);
    return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
};

// Cut at a word boundary under `max` characters, with an ellipsis when cut.
export const clip = (text, max = SUMMARY_MAX) => {
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(' ');
    return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
};

const firstTag = (block, names) => {
    for (const name of names) {
        const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
        const m = block.match(re);
        if (m) return m[1];
    }
    return null;
};

// Atom carries the link as an attribute; prefer rel="alternate" (or no rel).
const atomLink = (block) => {
    const links = [...block.matchAll(/<link\b([^>]*?)\/?>/gi)].map((m) => m[1]);
    const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;
    const alternate = links.find((a) => attr(a, 'href') && (!attr(a, 'rel') || attr(a, 'rel') === 'alternate'));
    return alternate ? attr(alternate, 'href') : null;
};

const isHttpUrl = (value) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
};

const toIso = (raw) => {
    const ms = Date.parse(plainText(raw ?? ''));
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

/**
 * Parse an RSS 2.0 or Atom document into `{ title, link, publishedAt, summary }`
 * rows, document order. Malformed items (no title, or no http(s) link) are
 * dropped rather than shown as a row that leads nowhere.
 */
export const parseFeed = (xml) => {
    const text = String(xml ?? '');
    const blocks = [...text.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
    return blocks.map((block) => {
        const title = plainText(firstTag(block, ['title']) ?? '');
        const rssLink = plainText(firstTag(block, ['link']) ?? '');
        const link = isHttpUrl(rssLink) ? rssLink : atomLink(block);
        const publishedAt = toIso(firstTag(block, ['pubDate', 'published', 'dc:date', 'updated']));
        const summary = clip(plainText(firstTag(block, ['description', 'summary', 'content:encoded', 'content']) ?? ''));
        return { title, link: link ? decodeEntities(link) : null, publishedAt, summary };
    }).filter((row) => row.title && row.link && isHttpUrl(row.link));
};

// Feed tags plus headline tags, de-duplicated, in TAG_RULES order after the feed's own.
export const tagsFor = (feed, title) => {
    const tags = new Set(feed.tags || []);
    for (const [tag, re] of TAG_RULES) if (re.test(title)) tags.add(tag);
    return [...tags];
};

/**
 * One feed's rows, newest first, capped, tagged and stamped with the source.
 */
export const feedItems = (feed, xml, limit = PER_FEED_LIMIT) => parseFeed(xml)
    .filter((row) => !(feed.skip && feed.skip.test(row.title)))
    .sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0))
    .slice(0, limit)
    .map((row) => ({
        id: `${feed.id}:${row.link}`,
        source: feed.id,
        sourceName: feed.name,
        via: feed.via ?? null,
        title: row.title,
        link: row.link,
        publishedAt: row.publishedAt,
        summary: row.summary,
        tags: tagsFor(feed, row.title),
    }));

/**
 * Merge per-feed results into the response body.
 *
 * `results` is `[{ feed, xml | null, error? }]` in AI_NEWS_FEEDS order. A failed
 * feed contributes no rows but stays in `sources` with `ok: false`, so the page can
 * say which publisher it could not read instead of quietly shrinking. Rows are
 * newest first; an undated row sorts last. The same link published by two feeds
 * is kept once.
 */
export const mergeFeeds = (results, { now = new Date(), limit = MERGED_LIMIT } = {}) => {
    const seen = new Set();
    const items = results
        .flatMap(({ feed, xml }) => (xml ? feedItems(feed, xml) : []))
        .sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0))
        .filter((item) => (seen.has(item.link) ? false : seen.add(item.link)))
        .slice(0, limit);
    const tagCounts = new Map();
    for (const item of items) for (const tag of item.tags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    return {
        updatedAt: now.toISOString(),
        items,
        tags: TAG_RULES.map(([tag]) => tag).filter((tag) => tagCounts.has(tag))
            .map((tag) => ({ tag, count: tagCounts.get(tag) })),
        sources: results.map(({ feed, xml }) => ({
            id: feed.id, name: feed.name, via: feed.via ?? null, ok: Boolean(xml),
            count: items.filter((i) => i.source === feed.id).length,
        })),
    };
};
