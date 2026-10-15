// The Express app frontend-server.js serves (`pnpm start`, pm2, Docker): the /api
// proxy to the backend, dist/ with per-asset-class caching, the SPA history
// fallback, a Content-Security-Policy (common/csp.js), and uncacheable answers
// for everything that fails. Built by a factory
// so specs can mount it on an ephemeral port against a throwaway dist/.

import express from 'express';
import path from 'path';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { securityHeaders } from './security-headers.js';
import { apiProxyOptions } from './frontend-proxy.js';
import { noStore } from './cache-control.js';
import { cspMiddleware } from './csp.js';

// Root-level SEO / AI-engine surfaces
const SEO_SURFACES = new Set(['llms.txt', 'llms-full.txt', 'sitemap.xml', 'robots.txt']);

/**
 * @param {object} options
 * @param {string} options.distDir      the built front-end
 * @param {number} options.backEndPort  where the /api proxy points
 * @param {object} [options.env]        process.env or a stand-in (CSP_ENFORCE,
 *                                      CSP_REPORT_URI, VITE_DOCS_URL,
 *                                      VITE_FIREBASE_AUTH_DOMAIN; common/csp.js)
 * @returns {import('express').Express}
 */
export const createFrontendApp = ({ distDir, backEndPort, env = {} }) => {
    const frontendApp = express();
    frontendApp.disable('x-powered-by');
    frontendApp.use(securityHeaders);
    // Report-Only unless CSP_ENFORCE=1; inline scripts are allowed by the hashes
    // of the dist/index.html this process starts with.
    frontendApp.use(cspMiddleware({ indexPath: path.join(distDir, 'index.html'), env }));

    // API Proxy to backend server; X-Forwarded-For is overwritten with the socket
    // peer (common/frontend-proxy.js). no-store first: the backend's own
    // Cache-Control replaces it on every proxied answer, so it only survives on
    // the proxy's own failure (504 with the backend down).
    frontendApp.use('/api', noStore, createProxyMiddleware(apiProxyOptions(backEndPort)));

    // Set static file directory.
    // Cache-Control is set per-asset class so the static layer behaves well
    // even when no CDN sits in front of it (CF in production sets its own
    // Browser TTL on top of these, so the longer values are upper bounds):
    //   - dist/assets/**       Vite-hashed JS/CSS/images — content-addressed → 1y immutable
    //   - dist/fonts/**        non-hashed but essentially never change → 1y immutable
    //   - favicons/**          connectivity-target icons → 30d; not hashed,
    //                          but a changed icon ships under a new member id
    //                          (= new filename), so long caching is safe
    //   - non-hashed images    favicon / logos / achievements / … → 7d
    //                          (any depth; not content-hashed, so changing one
    //                          of these images requires renaming the file)
    //   - HTML + manifest +    24h at the edge (s-maxage), zero in browsers — the
    //     SEO surfaces         build's postbuild purge evicts them on deploy, so
    //                          the TTL only caps drift between deploys and no
    //                          browser copy outlives a purge; manifest references
    //                          only stable /logos/* paths, so a stale copy never
    //                          points at dead assets
    //   - everything else      (ads.txt, …) → 1h
    const setStaticHeaders = (res, filePath) => {
        const rel = path.relative(distDir, filePath).replaceAll(path.sep, '/');

        if (rel.startsWith('assets/') || rel.startsWith('fonts/')) {
            res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60 * 365}, immutable`);
        } else if (rel.startsWith('favicons/')) {
            res.setHeader('Cache-Control', `public, max-age=${30 * 24 * 60 * 60}`);
        } else if (/\.(png|jpg|jpeg|webp|svg|ico)$/i.test(rel)) {
            res.setHeader('Cache-Control', `public, max-age=${7 * 24 * 60 * 60}`);
        } else if (rel.endsWith('.html') || rel === 'manifest.webmanifest' || SEO_SURFACES.has(rel)) {
            res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${24 * 60 * 60}, must-revalidate`);
        } else {
            res.setHeader('Cache-Control', `public, max-age=${60 * 60}`);
        }
    };

    frontendApp.use(express.static(distDir, { setHeaders: setStaticHeaders }));

    // SPA history fallback. The app uses HTML5 history routing (e.g. /tools/whois),
    // so a hard load / new-tab of a client route reaches this server as a real
    // path with no matching file. Serve index.html for navigation requests and let
    // vue-router resolve the route. Mounted after the /api proxy and the static
    // layer, so real assets and API calls are untouched.
    //   - GET only; other methods fall through.
    //   - `req.accepts('html')` gates on navigations: browsers asking for a page
    //     send `Accept: text/html`.
    //   - A path whose final segment has a file extension (e.g. /assets/x.js) is an
    //     asset request, not a client route — let it 404 rather than return an HTML
    //     body, which would break a missing JS/CSS chunk's importer after a deploy
    //     (`*/*` requests otherwise match `accepts('html')`).
    //   - Client-route loads stay uncached (unlike / and /index.html on the
    //     static layer): only those two URLs live at the edge, so a deploy-time
    //     purge stays a two-URL operation.
    frontendApp.use((req, res, next) => {
        if (req.method !== 'GET' || !req.accepts('html')) return next();
        // A dotted final segment is an asset request, not a client route — with one
        // exception. The dossier's parameter is an IP address, and `8.8.8.8` and
        // `2001:db8::1` are both full of dots. Only that prefix is exempted, so a
        // chunk missing after a deploy still 404s rather than receiving HTML.
        // `express.static` has already had its chance to serve a real file by this
        // point, so the carve-out cannot mask one.
        const isDottedAsset = req.path.split('/').pop().includes('.') && !/^\/ip\//.test(req.path);
        if (isDottedAsset) return next();
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.sendFile(path.join(distDir, 'index.html'));
    });

    // Anything left is a miss: a dotted asset that is not in dist/, a non-GET, a
    // request that does not accept HTML. A missing chunk must not be cached at the
    // edge, or it outlives the deploy that brings it back.
    frontendApp.use((req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).type('text/plain').send('Not Found');
    });

    // Last resort (a malformed URL reaching express.static, say): plain text, no
    // stack trace, never cached. Four parameters mark it as an error handler.
    // eslint-disable-next-line no-unused-vars
    frontendApp.use((err, req, res, next) => {
        const raw = Number(err?.status ?? err?.statusCode);
        const status = Number.isInteger(raw) && raw >= 400 && raw < 600 ? raw : 500;
        if (res.headersSent) {
            res.end();
            return;
        }
        res.setHeader('Cache-Control', 'no-store');
        res.status(status).type('text/plain').send(status < 500 ? 'Bad Request' : 'Internal Server Error');
    });

    return frontendApp;
};
