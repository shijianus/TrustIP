// Headers on every edge-function answer (functions/shared/respond.js and the
// finalizeResponse wrap in functions/handler.ts): the baseline security headers
// on success and failure alike, and `no-store` on every 4xx / 5xx, the 429
// included, so a CDN in front of the function never caches a refusal.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import handler from '../functions/handler.ts';
import {
    EDGE_SECURITY_HEADERS, finalizeResponse, json, serverError,
} from '../functions/shared/respond.js';

const call = (path, init = {}) =>
    handler(new Request(`http://localhost/functions/v1/app/${path}`, init));

const assertBaseline = (res, label) => {
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff', label);
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY', label);
    assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin', label);
};

describe('respond.js json()', () => {
    it('adds the baseline headers to cacheable and failed answers', () => {
        const ok = json({ a: 1 }, { cacheSeconds: 60 });
        assertBaseline(ok, '200');
        assert.equal(ok.headers.get('Cache-Control'), 'public, max-age=60');

        const failed = serverError('boom', {}, { cacheSeconds: 60 });
        assertBaseline(failed, '500');
        assert.equal(failed.headers.get('Cache-Control'), 'no-store');
    });

    it('a caller-supplied header cannot weaken the baseline', () => {
        const res = json({}, { headers: { 'X-Frame-Options': 'ALLOWALL' } });
        assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
    });
});

describe('respond.js finalizeResponse()', () => {
    it('stamps a Response that was built without respond.js', async () => {
        const raw = new Response('nope', { status: 502, headers: { 'Cache-Control': 'public, max-age=600' } });
        const res = finalizeResponse(raw);
        assert.equal(res.status, 502);
        assert.equal(res.headers.get('Cache-Control'), 'no-store');
        assertBaseline(res, 'raw 502');
        assert.equal(await res.text(), 'nope');
    });

    it('copies a Response whose headers are immutable', () => {
        const res = finalizeResponse(Response.redirect('https://example.com/', 302));
        assert.equal(res.status, 302);
        assert.equal(res.headers.get('Location'), 'https://example.com/');
        assertBaseline(res, 'redirect');
    });

    it('leaves a 2xx cache policy alone', () => {
        const res = finalizeResponse(new Response('{}', { headers: { 'Cache-Control': 'public, max-age=60' } }));
        assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
    });

    it('exports exactly the three baseline headers', () => {
        assert.deepEqual(Object.keys(EDGE_SECURITY_HEADERS).sort(),
            ['Referrer-Policy', 'X-Content-Type-Options', 'X-Frame-Options']);
    });
});

describe('edge handler responses', () => {
    it('every routed status carries the baseline, and errors are no-store', async () => {
        const cases = [
            ['nope', {}, 404],
            ['split', {}, 405],
            ['ipsb', {}, 400],
            ['split', { method: 'POST', body: '{bad', headers: { 'content-type': 'application/json' } }, 400],
        ];
        for (const [path, init, status] of cases) {
            const res = await call(path, init);
            assert.equal(res.status, status, path);
            assertBaseline(res, `${path} ${status}`);
            assert.equal(res.headers.get('Cache-Control'), 'no-store', `${path} ${status}`);
        }
    });

    it('a 200 carries the baseline too', async () => {
        const res = await call('split', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
        assert.equal(res.status, 200);
        assertBaseline(res, 'split 200');
    });

    it('the limiter 429 is no-store, carries Retry-After and the baseline', async () => {
        // The module-level limiter uses the default ceiling (600 per window);
        // one address walks past it.
        const headers = { 'cf-connecting-ip': '203.0.113.250' };
        let last;
        for (let i = 0; i < 601; i += 1) last = await call('nope', { headers });
        assert.equal(last.status, 429);
        assert.equal(last.headers.get('Cache-Control'), 'no-store');
        assert.ok(Number(last.headers.get('Retry-After')) > 0);
        assertBaseline(last, '429');

        // A different platform address keeps its own bucket.
        assert.equal((await call('nope', { headers: { 'cf-connecting-ip': '203.0.113.251' } })).status, 404);
    });
});
