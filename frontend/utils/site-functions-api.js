// Where this build's back end lives, when it is not the self-hosted Express server.
//
// A self-hosted TrustIP serves its API from `/api/*` on the same origin, which is
// what every call site in the app writes. That origin is not available on Qoder
// Sites: the platform owns `/api` for itself, and application server code runs as one
// edge function addressed at `/functions/v1/app`, with any suffix kept. So the same
// bundle needs one different thing — the prefix its own requests are addressed to.
//
// The rewrite is installed once, before the app mounts, and only when the build asked
// for it. Nothing in `frontend/` changes its call sites, so the self-hosted deployment
// and the hosted one keep running the identical source; `api/AGENTS.md` still
// describes the routes, and the Express server still answers them at `/api`.
//
// Only same-origin `/api/...` requests are touched. The measurements that go straight
// to a third party — Cloudflare's trace, Globalping, the DNS-leak providers, the IP
// echo sources — are deliberately left alone: they are not this app's backend, and
// rewriting them would break them.

const SITE_FUNCTIONS_PREFIX = '/functions/v1/app';

// Absolute or absolute-ish inputs the app actually uses: a string URL, or a `Request`
// carrying one. Anything else is passed through untouched.
const rewriteOne = (value) => {
    if (typeof value !== 'string') return value;
    if (value.startsWith('/api/')) return `${SITE_FUNCTIONS_PREFIX}${value.slice('/api'.length)}`;
    // A full URL to this same origin (`/api` written out with the scheme) is the same
    // request; a different origin is somebody else's API and stays as it is.
    if (/^https?:/.test(value)) {
        try {
            const url = new URL(value);
            if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
                url.pathname = `${SITE_FUNCTIONS_PREFIX}${url.pathname.slice('/api'.length)}`;
                return url.toString();
            }
        } catch {
            // Unparseable: not a URL this code should be reasoning about.
        }
    }
    return value;
};

/**
 * Point the app's own API calls at the site's edge function.
 * Replaces `window.fetch` for same-origin `/api/*` requests only.
 */
export const installSiteFunctionsApi = () => {
    const native = window.fetch?.bind(window);
    if (!native) return false;
    window.fetch = (input, init) => {
        if (typeof Request !== 'undefined' && input instanceof Request) {
            const url = rewriteOne(input.url);
            return native(url === input.url ? input : new Request(url, input), init);
        }
        return native(rewriteOne(input), init);
    };
    return true;
};
