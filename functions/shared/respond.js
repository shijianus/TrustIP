// Response builders standing in for the Express `res.json` + `cacheable()` pair.
//
// backend-server.js gives every /api/* route `Cache-Control: no-store` and only
// opts a route into `public, max-age=N` through `cacheable(maxAge)`, which
// attaches the header on 2xx/3xx and never on an error — Cloudflare must not
// cache a failed lookup. Same rule here: `cacheSeconds` is ignored once the
// status is 400 or above.

const jsonHeaders = (cacheSeconds, status) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8' };
    headers['Cache-Control'] = cacheSeconds && status < 400
        ? `public, max-age=${cacheSeconds}`
        : 'no-store';
    return headers;
};

export const json = (body, { status = 200, cacheSeconds = 0 } = {}) =>
    new Response(JSON.stringify(body), { status, headers: jsonHeaders(cacheSeconds, status) });

export const serverError = (message, extra = {}, { cacheSeconds = 0 } = {}) =>
    json({ error: message, ...extra }, { status: 500, cacheSeconds });

// The Express handlers answer `{ error }` or `{ message }` depending on the file;
// these two keep each route's original wording rather than unifying it, because
// the SPA is the only client and it reads the status, not the text.
export const badRequest = (error) => json({ error }, { status: 400 });

export const methodNotAllowed = (error = 'Method Not Allowed') => json({ error }, { status: 405 });
