// The edge function behind the SPA's re-based backend: the fetch shim turns
// `/api/<x>` into `/functions/v1/app/<x>`, so this file is the whole of
// backend-server.js for one function — path dispatch, the per-route guards that
// Express mounted as middleware, and the `Cache-Control` default of `no-store`
// with opt-in `public, max-age=N` on 2xx/3xx only.
//
// Two things the Express app does that this file cannot copy. Rate limiting exists
// here (see shared/rate-limit.js) but only per isolate: this runtime keeps no
// memory shared across instances, so the ceiling is a brake on one abuser, not a
// distributed counter. And `requireReferer` is left out entirely: its allow-list is
// `ALLOWED_DOMAINS` from the environment, which a key-free edge deployment has no
// way to read — enforcing the empty default would 403 every real visitor, so the
// gate is left to the platform's own origin binding.

import { finalizeResponse, json } from './shared/respond.js';
import {
    requirePublicIP, requireValidDomain, requireValidPrefix,
    requireValidRecordType, requireValidProviderId,
} from './shared/guards.js';
import { clientIpOf, createRateLimiter, rateLimitConfig } from './shared/rate-limit.js';

import configs from './shared/configs.js';
import ipsb from './shared/geo-ipsb.js';
import ipapicom from './shared/ipapicom.js';
import split from './shared/split.js';
import dnsResolver from './shared/dns-resolver.js';
import whois from './shared/whois.js';
import { overview as serviceStatus, detail as serviceStatusDetail } from './shared/service-status.js';
import asnHistory from './shared/asn-history.js';
import globalpingProbes from './shared/globalping-probes.js';
import internetdb from './shared/internetdb.js';
import aiNews from './shared/ai-news-route.js';

type Params = URLSearchParams;
type Ctx = { params: Params; headers: Headers; body: unknown };
type Guard = (params: Params) => Response | null;
type Run = (ctx: Ctx) => Response | Promise<Response>;
type Route = { method: 'GET' | 'POST'; run: Run; guards?: Guard[] };

// Path after the function-name segment, keyed exactly as the SPA's `/api/<name>`
// was spelled, so a shim change never has to be mirrored here.
const ROUTES: Record<string, Route> = {
    'configs': { method: 'GET', run: ({ headers }) => configs(headers) },
    'ipsb': { method: 'GET', guards: [requirePublicIP], run: ({ params }) => ipsb(params) },
    'ipapicom': { method: 'GET', guards: [requirePublicIP], run: ({ params }) => ipapicom(params) },
    'split': { method: 'POST', run: ({ body }) => split(body) },
    'dnsresolver': {
        method: 'GET',
        guards: [(params) => requireValidDomain(params, 'hostname'), requireValidRecordType],
        run: ({ params }) => dnsResolver(params),
    },
    'whois': { method: 'GET', run: ({ params }) => whois(params) },
    'service-status': { method: 'GET', run: () => serviceStatus() },
    'service-status/detail': { method: 'GET', guards: [requireValidProviderId], run: ({ params }) => serviceStatusDetail(params) },
    'asn-history': { method: 'GET', guards: [requireValidPrefix], run: ({ params }) => asnHistory(params) },
    'globalping-probes': { method: 'GET', run: () => globalpingProbes() },
    'internetdb': { method: 'GET', guards: [requirePublicIP], run: ({ params }) => internetdb(params) },
    'ai-news': { method: 'GET', run: () => aiNews() },
};

const FUNCTION_PREFIX = '/functions/v1/app';

// Built once per isolate, so the buckets survive across invocations of a warm
// instance — which is the entire mechanism the limit has. A cold start begins
// clean, and that is the documented scope rather than a bug to close.
const { limit, windowMs } = rateLimitConfig(
    typeof process === 'undefined' ? {} : process.env,
);
const rateLimit = createRateLimiter({ limit, windowMs });

