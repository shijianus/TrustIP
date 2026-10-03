// Backend-only User-Agent bootstrap for fetchUpstream.
//
// Some upstream WAFs (e.g. Cloudflare's status page) hard-block undici's
// default `User-Agent: node`, so server-to-server calls identify themselves
// as `TrustIP/v<version>/<site-url>` instead. Version comes from package.json;
// the site segment from VITE_SITE_URL, so forks advertise their own
// deployment rather than the canonical site. Lives outside
// fetch-with-timeout.js on purpose: that module is shared with the browser
// bundle and must stay free of fs / process access.

import { readFileSync } from 'node:fs';

import { setUpstreamUserAgent } from './fetch-with-timeout.js';

// Build and register the UA. Called from backend-server.js after
// dotenv.config() so VITE_SITE_URL from .env is visible — module import
// time would be too early (imports are hoisted above the config call).
// Missing pieces degrade gracefully: `TrustIP/v0.1.0`, or just `TrustIP`.
export const initUpstreamUserAgent = () => {
    let version = '';
    try {
        version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || '';
    } catch {
        // Unreadable package.json → versionless UA.
    }
    const site = (process.env.VITE_SITE_URL || '').trim();
    const ua = ['TrustIP', version && `v${version}`, site].filter(Boolean).join('/');
    setUpstreamUserAgent(ua);
    return ua;
};
