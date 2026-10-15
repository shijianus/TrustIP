// Response builders standing in for the Express `res.json` + `cacheable()` pair.
//
// backend-server.js gives every /api/* route `Cache-Control: no-store` and only
// opts a route into `public, max-age=N` through `cacheable(maxAge)`, which
// attaches the header on 2xx/3xx and never on an error — Cloudflare must not
// cache a failed lookup. Same rule here: `cacheSeconds` is ignored once the
// status is 400 or above.
//
// Every answer also carries the baseline headers common/security-headers.js puts
// on the Express servers, tightened for an API that is never a page: no MIME
// sniffing, never framed by anyone, and only the origin leaks cross-site.

export const EDGE_SECURITY_HEADERS = Object.freeze({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
});

const jsonHeaders = (cacheSeconds, status, extra) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', ...extra, ...EDGE_SECURITY_HEADERS };
    headers['Cache-Control'] = cacheSeconds && status < 400
        ? `public, max-age=${cacheSeconds}`
        : 'no-store';
    return headers;
};

/**
 * The last word on any Response leaving the function, whoever built it: the
 * baseline headers are present and an error status is `no-store`. A handler that
 * returned a Response of its own (or one whose headers are immutable, as a
 * fetch() result's are) is copied rather than mutated.
 *
 * @param {Response} response
 * @returns {Response}
 */
export const finalizeResponse = (response) => {
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(EDGE_SECURITY_HEADERS)) headers.set(name, value);
    if (response.status >= 400) headers.set('Cache-Control', 'no-store');
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
    });
};

export const json = (body, { status = 200, cacheSeconds = 0, headers } = {}) =>
    new Response(JSON.stringify(body), { status, headers: jsonHeaders(cacheSeconds, status, headers) });

export const serverError = (message, extra = {}, { cacheSeconds = 0 } = {}) =>
    json({ error: message, ...extra }, { status: 500, cacheSeconds });

// The Express handlers answer `{ error }` or `{ message }` depending on the file;
// these two keep each route's original wording rather than unifying it, because
// the SPA is the only client and it reads the status, not the text.
export const badRequest = (error) => json({ error }, { status: 400 });

export const methodNotAllowed = (error = 'Method Not Allowed') => json({ error }, { status: 405 });