/**
 * The logical route name a URL asks for.
 *
 * The platform's prefix is tried first and then discarded rather than trusted:
 * the function's mounted name is the deployment's choice, so `/app/ipsb` and a
 * bare `/ipsb` (the local harness) have to reach the same handler. Failing that,
 * the trailing one or two segments are matched against the table, which is what
 * makes `service-status/detail` reachable without a prefix.
 */
export const routeNameOf = (pathname: string): string => {
    const marker = pathname.indexOf(FUNCTION_PREFIX);
    if (marker !== -1) return pathname.slice(marker + FUNCTION_PREFIX.length).replace(/^\/+/, '');

    const segments = pathname.split('/').filter(Boolean);
    const tail = (count: number) => segments.slice(-count).join('/');
    if (ROUTES[tail(2)]) return tail(2);
    return tail(1);
};

// The only POST route (`split`) carries six short signals — a few hundred
// bytes. 64 KB leaves ample room for that and keeps a hostile body from costing
// the isolate more than a trivial read.
export const MAX_BODY_BYTES = 64 * 1024;

// Methods some route answers. Anything else (TRACE, PUT, DELETE, …) is a 405
// with this list in `Allow`, before routing — an unknown path included.
const SUPPORTED_METHODS = new Set(['GET', 'POST']);
const SUPPORTED_ALLOW = [...SUPPORTED_METHODS].join(', ');

const TOO_LARGE = { error: 'Request body too large', status: 413 };

/**
 * The body as text, read chunk by chunk and abandoned the moment it passes
 * `limit`: a declared Content-Length over it is refused unread, and a chunked
 * body (no length to check) is counted as it streams rather than buffered whole
 * first. Exported for tests.
 */
export const readBodyCapped = async (request: Request, limit = MAX_BODY_BYTES): Promise<{ text?: string; tooLarge?: boolean }> => {
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limit) return { tooLarge: true };
    if (!request.body) return { text: '' };
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > limit) {
            await reader.cancel().catch(() => {});
            return { tooLarge: true };
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return { text: new TextDecoder().decode(bytes) };
};

const parseBody = async (request: Request): Promise<{ body?: unknown; error?: string; status?: number }> => {
    const { text, tooLarge } = await readBodyCapped(request);
    if (tooLarge) return TOO_LARGE;
    if (!text) return { body: {} };
    try {
        return { body: JSON.parse(text) };
    } catch {
        return { error: 'Invalid body' };
    }
};

const dispatch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    // Before routing: the requests worth refusing are the ones that would have
    // asked an upstream something, and a probe walking unknown paths costs the
    // isolate too. Retry-After tells an honest client when to come back.
    const verdict = rateLimit.check(clientIpOf(request.headers));
    if (!verdict.allowed) {
        return json(
            { error: 'Too many requests' },
            { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
        );
    }

    if (!SUPPORTED_METHODS.has(request.method)) {
        return json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: SUPPORTED_ALLOW } });
    }

    const name = routeNameOf(url.pathname);
    const route = ROUTES[name];

    if (!route) return json({ error: 'Not found' }, { status: 404 });
    if (request.method !== route.method) {
        return json({ error: 'Method Not Allowed' }, { status: 405, headers: { Allow: route.method } });
    }

    // A fresh URLSearchParams per request: the canonicalising guards lowercase and
    // uppercase values in place, and that must never leak between visitors.
    const params = new URLSearchParams(url.search);
    for (const guard of route.guards || []) {
        const rejected = guard(params);
        if (rejected) return rejected;
    }

    let body: unknown = undefined;
    if (route.method === 'POST') {
        const parsed = await parseBody(request);
        if (parsed.error) return json({ error: parsed.error }, { status: parsed.status || 400 });
        body = parsed.body;
    }

    try {
        return await route.run({ params, headers: request.headers, body });
    } catch (error) {
        console.error('[app] unhandled route failure', { name, error: error?.message });
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

// Every answer, the 429 and the 404 included, leaves through finalizeResponse so
// the security headers and the no-store-on-error rule cannot be skipped by a
// route that builds its own Response.
const handler = async (request: Request): Promise<Response> => finalizeResponse(await dispatch(request));

export default handler;
