// Upstream source-of-truth for the "Service Status" homepage section.
//
// Each provider exposes a status page that is API-compatible with the Atlassian
// Statuspage / incident.io schema — both expose the same
// `/api/v2/summary.json` + `/api/v2/incidents.json` endpoints. Cloudflare
// self-hosts a page that mirrors the same shape.
//
// `id`   — stable slug
// `name` — display name
// `api`  — origin we hit `${api}/api/v2/{summary,incidents}.json` against
// `page` — public status page; also the base for incident detail links
//          (`${page}/incidents/${incidentId}`), since incident.io's feed omits
//          a usable shortlink.
// `category` — the board's facet: ai · cloud · dev · social. Four buckets, the
//          same ones the reference board groups by, so the per-category tally
//          (`3/6 up`) reads the same on both.
// `components` — optional selector (see service-status-transform.js). A provider
//          that shares a page with its parent (SendGrid on Twilio's page) uses
//          `include` plus `ownIndicator`, so its light is computed from its own
//          rows rather than borrowed from the parent's page-wide indicator, and
//          only incidents touching those rows are kept.
//
// This list lives backend-side: the poller (common/service-status-store.js)
// walks it on a fixed schedule and caches the result in memory, so the
// upstream origins never reach the shipped frontend bundle.

export const STATUS_PROVIDERS = [
    // ── AI ──
    { id: 'claude', name: 'Claude', category: 'ai', api: 'https://status.claude.com', page: 'https://status.claude.com' },
    { id: 'chatgpt', name: 'ChatGPT', category: 'ai', api: 'https://status.openai.com', page: 'https://status.openai.com' },
    { id: 'cursor', name: 'Cursor', category: 'ai', api: 'https://status.cursor.com', page: 'https://status.cursor.com' },
    { id: 'elevenlabs', name: 'ElevenLabs', category: 'ai', api: 'https://status.elevenlabs.io', page: 'https://status.elevenlabs.io' },
    { id: 'groq', name: 'Groq', category: 'ai', api: 'https://groqstatus.com', page: 'https://groqstatus.com' },
    { id: 'perplexity', name: 'Perplexity', category: 'ai', api: 'https://status.perplexity.com', page: 'https://status.perplexity.com' },
    // ── Cloud ──
    // Default top-level: summary.json flattens away CF's mid-level product
    // categories, leaving one "Cloudflare Sites and Services" rollup + 7
    // continents — which keeps the card light consistent with this list.
    { id: 'cloudflare', name: 'Cloudflare', category: 'cloud', api: 'https://new.cloudflarestatus.com', page: 'https://new.cloudflarestatus.com' },
    { id: 'vercel', name: 'Vercel', category: 'cloud', api: 'https://www.vercel-status.com', page: 'https://www.vercel-status.com' },
    { id: 'netlify', name: 'Netlify', category: 'cloud', api: 'https://www.netlifystatus.com', page: 'https://www.netlifystatus.com' },
    { id: 'render', name: 'Render', category: 'cloud', api: 'https://status.render.com', page: 'https://status.render.com' },
    { id: 'supabase', name: 'Supabase', category: 'cloud', api: 'https://status.supabase.com', page: 'https://status.supabase.com' },
    { id: 'flyio', name: 'Fly.io', category: 'cloud', api: 'https://status.flyio.net', page: 'https://status.flyio.net' },
    { id: 'digitalocean', name: 'DigitalOcean', category: 'cloud', api: 'https://status.digitalocean.com', page: 'https://status.digitalocean.com' },
    // ── Developer & work tools ──
    // exclude: drop GitHub's "Visit … for more information" placeholder row.
    { id: 'github', name: 'GitHub', category: 'dev', api: 'https://www.githubstatus.com', page: 'https://www.githubstatus.com', components: { exclude: ['0l2p9nhqnxpd'] } },
    { id: 'npm', name: 'npm', category: 'dev', api: 'https://status.npmjs.org', page: 'https://status.npmjs.org' },
    { id: 'pypi', name: 'Python / PyPI', category: 'dev', api: 'https://status.python.org', page: 'https://status.python.org' },
    { id: 'sentry', name: 'Sentry', category: 'dev', api: 'https://status.sentry.io', page: 'https://status.sentry.io' },
    { id: 'postman', name: 'Postman', category: 'dev', api: 'https://status.postman.com', page: 'https://status.postman.com' },
    { id: 'clerk', name: 'Clerk', category: 'dev', api: 'https://status.clerk.com', page: 'https://status.clerk.com' },
    { id: 'twilio', name: 'Twilio', category: 'dev', api: 'https://status.twilio.com', page: 'https://status.twilio.com' },
    // status.sendgrid.com redirects to Twilio's page; SendGrid is the rows whose
    // names carry it, so its light and incidents come from those rows alone.
    {
        id: 'sendgrid', name: 'SendGrid', category: 'dev', api: 'https://status.twilio.com', page: 'https://status.twilio.com',
        components: { include: ['SendGrid Mail Sending', 'SendGrid Marketing Campaigns', 'SendGrid Webhooks', 'SendGrid API', 'SendGrid Website'], ownIndicator: true },
    },
    // status.atlassian.com is a page of pages (its summary carries no components),
    // so the Jira product page stands for the suite.
    { id: 'jira', name: 'Atlassian / Jira', category: 'dev', api: 'https://jira-software.status.atlassian.com', page: 'https://jira-software.status.atlassian.com' },
    { id: 'notion', name: 'Notion', category: 'dev', api: 'https://www.notion-status.com', page: 'https://www.notion-status.com' },
    { id: 'figma', name: 'Figma', category: 'dev', api: 'https://status.figma.com', page: 'https://status.figma.com' },
    { id: 'linear', name: 'Linear', category: 'dev', api: 'https://linearstatus.com', page: 'https://linearstatus.com' },
    // Stripe's customer-facing status.stripe.com is a homegrown page with a
    // non-Statuspage schema; www.stripestatus.com is its Statuspage mirror,
    // which exposes the /api/v2 endpoints this poller needs.
    { id: 'stripe', name: 'Stripe', category: 'dev', api: 'https://www.stripestatus.com', page: 'https://www.stripestatus.com' },
    // ── Social & media ──
    { id: 'discord', name: 'Discord', category: 'social', api: 'https://discordstatus.com', page: 'https://discordstatus.com' },
    { id: 'reddit', name: 'Reddit', category: 'social', api: 'https://www.redditstatus.com', page: 'https://www.redditstatus.com' },
    { id: 'twitch', name: 'Twitch', category: 'social', api: 'https://status.twitch.com', page: 'https://status.twitch.com' },
    { id: 'pinterest', name: 'Pinterest', category: 'social', api: 'https://www.pintereststatus.com', page: 'https://www.pintereststatus.com' },
    { id: 'zoom', name: 'Zoom', category: 'social', api: 'https://www.zoomstatus.com', page: 'https://www.zoomstatus.com' },
];

// The board's facets, in display order.
export const STATUS_CATEGORIES = ['ai', 'cloud', 'dev', 'social'];

// Whitelist used by requireValidProviderId() — the per-provider detail
// endpoints (components / incidents) take an `id` query param.
export const STATUS_PROVIDER_IDS = new Set(STATUS_PROVIDERS.map((p) => p.id));
