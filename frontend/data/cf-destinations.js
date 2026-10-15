// Cloudflare-fronted destinations the Cloudflare check reads `/cdn-cgi/trace`
// from, in table order.
//
// The point of the list is not "is the site up" but "is the edge that serves you
// the same edge for all of them" — a split tunnel that carries ChatGPT over a
// different PoP than the rest of the web is a routing fact, and the PoP code is
// where it shows. So every row must be a host that actually answers the trace
// with a wildcard CORS header from a browser: `discord.com` refuses it (403) and
// `github.com` is not on Cloudflare at all (404), which is why Discord is asked
// through its gateway host and GitHub is not here. The last three rows are
// Cloudflare's own networks a visitor can land on differently — the 1.1.1.1
// anycast (WARP / public DNS), the static-asset CDN and the Workers platform.
export const CF_PRIMARY_HOST = 'www.cloudflare.com';

export const CF_DESTINATIONS = [
  { host: 'www.cloudflare.com', labelKey: 'cfchk.Site.cf' },
  { host: 'speed.cloudflare.com', labelKey: 'cfchk.Site.speed' },
  { host: 'chatgpt.com', labelKey: 'cfchk.Site.chatgpt' },
  { host: 'claude.ai', labelKey: 'cfchk.Site.claude' },
  { host: 'gateway.discord.gg', labelKey: 'cfchk.Site.discord' },
  { host: '1.1.1.1', labelKey: 'cfchk.Site.warp' },
  { host: 'cdnjs.cloudflare.com', labelKey: 'cfchk.Site.cdnjs' },
  { host: 'workers.cloudflare.com', labelKey: 'cfchk.Site.workers' },
];
