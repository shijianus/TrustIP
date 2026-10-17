// Refuses HTTP methods neither Express server answers, ahead of every route.
//
// TRACE echoes the request back (a cross-site-tracing primitive once a proxy
// adds credentials to it), and the WebDAV family has no handler here at all
// (TRACK and other verbs Node's HTTP parser does not know are a 400 before
// Express ever sees them) — without this, Express would walk them through the static layer and the
// SPA fallback. The answer is a JSON 405 with the `Allow` header RFC 9110
// requires on it, and no-store like every other error.

// Every method a route in backend-server.js or frontend-server.js is mounted
// on, plus HEAD (static files) and OPTIONS (Express's automatic Allow answer).
export const ALLOWED_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS']);
const ALLOW_HEADER = ALLOWED_METHODS.join(', ');
const ALLOWED = new Set(ALLOWED_METHODS);

export const rejectUnsupportedMethods = (req, res, next) => {
    if (ALLOWED.has(req.method)) return next();
    res.setHeader('Allow', ALLOW_HEADER);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method Not Allowed' });
};
