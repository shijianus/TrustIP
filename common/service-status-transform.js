// Pure, network-free normalizers for the Statuspage / incident.io schema.
//
// Both `summary.json` and `incidents.json` share the same shape across every
// provider we track, so a single pair of transforms covers all of them. Kept
// dependency-free and side-effect-free so they're unit-testable with inline
// fixtures (tests/service-status-transform.test.js) — no live upstream calls.

// Safety cap on forwarded components — a guard against a pathological page
// bloating the payload. Selected lists are normally well under this.
const COMPONENT_LIMIT = 40;

// Pick which components a provider exposes (vendors structure pages too
// differently for one rule to fit all). Per-provider selector — see STATUS_PROVIDERS:
//   (default)            top-level rows: group headers + ungrouped components
//   { flatten: true }    every leaf, group headers dropped
//   { include: [names] } ordered whitelist by component name
//   { exclude: [id|name] } final filter on top of any mode (drops junk rows)
//   { ownIndicator: true } the light is derived from the picked rows instead of
//                        the page-wide indicator (a product sharing its parent's
//                        page — see `componentsIndicator`)
function selectComponents(raw, selector = {}) {
    let picked;
    if (Array.isArray(selector.include)) {
        const byName = new Map(raw.filter((c) => !c?.group).map((c) => [c?.name, c]));
        picked = selector.include.map((name) => byName.get(name)).filter(Boolean);
    } else if (selector.flatten) {
        picked = raw.filter((c) => !c?.group); // all leaves, drop group headers
    } else {
        picked = raw.filter((c) => !c?.group_id); // top-level rows
    }

    if (Array.isArray(selector.exclude) && selector.exclude.length) {
        const blocked = new Set(selector.exclude);
        picked = picked.filter((c) => !blocked.has(c?.id) && !blocked.has(c?.name));
    }
    return picked;
}

// Normalize a `/api/v2/summary.json` payload to
//   { indicator, components: [{ name, status }] }
// where indicator is 'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown'.
// `selector` chooses which components to keep (see selectComponents).
export function normalizeSummary(json, selector = {}) {
    const raw = Array.isArray(json?.components) ? json.components : [];
    const components = selectComponents(raw, selector)
        .slice(0, COMPONENT_LIMIT)
        .map((c) => ({ name: c?.name ?? '', status: c?.status ?? 'operational' }));

    const indicator = selector.ownIndicator
        ? (json ? componentsIndicator(components) : 'unknown')
        : (json?.status?.indicator || 'unknown');
    return { indicator, components };
}

// Component status → page indicator, the mapping Statuspage itself applies when
// it rolls rows up into the page light. The worst row wins.
const COMPONENT_SEVERITY = {
    operational: 0, under_maintenance: 1, degraded_performance: 2, partial_outage: 3, major_outage: 4,
};
const SEVERITY_INDICATOR = ['none', 'maintenance', 'minor', 'major', 'critical'];

// The light of a set of rows. An empty set is `unknown` — the rows the selector
// asked for are not on the page, which says nothing about whether they are up.
export const componentsIndicator = (components) => {
    if (!components?.length) return 'unknown';
    const worst = Math.max(...components.map((c) => COMPONENT_SEVERITY[c.status] ?? 0));
    return SEVERITY_INDICATOR[worst];
};

// Normalize a `/api/v2/incidents.json` payload to the most recent `limit`
// incidents. Upstream already returns them newest-first.
//
// `pageUrl` is the provider's status-page origin; each incident's detail link
// is built as `${pageUrl}/incidents/${id}`. We construct it rather than trust
// the feed's `shortlink` because incident.io pages (ChatGPT(OpenAI), Notion) omit it —
// their feed otherwise points only at the page root, not the incident.
//
// Returns: [{ id, name, status, impact, startedAt, url }]
//
// Sorted newest-first by `startedAt` (the timestamp we display) before
// capping, NOT by upstream order: incident.io feeds (ChatGPT(OpenAI), Notion) leave
// `started_at` null and order by `updated_at`, so the `created_at` we fall
// back to would otherwise render out of chronological order in the UI.
//
// `componentNames`, when given, keeps only incidents that name at least one of
// those components — how a product sharing its parent's page (SendGrid on
// Twilio's) keeps only its own incidents.
export function normalizeIncidents(json, { limit = 10, pageUrl = '', componentNames = null } = {}) {
    const base = String(pageUrl).replace(/\/+$/, ''); // trim trailing slash(es)
    const all = Array.isArray(json?.incidents) ? json.incidents : [];
    const wanted = Array.isArray(componentNames) ? new Set(componentNames) : null;
    const incidents = wanted
        ? all.filter((i) => (Array.isArray(i?.components) ? i.components : []).some((c) => wanted.has(c?.name)))
        : all;
    return incidents
        .map((i) => {
            const id = i?.id ?? null;
            return {
                id,
                name: i?.name ?? '',
                status: i?.status ?? null,
                impact: i?.impact ?? 'none',
                // `started_at` is the canonical start; fall back to created_at.
                startedAt: i?.started_at ?? i?.created_at ?? null,
                // A feed that names its own incident page (the RSS adapter
                // below) is linked there; Statuspage JSON carries no `link`.
                url: typeof i?.link === 'string' && /^https:\/\//.test(i.link) ? i.link
                    : id && base ? `${base}/incidents/${id}` : (base || null),
            };
        })
        .sort((a, b) => incidentTimestamp(b) - incidentTimestamp(a))
        .slice(0, limit);
}

