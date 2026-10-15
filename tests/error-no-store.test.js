// Every error the two Express servers answer is `Cache-Control: no-store`: the
// limiter 429, body-parser's 400 / 413, the frontend proxy's 504 with the backend
// down, and a missing asset's 404. A CDN that caches one of these serves the
// failure to every visitor after it.
//
// The backend boots on import (datasets, listener), so its wiring is checked two
// ways: the same middleware stack rebuilt on an ephemeral port, and the order of
// the real `app.use` calls in backend-server.js. The frontend app comes from its
// factory, mounted against a throwaway dist/.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import express from 'express';
import rateLimit from 'express-rate-limit';

import { noStore } from '../common/cache-control.js';
import { jsonErrorHandler, apiNotFound } from '../common/error-handler.js';
import { createFrontendApp } from '../common/frontend-app.js';

const listen = (app) => new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
});
const urlOf = (server) => `http://127.0.0.1:${server.address().port}`;

// A port nothing listens on: bind, read it, release it.
const freePort = () => new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
    });
});

describe('backend middleware order', () => {
    let server;
    before(async () => {
        const app = express();
        app.use('/api', noStore);
        app.use('/api', rateLimit({
            windowMs: 60_000, limit: 1, standardHeaders: false, legacyHeaders: false,
            handler: (req, res) => res.status(429).json({ message: 'Too Many Requests' }),
        }));
        app.use(express.json({ limit: '1kb' }));
        app.post('/api/split', (req, res) => res.json({ ok: true }));
        app.use('/api', apiNotFound);
        app.use(jsonErrorHandler);
        server = await listen(app);
    });
    after(() => server.close());

    it('body-parser 400 and 413, then the limiter 429, are all no-store', async () => {
        // The limit is 1 per window, so the first request spends it: send it as
        // the malformed body, then the oversized one is the 429.
        const bad = await fetch(`${urlOf(server)}/api/split`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad',
        });
        assert.equal(bad.status, 400);
        assert.equal(bad.headers.get('cache-control'), 'no-store');

        const limited = await fetch(`${urlOf(server)}/api/split`, { method: 'POST' });
        assert.equal(limited.status, 429);
        assert.equal(limited.headers.get('cache-control'), 'no-store');
    });

    it('a 413 is no-store', async () => {
        const app = express();
        app.use('/api', noStore);
        app.use(express.json({ limit: '1kb' }));
        app.post('/api/split', (req, res) => res.json({ ok: true }));
        app.use(jsonErrorHandler);
        const local = await listen(app);
        try {
            const big = await fetch(`${urlOf(local)}/api/split`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ pad: 'x'.repeat(4096) }),
            });
            assert.equal(big.status, 413);
            assert.equal(big.headers.get('cache-control'), 'no-store');
        } finally {
            local.close();
        }
    });

    it('backend-server.js mounts no-store before the limiters and the body parser', () => {
        const source = readFileSync(new URL('../backend-server.js', import.meta.url), 'utf8');
        const at = (needle) => {
            const index = source.indexOf(needle);
            assert.notEqual(index, -1, `${needle} is in backend-server.js`);
            return index;
        };
        const noStoreAt = at("app.use('/api', noStore);");
        assert.ok(noStoreAt < at("app.use('/api', rateLimiter);"), 'before the global limiter');
        assert.ok(noStoreAt < at("app.use('/api', speedLimiter);"), 'before the speed limiter');
        assert.ok(noStoreAt < at("app.use(express.json("), 'before the body parser');
        assert.ok(noStoreAt < at("app.get('/api/"), 'before every route and its limiter');
    });
});

describe('frontend app errors', () => {
    let dist;
    let server;
    before(async () => {
        dist = mkdtempSync(path.join(tmpdir(), 'trustip-dist-'));
        mkdirSync(path.join(dist, 'assets'));
        writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
        writeFileSync(path.join(dist, 'assets', 'app-abc.js'), 'export {};');
        server = await listen(createFrontendApp({ distDir: dist, backEndPort: await freePort() }));
    });
    after(() => {
        server.close();
        rmSync(dist, { recursive: true, force: true });
    });

    it('answers 504 no-store when the backend is down', async () => {
        const res = await fetch(`${urlOf(server)}/api/configs`);
        assert.equal(res.status, 504);
        assert.equal(res.headers.get('cache-control'), 'no-store');
    });

    it('answers a missing asset with 404 no-store, not HTML', async () => {
        for (const asset of ['/assets/missing-chunk.js', '/nonexistent.js', '/robots.txt']) {
            const res = await fetch(`${urlOf(server)}${asset}`, { headers: { accept: '*/*' } });
            assert.equal(res.status, 404, asset);
            assert.equal(res.headers.get('cache-control'), 'no-store', asset);
            assert.doesNotMatch(res.headers.get('content-type') || '', /html/, asset);
        }
    });

    it('a non-GET miss is a 404 no-store', async () => {
        const res = await fetch(`${urlOf(server)}/tools`, { method: 'POST' });
        assert.equal(res.status, 404);
        assert.equal(res.headers.get('cache-control'), 'no-store');
    });

    it('keeps the asset caching and the SPA fallback as they were', async () => {
        const asset = await fetch(`${urlOf(server)}/assets/app-abc.js`);
        assert.equal(asset.status, 200);
        assert.match(asset.headers.get('cache-control'), /immutable/);

        const route = await fetch(`${urlOf(server)}/tools/whois`, { headers: { accept: 'text/html' } });
        assert.equal(route.status, 200);
        assert.equal(route.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
        assert.equal(route.headers.get('x-content-type-options'), 'nosniff');
    });
});
