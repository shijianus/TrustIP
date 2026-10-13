// Edge-cache middleware for /api routes (attached in backend-server.js).
// Every /api response defaults to no-store; a route wrapped in
// cacheable(maxAge) gets `public, max-age=…` on its 2xx answers only (JSON
// via res.json, bytes via res.send) —
// the edge must never cache a 4xx / 5xx.
//
//   maxAge          seconds, or a `(req) => seconds` resolver for routes whose
//                   TTL depends on the request (the /api/cfradar views); a
//                   falsy resolution keeps the no-store default
//   cacheIf(body)   optional veto for a 2xx body that answers a degraded
//                   upstream (an /api/asn-profile section in error)
//   degradedMaxAge  optional TTL for a body cacheIf vetoes, as a number or a
//                   `() => seconds` resolver read when the body is sent;
//                   falsy = no-store, the default
//
// The full-TTL header is also stashed on res.locals.cacheControl, so
// binary-stream handlers (which bypass res.json) can apply it on their own
// 2xx path.

const resolve = (value, ...args) => (typeof value === 'function' ? value(...args) : value);

export const cacheable = (maxAge, { cacheIf, degradedMaxAge } = {}) => (req, res, next) => {
    const maxAgeSeconds = resolve(maxAge, req);
    if (maxAgeSeconds) {
        res.locals.cacheControl = `public, max-age=${maxAgeSeconds}`;
        // Express's res.json() ends in res.send(); while inside it, the send
        // hook below must not overwrite the header json() just chose (a
        // vetoed body's degraded TTL, or none).
        let inJson = false;
        const originalJson = res.json.bind(res);
        res.json = (body) => {
            if (res.statusCode < 400) {
                if (!cacheIf || cacheIf(body)) {
                    res.setHeader('Cache-Control', res.locals.cacheControl);
                } else {
                    const degradedSeconds = resolve(degradedMaxAge);
                    if (degradedSeconds) res.setHeader('Cache-Control', `public, max-age=${degradedSeconds}`);
                }
            }
            inJson = true;
            try {
                return originalJson(body);
            } finally {
                inJson = false;
            }
        };
        // Both writers, not just `json` (TrustIP): a route that answers with
        // bytes (`/api/ip-card` sends a PNG) went out `no-store` while its
        // handler believed it was cached, and a shared image is the one response
        // that pays for a cold registry fan-out on every viewer of the same link.
        if (typeof res.send === 'function') {
            const originalSend = res.send.bind(res);
            res.send = (body) => {
                if (!inJson && res.statusCode < 400) {
                    res.setHeader('Cache-Control', res.locals.cacheControl);
                }
                return originalSend(body);
            };
        }
    }
    next();
};