// Parse an incident's display timestamp to a comparable number; missing /
// unparseable dates sort oldest (0) so they fall to the bottom of the list.
function incidentTimestamp(incident) {
    if (!incident.startedAt) return 0;
    const ms = Date.parse(incident.startedAt);
    return Number.isNaN(ms) ? 0 : ms;
}

// Combine one provider's config with its (possibly null) summary + incidents
// payloads into the shape the frontend consumes. Pure: a null payload (failed
// fetch) degrades gracefully — normalizeSummary(null) → indicator 'unknown'
// with no components, normalizeIncidents(null) → []. Keeps the poller's
// per-provider error handling free of shape-building logic.
//
// `lastIncidentAt` is the newest incident's start (or null) — the board's
// "last incident 2 days ago" line, carried on the light overview so the cards can
// show it without a detail read each.
export function assembleProvider(provider, summaryJson, incidentsJson) {
    const { indicator, components } = normalizeSummary(summaryJson, provider.components);
    const include = provider.components?.ownIndicator ? provider.components.include : null;
    const incidents = normalizeIncidents(incidentsJson, { pageUrl: provider.page, componentNames: include });
    return {
        id: provider.id,
        name: provider.name,
        page: provider.page,
        category: provider.category ?? null,
        indicator,
        components,
        incidents,
        lastIncidentAt: incidents.find((i) => i.startedAt)?.startedAt ?? null,
    };
}

// How bad a light is, for ordering: an outage outranks a degradation, which
// outranks maintenance, which outranks `unknown` (no reading is not a fault),
// which outranks green.
const INDICATOR_RANK = { critical: 5, major: 4, minor: 3, maintenance: 2, unknown: 1, none: 0 };
export const indicatorRank = (indicator) => INDICATOR_RANK[indicator] ?? INDICATOR_RANK.unknown;

// The board's order: providers with a fault pinned on top, worst first; ties —
// and every green provider — keep the catalog order, which is grouped by
// category. Stable and pure, so both the overview and the UI can apply it.
export const orderByIndicator = (providers) => providers
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
        const ra = indicatorRank(a.p.indicator) >= INDICATOR_RANK.maintenance ? indicatorRank(a.p.indicator) : 0;
        const rb = indicatorRank(b.p.indicator) >= INDICATOR_RANK.maintenance ? indicatorRank(b.p.indicator) : 0;
        return rb - ra || a.i - b.i;
    })
    .map(({ p }) => p);

// Per-category tally for the board's header row: `{ id, total, up, faults }` in
// the order `categories` lists them. `up` counts green lights only; `faults`
// counts minor and worse (maintenance and `unknown` are neither up nor a fault),
// so `up + faults` may be less than `total` and the row says so honestly.
export const categoryTally = (providers, categories) => categories
    .map((id) => {
        const members = providers.filter((p) => p.category === id);
        return {
            id,
            total: members.length,
            up: members.filter((p) => p.indicator === 'none').length,
            faults: members.filter((p) => indicatorRank(p.indicator) >= INDICATOR_RANK.minor).length,
        };
    })
    .filter((row) => row.total > 0);

// ── RSS status feeds ────────────────────────────────────────────────────────
//
// A provider whose official status page publishes an incident RSS feed but no
// Statuspage API (status.x.ai) is described with `format: 'rss'`; the poller
// fetches `${api}/feed.xml` and this adapter turns it into the summary +
// incidents pair the transforms above read, so nothing downstream knows.
//
// Each <item> is one incident. Its <category> tags carry the severity
// (`outage`, `disruption`, `degraded`, `maintenance`) and, once over,
// `resolved` / `completed`. The light is the worst severity among items not
// yet over — an empty set of open items is 'none', the feed's own statement
// that nothing is ongoing. A body with no <rss>/<channel> is not a feed: null,
// which the poller reads as a failed fetch ('unknown' / last-known-good).

const RSS_SEVERITY = { outage: 'major', disruption: 'minor', degraded: 'minor', maintenance: 'maintenance' };
const RSS_DONE = new Set(['resolved', 'completed', 'postmortem']);
const INDICATOR_ORDER = ['none', 'maintenance', 'minor', 'major', 'critical'];

const xmlText = (block, tag) => {
    const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    if (!m) return null;
    return m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim()
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
};

export function rssToStatuspage(xml) {
    if (typeof xml !== 'string' || !/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) return null;
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
    let worst = 0;
    const incidents = items.map((block) => {
        const categories = [...block.matchAll(/<category>([\s\S]*?)<\/category>/gi)].map((m) => m[1].trim().toLowerCase());
        const done = categories.some((c) => RSS_DONE.has(c));
        const severity = categories.map((c) => RSS_SEVERITY[c]).find(Boolean) || 'minor';
        if (!done) worst = Math.max(worst, INDICATOR_ORDER.indexOf(severity));
        const published = Date.parse(xmlText(block, 'pubDate') || '');
        return {
            id: xmlText(block, 'guid'),
            name: xmlText(block, 'title') || '',
            status: done ? 'resolved' : 'investigating',
            impact: severity === 'maintenance' ? 'maintenance' : severity,
            started_at: Number.isNaN(published) ? null : new Date(published).toISOString(),
            link: xmlText(block, 'link'),
        };
    });
    return {
        summary: { status: { indicator: INDICATOR_ORDER[worst] }, components: [] },
        incidents: { incidents },
    };
}
