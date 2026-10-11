// Upstream fetch for this runtime: web-standard `fetch` with a bounded timeout.
//
// Mirrors common/fetch-with-timeout.js's `fetchUpstream`, expressed with
// `AbortSignal.timeout` instead of an AbortController + timer, and with a
// Headers instance because a WAF-facing User-Agent must survive a caller-supplied
// header object of any shape. A caller-provided `User-Agent` always wins.
//
// Redirects are followed by default and that is load-bearing: rdap.org is a
// bootstrap that answers 302 to the authoritative registry.

const UPSTREAM_TIMEOUT_MS = 8000;
const USER_AGENT = 'TrustIP/qoder-sites-edge';

export const fetchUpstream = (url, init = {}) => {
    const { timeoutMs = UPSTREAM_TIMEOUT_MS, headers, ...rest } = init;
    const carried = new Headers(headers || undefined);
    if (!carried.has('user-agent')) carried.set('user-agent', USER_AGENT);

    return fetch(url, {
        ...rest,
        headers: carried,
        signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
    });
};
