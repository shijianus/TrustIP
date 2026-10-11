// The edge function behind the SPA's re-based backend: the fetch shim turns
// `/api/<x>` into `/functions/v1/app/<x>`, so this file is the whole of
// backend-server.js for one function — path dispatch, the per-route guards that
// Express mounted as middleware, and the `Cache-Control` default of `no-store`
// with opt-in `public, max-age=N` on 2xx/3xx only.
//
// Two deliberate absences. Rate limiting (`express-rate-limit` / `express-slow-down`)
// is in-process state this runtime does not keep. And `requireReferer`: its
// allow-list is `ALLOWED_DOMAINS` from the environment, which a key-free edge
// deployment has no way to read — enforcing the empty default would 403 every
// real visitor, so the gate is left to the platform's own origin binding.

import { json } from './shared/respond.js';
import {
    requirePublicIP, requireValidDomain, requireValidPrefix,
    requireValidRecordType, requireValidProviderId,
} from './shared/guards.js';

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
};

const FUNCTION_PREFIX = '/functions/v1/app';

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

const parseBody = async (request: Request): Promise<{ body?: unknown; error?: string }> => {
    const text = await request.text();
    if (!text) return { body: {} };
    try {
        return { body: JSON.parse(text) };
    } catch {
        return { error: 'Invalid body' };
    }
};

const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const name = routeNameOf(url.pathname);
    const route = ROUTES[name];

    if (!route) return json({ error: 'Not found' }, { status: 404 });
    if (request.method !== route.method) {
        return json({ error: 'Method Not Allowed' }, { status: 405 });
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
        if (parsed.error) return json({ error: parsed.error }, { status: 400 });
        body = parsed.body;
    }

    try {
        return await route.run({ params, headers: request.headers, body });
    } catch (error) {
        console.error('[app] unhandled route failure', { name, error: error?.message });
        return json({ error: 'Internal Server Error' }, { status: 500 });
    }
};

export default handler;
