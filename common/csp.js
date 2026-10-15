// Content-Security-Policy for the SPA served by frontend-server.js
// (common/frontend-app.js), and for the same dist/ on backend-server.js.
//
// Shipped as `Content-Security-Policy-Report-Only` by default, so a missed
// origin shows up as a console report rather than a broken feature;
// `CSP_ENFORCE=1` sends the same policy as an enforcing header once real traffic
// has shown it is complete.
//
// What the allow-list is built from (the app as it is, not a wish list):
//   - script-src  'self' plus a sha256 hash of each inline <script> in the built
//                 dist/index.html (boot theme, PWA prompt, locale preload, boot
//                 quips), read at startup so a rebuild never needs a code edit;
//                 Google Analytics (googletagmanager), Firebase sign-in
//                 (apis.google.com), the invisibility probe
//                 (proxydetectjs.ipcheck.ing), and the GitBook embed from
//                 VITE_DOCS_URL when it is set.
//   - connect-src 'self' https: — scheme-wide on purpose. The connectivity test
//                 and its user-imported lists, the site-split probes, the
//                 /cdn-cgi/trace rule test, the DNS-leak and persona probes and
//                 the speed test all fetch hosts that are data, not code; no
//                 finite list can name them.
//   - img-src     'self' data: blob: https: — the DNS-leak test loads a probe
//                 image from a per-run hostname; screenshots and report export
//                 use data: / blob: URLs.
//   - style-src   'self' 'unsafe-inline' — index.html carries a style attribute
//                 and UI libraries inject <style> elements at runtime.
//   - worker-src  'self' blob: — Sentry Replay compresses in a blob: worker.
//   - frame-src   'self' plus the GitBook docs origin and the Firebase auth
//                 domain when configured (both render in an iframe).
//   - fonts are self-hosted (dist/fonts); Sentry goes through the same-origin
//                 /api/monitoring tunnel; the location map is /api/map.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Origins that are in the bundle whenever their feature is configured; listing
// them unconditionally costs nothing when the feature is off.
const STATIC_SCRIPT_ORIGINS = [
    'https://www.googletagmanager.com',
    'https://apis.google.com',
    'https://proxydetectjs.ipcheck.ing',
];

/**
 * The https origin of a configured URL or bare host, or '' for anything that is
 * empty or does not parse — an unset variable never reaches `new URL()` as such.
 *
 * @param {string|undefined} value
 * @returns {string}
 */
export const httpsOriginOf = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
        const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
        return url.protocol === 'https:' ? url.origin : '';
    } catch {
        return '';
    }
};

/**
 * sha256 source expressions for every inline (src-less) <script> in an HTML
 * document, hashed over the exact text between the tags as browsers do.
 *
 * @param {string} html
 * @returns {string[]}
 */
export const inlineScriptHashes = (html) => {
    const hashes = [];
    const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    for (const [, attributes, body] of String(html ?? '').matchAll(pattern)) {
        if (/\bsrc\s*=/i.test(attributes)) continue;
        hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    }
    return [...new Set(hashes)];
};

/**
 * The inline-script hashes of a built index.html, or none when it is missing
 * (a server started before `pnpm build` still answers, without inline scripts
 * being allowed).
 *
 * @param {string} indexPath
 * @returns {string[]}
 */
export const inlineScriptHashesOf = (indexPath) => {
    try {
        return inlineScriptHashes(readFileSync(indexPath, 'utf8'));
    } catch {
        return [];
    }
};

/**
 * @param {object} [options]
 * @param {string[]} [options.scriptHashes]  from inlineScriptHashesOf()
 * @param {object} [options.env]             process.env or a stand-in
 * @returns {string}
 */
export const buildCsp = ({ scriptHashes = [], env = {} } = {}) => {
    const docsOrigin = httpsOriginOf(env.VITE_DOCS_URL);
    const authOrigin = httpsOriginOf(env.VITE_FIREBASE_AUTH_DOMAIN);
    const reportUri = String(env.CSP_REPORT_URI ?? '').trim();

    const directives = [
        ['default-src', ["'self'"]],
        ['script-src', ["'self'", ...scriptHashes, ...STATIC_SCRIPT_ORIGINS, docsOrigin]],
        ['style-src', ["'self'", "'unsafe-inline'"]],
        ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
        ['font-src', ["'self'", 'data:']],
        ['connect-src', ["'self'", 'https:']],
        ['frame-src', ["'self'", docsOrigin, authOrigin]],
        ['worker-src', ["'self'", 'blob:']],
        ['manifest-src', ["'self'"]],
        ['object-src', ["'none'"]],
        ['base-uri', ["'self'"]],
        ['form-action', ["'self'"]],
        ['frame-ancestors', ["'self'"]],
    ];
    if (reportUri) directives.push(['report-uri', [reportUri]]);

    return directives
        .map(([name, sources]) => [name, ...new Set(sources.filter(Boolean))].join(' '))
        .join('; ');
};

// `CSP_ENFORCE=1` (or `true`) enforces; anything else, unset included, reports.
export const cspHeaderName = (env = {}) =>
    (/^(1|true)$/i.test(String(env.CSP_ENFORCE ?? '').trim())
        ? 'Content-Security-Policy'
        : 'Content-Security-Policy-Report-Only');

/**
 * Express middleware sending the policy on every response.
 *
 * @param {object} options
 * @param {string} options.indexPath  the built dist/index.html
 * @param {object} [options.env]
 */
export const cspMiddleware = ({ indexPath, env = {} }) => {
    const name = cspHeaderName(env);
    const value = buildCsp({ scriptHashes: inlineScriptHashesOf(indexPath), env });
    return (req, res, next) => {
        res.setHeader(name, value);
        next();
    };
};
