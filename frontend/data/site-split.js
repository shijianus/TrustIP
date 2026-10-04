// The site list behind the homepage's IP-routing table.
//
// Every row answers one question — "when this browser reaches *this* service,
// which address leaves the network?" — and Chinese-accessing users are the
// people who need it, because their split routing sends mainland domains out
// one exit and everything else out another. The answer comes from Cloudflare's
// `/cdn-cgi/trace`, which echoes the caller's observed address as plain text
// with `Access-Control-Allow-Origin: *`, so the measurement happens in the
// browser against the real destination and this server carries none of it.
//
// Which matters for what is NOT here: a host only belongs in this list if it
// sits behind Cloudflare and answers `/cdn-cgi/trace`. Every entry below was
// checked against that endpoint. A site on its own edge (Google, Facebook,
// Bilibili, Taobao) has no such echo, and probing it would yield a permanent
// "unknown" that reads as a network fault rather than as an unavailable
// measurement — so those stay out.
//
// `group` is the row's coloured tag and `region` the domestic/international
// one, which is the pairing that actually surfaces a split: two rows in the
// same group egressing at different addresses is the finding.

// [name, host, group, region]
export const SPLIT_SITES = [
    // Mainland-fronted services — the side a split is measured against. These
    // two are the only entries whose Cloudflare edge answers inside China.
    ['Cloudflare China', 'www.cloudflare-cn.com', 'Speed', 'domestic'],
    ['Qualcomm China', 'www.qualcomm.cn', 'Dev', 'domestic'],

    // AI
    ['Claude', 'claude.ai', 'AI', 'international'],
    ['Anthropic', 'anthropic.com', 'AI', 'international'],
    ['ChatGPT', 'chatgpt.com', 'AI', 'international'],
    ['OpenAI Sora', 'sora.com', 'AI', 'international'],
    ['Grok', 'grok.com', 'AI', 'international'],
    ['Perplexity', 'www.perplexity.ai', 'AI', 'international'],
    ['Midjourney', 'midjourney.com', 'AI', 'international'],
    ['Mistral', 'mistral.ai', 'AI', 'international'],
    ['Poe', 'poe.com', 'AI', 'international'],

    // Social
    ['X', 'x.com', 'Social', 'international'],
    ['Discord', 'gateway.discord.gg', 'Social', 'international'],
    ['Signal', 'signal.org', 'Social', 'international'],
    ['Medium', 'medium.com', 'Social', 'international'],
    ['Quora', 'www.quora.com', 'Social', 'international'],
    ['V2EX', 'v2ex.com', 'Media', 'international'],
    ['Crunchyroll', 'www.crunchyroll.com', 'Media', 'international'],

    // Crypto
    ['Coinbase', 'coinbase.com', 'Crypto', 'international'],
    ['OKX', 'www.okx.com', 'Crypto', 'international'],
    ['Binance', 'www.binance.info', 'Crypto', 'international'],
    ['Crypto.com', 'crypto.com', 'Crypto', 'international'],

    // Developer infrastructure
    ['Render', 'render.com', 'Dev', 'international'],
    ['npm Registry', 'registry.npmjs.org', 'Dev', 'international'],
    ['npm Website', 'www.npmjs.com', 'Dev', 'international'],
    ['Node.js', 'nodejs.org', 'Dev', 'international'],
    ['GitLab', 'gitlab.com', 'Dev', 'international'],
    ['Docker Hub', 'hub.docker.com', 'Dev', 'international'],
    ['Stack Overflow', 'stackoverflow.com', 'Dev', 'international'],
    ['Kali Linux', 'www.kali.org', 'Dev', 'international'],
    ['DigitalOcean', 'digitalocean.com', 'Dev', 'international'],

    // Static / CDN endpoints — the ones a page's assets actually come from.
    ['Cloudflare', 'www.cloudflare.com', 'Speed', 'international'],
    ['Cloudflare DNS', 'one.one.one.one', 'Speed', 'international'],
    ['jsDelivr', 'cdn.jsdelivr.net', 'Static', 'international'],
    ['unpkg', 'unpkg.com', 'Static', 'international'],

    // Tools and commerce
    ['Zoom', 'zoom.us', 'Tools', 'international'],
    ['1Password', '1password.com', 'Tools', 'international'],
    ['Wise', 'wise.com', 'Tools', 'international'],
    ['Notion', 'www.notion.so', 'Tools', 'international'],
    ['Shopify', 'shopify.com', 'Tools', 'international'],
    ['GoDaddy', 'godaddy.com', 'Tools', 'international'],
    ['Namecheap', 'www.namecheap.com', 'Tools', 'international'],
    ['Product Hunt', 'www.producthunt.com', 'Tools', 'international'],
    ['ipify', 'api.ipify.org', 'Speed', 'international'],
].map(([name, host, group, region]) => ({ name, host, group, region }));

// The latency strip under "my IP". These are the endpoints a visitor in China
// cares about most, and each is reachable enough to time: a `no-cors` request
// to any of them resolves or fails in a way that measures the path, whatever
// the status code turns out to be.
//
// [name, probe URL, flag country]
export const CONNECTIVITY_PROBES = [
    { name: 'Tencent', host: 'www.qq.com', country: 'CN' },
    { name: 'Taobao', host: 'www.taobao.com', country: 'CN' },
    { name: 'WeChat', host: 'weixin.qq.com', country: 'CN' },
    { name: 'GitHub', host: 'github.com', country: 'US' },
    { name: 'Cloudflare', host: '1.1.1.1', country: 'US' },
    { name: 'YouTube', host: 'www.youtube.com', country: 'US' },
];

// Samples per probe. Twelve is what the strip's dot row holds, and a
// connection's variance is the thing worth showing — one number would hide
// that the first packet of a cold path is always the slowest.
export const PROBE_SAMPLES = 12;

// Millisecond ceilings for the three dot colours, shared with the latency
// strip's number so a green dot and a green figure mean the same thing.
export const PROBE_TONES = [
    { ceiling: 100, tone: 'ok-fast' },
    { ceiling: 300, tone: 'ok-slow' },
    { ceiling: Infinity, tone: 'fail' },
];

export const probeTone = (ms) => PROBE_TONES.find((t) => ms < t.ceiling).tone;
