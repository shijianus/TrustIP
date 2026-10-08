// The latency strip under "my IP": which six destinations to time, how many
// samples each takes, and what colour a given round trip is.
//
// This is the homepage's own connectivity overview, not the routing table — the
// table's destinations are decided on the server and are deliberately absent from
// the frontend bundle (see `api/split.js`). These six are shown to every visitor
// whatever their network, so they can ship in the page.
//
// Each host is reachable enough to time: a `no-cors` request to any of them
// resolves or fails in a way that measures the path, whatever the status code
// turns out to be.
//
// [name, host, flag country, committed icon id under public/favicons/]
//
// The icon is named for the brand, not derived from the host: WeChat is tested
// at weixin.qq.com and Cloudflare at 1.1.1.1, and neither host reads as the
// name the row shows. Same-origin files for the same reason the routing table
// uses them — an icon that has to come from the site being tested cannot draw
// for a visitor whose network is blocking it.
export const CONNECTIVITY_PROBES = [
    { name: 'Tencent', host: 'www.qq.com', country: 'CN', icon: 'qq' },
    { name: 'Taobao', host: 'www.taobao.com', country: 'CN', icon: 'taobao' },
    { name: 'WeChat', host: 'weixin.qq.com', country: 'CN', icon: 'wechat' },
    { name: 'GitHub', host: 'github.com', country: 'US', icon: 'github' },
    { name: 'Cloudflare', host: '1.1.1.1', country: 'US', icon: 'cloudflare' },
    { name: 'YouTube', host: 'www.youtube.com', country: 'US', icon: 'youtube' },
];

// Samples per probe. Twelve is what the strip's dot row holds, and a
// connection's variance is the thing worth showing — one number would hide
// that the first packet of a cold path is always the slowest.
export const PROBE_SAMPLES = 12;

// Millisecond ceilings for the three dot colours, shared with the strip's number
// so a green dot and a green figure mean the same thing.
export const PROBE_TONES = [
    { ceiling: 100, tone: 'ok-fast' },
    { ceiling: 300, tone: 'ok-slow' },
    { ceiling: Infinity, tone: 'fail' },
];

export const probeTone = (ms) => PROBE_TONES.find((t) => ms < t.ceiling).tone;
