// Per-route rate limits — common/route-limiter.js and their wiring in backend-server.js.
//
// Two halves. The wiring half reads backend-server.js and fails when a route
// that spends a vendor key, a third party's fair-use allowance, a KV write or a
// fan-out is mounted without its own limiter, or with the limiter after
// `cacheable` (a 429 must stay no-store). The behaviour half drives the real
// express + express-rate-limit chain on a loopback port: budgets are per
// resolved client, independent per route, and not reset by X-Forwarded-For.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import express from 'express';

import { limiter, perMinute, clientKey } from '../common/route-limiter.js';
import { trustProxySetting } from '../common/client-ip.js';
import { cacheable } from '../common/cache-control.js';

const SOURCE = fs.readFileSync(new URL('../backend-server.js', import.meta.url), 'utf8');

// Every route that costs something upstream per origin request.
const METERED_ROUTES = [
    ['get', '/api/ipinfo'],
    ['get', '/api/ipapicom'],
    ['get', '/api/ipsb'],
    ['get', '/api/ipapiis'],
    ['get', '/api/ip2location'],
    ['get', '/api/ipchecking'],
    ['get', '/api/whois'],
    ['get', '/api/ooni-blocking'],
    ['get', '/api/asn-profile'],
    ['get', '/api/cfradar'],
    ['get', '/api/map'],
    ['get', '/api/trustscore'],
    ['get', '/api/dossier'],
    ['get', '/api/dnsbl'],
    ['get', '/api/internetdb'],
    ['get', '/api/ip-card'],
    ['get', '/api/dnsresolver'],
    ['get', '/api/report/:id'],
    ['post', '/api/report'],
    ['post', '/api/persona/evaluate'],
    ['post', '/api/split'],
    ['post', '/api/monitoring'],
];

// The source text of one `app.get('/api/x', …)` call, up to its closing `);`.
const routeCall = (method, route) => {
    const start = SOURCE.indexOf(`app.${method}('${route}',`);
    if (start === -1) return null;
    return SOURCE.slice(start, SOURCE.indexOf(');\n', start) + 2);
};

describe('backend-server.js wiring', () => {
    for (const [method, route] of METERED_ROUTES) {
        it(`${method.toUpperCase()} ${route} carries its own limiter before any cache header`, () => {
            const call = routeCall(method, route);
            assert.ok(call, `route ${route} not found in backend-server.js`);
            const at = call.search(/perMinute\(|[A-Za-z]+Limiter\b/);
            assert.notEqual(at, -1, `${route} has no per-route limiter`);
            const cacheAt = call.indexOf('cacheable(');
            if (cacheAt !== -1) assert.ok(at < cacheAt, `${route}: limiter must come before cacheable`);
        });
    }

    it('builds every limiter through common/route-limiter.js', () => {
        assert.doesNotMatch(SOURCE, /from 'express-rate-limit'/);
        assert.match(SOURCE, /from '\.\/common\/route-limiter\.js'/);
    });
});

const listen = (app) => new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve) => server.close(resolve));
const request = (port, path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
});

describe('perMinute', () => {
    let server;
    before(async () => {
        const app = express();
        // The test client is on loopback; trusting only 10/8 puts it where a
        // direct client sits against the default, so X-Forwarded-For is ignored.
        app.set('trust proxy', trustProxySetting('10.0.0.0/8').value);
        app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
        app.get('/api/a', perMinute(2), cacheable(60 * 60), (req, res) => res.json({ ok: true }));
        app.get('/api/b', perMinute(2), (req, res) => res.json({ ok: true }));
        app.post('/api/w', perMinute(1), (req, res) => res.json({ ok: true }));
        server = await listen(app);
    });
    after(async () => { await close(server); });

    it('spends one budget per client however X-Forwarded-For rotates', async () => {
        const statuses = [];
        for (let i = 0; i < 3; i++) {
            statuses.push((await request(server.address().port, '/api/a', { headers: { 'X-Forwarded-For': `198.51.100.${i}` } })).status);
        }
        assert.deepEqual(statuses, [200, 200, 429]);
    });

    it('answers a 429 with the shared message and keeps it out of the edge cache', async () => {
        const res = await request(server.address().port, '/api/a');
        assert.equal(res.status, 429);
        assert.equal(res.body, 'Too Many Requests');
        assert.equal(res.headers['cache-control'], 'no-store');
    });

    it('gives each route an independent budget', async () => {
        const port = server.address().port;
        assert.equal((await request(port, '/api/b')).status, 200);
        assert.equal((await request(port, '/api/w', { method: 'POST' })).status, 200);
        assert.equal((await request(port, '/api/w', { method: 'POST' })).status, 429);
        assert.equal((await request(port, '/api/b')).status, 200);
    });
});

describe('limiter', () => {
    it('keys on the resolved client, whatever key generator a caller passes', async () => {
        const app = express();
        app.set('trust proxy', false);
        app.get('/x', limiter({ windowMs: 60 * 1000, max: 1, keyGenerator: () => String(Math.random()) }), (req, res) => res.json({}));
        const server = await listen(app);
        try {
            const port = server.address().port;
            assert.equal((await request(port, '/x')).status, 200);
            assert.equal((await request(port, '/x')).status, 429);
        } finally {
            await close(server);
        }
    });

    it('keys IPv6 clients by their /56', () => {
        const a = clientKey({ headers: {}, ip: '2001:db8:0:1::1' });
        const b = clientKey({ headers: {}, ip: '2001:db8:0:ff::2' });
        const c = clientKey({ headers: {}, ip: '2001:db8:0:100::1' });
        assert.equal(a, b);
        assert.notEqual(a, c);
    });
});
