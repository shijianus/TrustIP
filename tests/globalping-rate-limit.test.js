// Tests for the Globalping 429 handling and token wiring: the composable's
// shared back-off (Retry-After / X-RateLimit-Reset, fail-fast while it holds,
// one POST per identical body in flight, the token proxy switch) and the
// server-side create proxy api/globalping-measurements.js (sanitised body,
// Bearer token, headers passed through). fetch is stubbed throughout.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { effectScope } from 'vue';

import {
    useGlobalpingMeasurement, globalpingRateLimit, isGlobalpingRateLimited, resetGlobalpingRateLimit,
    retryAfterOf, setGlobalpingProxy, GLOBALPING_PROXY_CREATE,
} from '../frontend/composables/use-globalping-measurement.js';
import handler, { sanitizeMeasurement, GLOBALPING_CREATE_URL } from '../api/globalping-measurements.js';

const API_BASE = 'https://api.globalping.io/v1/measurements';
const realFetch = globalThis.fetch;
const savedToken = process.env.GLOBALPING_TOKEN;

const tick = () => new Promise((r) => setTimeout(r, 0));
const waitFor = async (predicate, timeout = 2000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline) throw new Error('timed out');
        await tick();
    }
};
const withScope = (fn) => {
    const scope = effectScope();
    return { scope, value: scope.run(fn) };
};
const response = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });

beforeEach(() => {
    resetGlobalpingRateLimit();
    setGlobalpingProxy(false);
});
afterEach(() => {
    globalThis.fetch = realFetch;
    resetGlobalpingRateLimit();
    setGlobalpingProxy(false);
    if (savedToken === undefined) delete process.env.GLOBALPING_TOKEN;
    else process.env.GLOBALPING_TOKEN = savedToken;
});

describe('retryAfterOf', () => {
    it('reads Retry-After, then X-RateLimit-Reset, else a minute; capped at an hour', () => {
        assert.equal(retryAfterOf(new Response(null, { headers: { 'Retry-After': '42' } })), 42);
        assert.equal(retryAfterOf(new Response(null, { headers: { 'X-RateLimit-Reset': '17.2' } })), 18);
        assert.equal(retryAfterOf(new Response(null)), 60);
        assert.equal(retryAfterOf(new Response(null, { headers: { 'Retry-After': '99999' } })), 3600);
    });
});

describe('shared back-off', () => {
    it('a create 429 reports rate-limited with the wait, and the next start sends nothing', async () => {
        let posts = 0;
        globalThis.fetch = async () => { posts++; return response(429, { error: { type: 'too_many_requests' } }, { 'Retry-After': '30' }); };
        const { scope, value } = withScope(() => useGlobalpingMeasurement({ pollInterval: 5 }));
        try {
            const errors = [];
            value.start({ type: 'ping', target: '1.1.1.1' }, { onError: (reason, info) => errors.push([reason, info]) });
            await waitFor(() => value.status.value === 'error');
            assert.deepEqual(errors, [['rate-limited', { retryAfter: 30 }]]);
            assert.equal(isGlobalpingRateLimited(), true);
            assert.equal(globalpingRateLimit.value.seconds, 30);

            value.start({ type: 'ping', target: '1.1.1.1' }, { onError: (reason, info) => errors.push([reason, info]) });
            await waitFor(() => errors.length === 2);
            assert.equal(errors[1][0], 'rate-limited');
            assert.ok(errors[1][1].retryAfter > 0 && errors[1][1].retryAfter <= 30);
            assert.equal(posts, 1, 'inside the back-off nothing is sent');
        } finally {
            scope.stop();
        }
    });

    it('a poll 429 enters the same back-off', async () => {
        globalThis.fetch = async (url, init) => (init?.method === 'POST'
            ? response(202, { id: 'm1' })
            : response(429, {}, { 'X-RateLimit-Reset': '5' }));
        const { scope, value } = withScope(() => useGlobalpingMeasurement({ pollInterval: 5 }));
        try {
            let reason = null;
            value.start({ type: 'ping', target: '1.1.1.1' }, { onError: (r) => { reason = r; } });
            await waitFor(() => reason !== null);
            assert.equal(reason, 'rate-limited');
            assert.equal(globalpingRateLimit.value.seconds, 5);
        } finally {
            scope.stop();
        }
    });

    it('identical creates in flight share one POST; different bodies do not', async () => {
        let posts = 0;
        globalThis.fetch = async (url, init) => {
            if (init?.method === 'POST') {
                posts++;
                await new Promise((r) => setTimeout(r, 20));
                return response(202, { id: `m${posts}` });
            }
            return response(200, { status: 'finished', results: [{}] });
        };
        const a = withScope(() => useGlobalpingMeasurement({ pollInterval: 5 }));
        const b = withScope(() => useGlobalpingMeasurement({ pollInterval: 5 }));
        const c = withScope(() => useGlobalpingMeasurement({ pollInterval: 5 }));
        try {
            const body = { type: 'ping', target: '8.8.8.8', limit: 3 };
            a.value.start(body, { onResults: () => true });
            b.value.start({ ...body }, { onResults: () => true });
            c.value.start({ ...body, target: '9.9.9.9' }, { onResults: () => true });
            await waitFor(() => [a, b, c].every((x) => x.value.status.value === 'finished'));
            assert.equal(posts, 2);
        } finally {
            a.scope.stop(); b.scope.stop(); c.scope.stop();
        }
    });

    it('creates go to the token proxy only when the server says it holds one', async () => {
        const urls = [];
        globalThis.fetch = async (url, init) => {
            urls.push(`${init?.method || 'GET'} ${url}`);
            return init?.method === 'POST' ? response(202, { id: 'p1' }) : response(200, { status: 'finished', results: [{}] });
        };
        setGlobalpingProxy(true);
        const { scope, value } = withScope(() => useGlobalpingMeasurement({ pollInterval: 5 }));
        try {
            value.start({ type: 'ping', target: '1.0.0.1' }, { onResults: () => true });
            await waitFor(() => value.status.value === 'finished');
            assert.deepEqual(urls, [`POST ${GLOBALPING_PROXY_CREATE}`, `GET ${API_BASE}/p1`]);
        } finally {
            scope.stop();
        }
    });
});

describe('POST /api/globalping/measurements', () => {
    const res = () => {
        const out = { statusCode: 200, headers: {}, body: null };
        return Object.assign(out, {
            status(code) { out.statusCode = code; return out; },
            json(body) { out.body = body; return out; },
            setHeader(name, value) { out.headers[name.toLowerCase()] = value; },
        });
    };

    it('sanitises the body to the fields the tools send', () => {
        assert.deepEqual(sanitizeMeasurement({ type: 'mtr', target: '1.1.1.1', limit: 3, locations: [{ country: 'JP' }], extra: 1 }),
            { type: 'mtr', target: '1.1.1.1', limit: 3, locations: [{ country: 'JP' }] });
        assert.equal(sanitizeMeasurement({ type: 'shell', target: '1.1.1.1' }), null);
        assert.equal(sanitizeMeasurement({ type: 'ping', target: 'a b' }), null);
        assert.equal(sanitizeMeasurement({ type: 'ping', target: '1.1.1.1', limit: 500 }), null);
        assert.equal(sanitizeMeasurement([]), null);
    });

    it('no token: API key is missing, before any request leaves', async () => {
        delete process.env.GLOBALPING_TOKEN;
        let asked = 0;
        globalThis.fetch = async () => { asked++; return response(202, {}); };
        const out = res();
        await handler({ method: 'POST', body: { type: 'ping', target: '1.1.1.1' } }, out);
        assert.equal(out.statusCode, 500);
        assert.deepEqual(out.body, { error: 'API key is missing' });
        assert.equal(asked, 0);
    });

    it('with a token: Bearer upstream, status and rate headers passed through', async () => {
        process.env.GLOBALPING_TOKEN = 'gp-token';
        const seen = [];
        globalThis.fetch = async (url, init) => {
            seen.push({ url: String(url), init });
            return response(429, { error: { type: 'too_many_requests' } }, { 'Retry-After': '12', 'X-RateLimit-Remaining': '0' });
        };
        const out = res();
        await handler({ method: 'POST', body: { type: 'ping', target: '1.1.1.1', limit: 2 } }, out);
        assert.equal(seen[0].url, GLOBALPING_CREATE_URL);
        assert.equal(seen[0].init.headers.Authorization, 'Bearer gp-token');
        assert.deepEqual(JSON.parse(seen[0].init.body), { type: 'ping', target: '1.1.1.1', limit: 2 });
        assert.equal(out.statusCode, 429);
        assert.equal(out.headers['retry-after'], '12');
        assert.equal(out.headers['x-ratelimit-remaining'], '0');
        assert.equal(out.headers['cache-control'], 'no-store');
    });

    it('rejects a malformed body with 400', async () => {
        process.env.GLOBALPING_TOKEN = 'gp-token';
        const out = res();
        await handler({ method: 'POST', body: { type: 'nope' } }, out);
        assert.equal(out.statusCode, 400);
    });
});
