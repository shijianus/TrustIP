// common/client-ip.js and common/frontend-proxy.js — who a request is from.
//
// The pins that matter are the topology ones: through the shipped
// frontend-server → backend chain over loopback, the backend must see the real
// socket peer whatever X-Forwarded-For the client typed, and a client that is
// not a trusted proxy must not be able to choose its own address with that
// header or with CF-Connecting-IP. The chain is driven with the real express,
// http-proxy-middleware and express-rate-limit on ephemeral loopback ports.

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import http from 'node:http';
import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';

import { trustProxySetting, resolveClientIp, trustsCfConnectingIp } from '../common/client-ip.js';
import { apiProxyOptions, peerAddress } from '../common/frontend-proxy.js';
import { upstreamHeaders } from '../common/upstream-headers.js';
import { visitorIpFrom } from '../api/sentry-tunnel.js';

afterEach(() => {
    delete process.env.TRUST_CF_CONNECTING_IP;
});

describe('trustProxySetting', () => {
    it('defaults to loopback', () => {
        assert.deepEqual(trustProxySetting(undefined), { value: 'loopback', invalid: false });
        assert.deepEqual(trustProxySetting(''), { value: 'loopback', invalid: false });
    });

    it('reads off, a hop count, and a list of presets and subnets', () => {
        assert.deepEqual(trustProxySetting('false'), { value: false, invalid: false });
        assert.deepEqual(trustProxySetting('0'), { value: false, invalid: false });
        assert.deepEqual(trustProxySetting('2'), { value: 2, invalid: false });
        assert.deepEqual(trustProxySetting('loopback, 10.0.0.0/8'), { value: 'loopback,10.0.0.0/8', invalid: false });
        assert.deepEqual(trustProxySetting('Uniquelocal,fd00::/8,192.0.2.7'), { value: 'uniquelocal,fd00::/8,192.0.2.7', invalid: false });
    });

    // `true` makes Express believe the leftmost X-Forwarded-For entry from any
    // peer — the client's own claim. It falls back to the default, flagged.
    it('refuses true and junk, falling back to loopback', () => {
        assert.deepEqual(trustProxySetting('true'), { value: 'loopback', invalid: true });
        assert.deepEqual(trustProxySetting('everyone'), { value: 'loopback', invalid: true });
        assert.deepEqual(trustProxySetting('10.0.0.0/99'), { value: 'loopback', invalid: true });
    });
});

describe('resolveClientIp', () => {
    it('ignores CF-Connecting-IP unless TRUST_CF_CONNECTING_IP is set', () => {
        const req = { headers: { 'cf-connecting-ip': '198.51.100.1' }, ip: '203.0.113.9' };
        assert.equal(trustsCfConnectingIp(), false);
        assert.equal(resolveClientIp(req), '203.0.113.9');
        process.env.TRUST_CF_CONNECTING_IP = '1';
        assert.equal(resolveClientIp(req), '198.51.100.1');
        // A header that is not an address is not believed even then.
        assert.equal(resolveClientIp({ headers: { 'cf-connecting-ip': 'evil' }, ip: '203.0.113.9' }), '203.0.113.9');
    });

    it('never reads X-Real-IP or the raw X-Forwarded-For', () => {
        const req = { headers: { 'x-real-ip': '7.7.7.7', 'x-forwarded-for': '6.6.6.6' }, ip: '203.0.113.9' };
        assert.equal(resolveClientIp(req), '203.0.113.9');
    });

    it('unmaps a dual-stack IPv4 peer and falls back to the socket', () => {
        assert.equal(resolveClientIp({ headers: {}, ip: '::ffff:203.0.113.9' }), '203.0.113.9');
        assert.equal(resolveClientIp({ headers: {}, socket: { remoteAddress: '::ffff:192.0.2.1' } }), '192.0.2.1');
        assert.equal(resolveClientIp({ headers: {} }), null);
    });

    it('is the address the upstream headers carry', () => {
        const req = { headers: { 'cf-connecting-ip': '198.51.100.1', 'x-forwarded-for': '6.6.6.6' }, ip: '203.0.113.9' };
        assert.equal(upstreamHeaders(req)['x-forwarded-for'], '203.0.113.9');
        assert.equal(upstreamHeaders(req)['x-real-ip'], '203.0.113.9');
    });

    it('stamps a Sentry event with CF-Connecting-IP only when Cloudflare is declared', () => {
        assert.equal(visitorIpFrom({ 'cf-connecting-ip': '203.0.113.7' }), null);
        process.env.TRUST_CF_CONNECTING_IP = '1';
        assert.equal(visitorIpFrom({ 'cf-connecting-ip': '203.0.113.7' }), '203.0.113.7');
    });
});

describe('peerAddress', () => {
    it('reads the socket, unmapping IPv4', () => {
        assert.equal(peerAddress({ socket: { remoteAddress: '::ffff:127.0.0.1' } }), '127.0.0.1');
        assert.equal(peerAddress({ socket: { remoteAddress: '::1' } }), '::1');
        assert.equal(peerAddress({}), '');
    });
});

// --- the real chain ------------------------------------------------------

const listen = (app) => new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(server));
});
const close = (server) => new Promise((resolve) => server.close(resolve));

const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
});

// A backend shaped like backend-server.js: `trust proxy` from TRUST_PROXY, one
// limiter keyed on the resolved address, and an echo of what it resolved.
const backendApp = (trust, max = 2) => {
    const app = express();
    app.set('trust proxy', trustProxySetting(trust).value);
    app.use('/api', rateLimit({
        windowMs: 60_000, max, keyGenerator: (req) => ipKeyGenerator(resolveClientIp(req) || 'unknown'),
    }));
    app.get('/api/whoami', (req, res) => res.json({ ip: resolveClientIp(req), xff: req.headers['x-forwarded-for'] || null }));
    return app;
};

describe('frontend-server → backend over loopback', () => {
    let backend;
    let frontend;
    before(async () => {
        backend = await listen(backendApp(undefined, 3));
        const app = express();
        app.use('/api', createProxyMiddleware(apiProxyOptions(backend.address().port)));
        frontend = await listen(app);
    });
    after(async () => {
        await close(frontend);
        await close(backend);
    });

    it('overwrites a client X-Forwarded-For with the socket peer', async () => {
        const res = await get(frontend.address().port, '/api/whoami', { 'X-Forwarded-For': '203.0.113.99' });
        assert.deepEqual(JSON.parse(res.body), { ip: '127.0.0.1', xff: '127.0.0.1' });
    });

    it('keeps one budget per client however the header rotates', async () => {
        const statuses = [];
        for (let i = 0; i < 4; i++) {
            statuses.push((await get(frontend.address().port, '/api/whoami', { 'X-Forwarded-For': `198.51.100.${i}` })).status);
        }
        // Three allowed in total across both specs in this block (one used above).
        assert.deepEqual(statuses, [200, 200, 429, 429]);
    });
});

describe('a client that is not a trusted proxy', () => {
    // The test client connects over loopback, so the backend here is told to
    // trust only a subnet the client is not in — the position a direct client
    // is in against the default `loopback` from anywhere off the host.
    let backend;
    before(async () => { backend = await listen(backendApp('10.0.0.0/8')); });
    after(async () => { await close(backend); });

    it('cannot choose its address with X-Forwarded-For or CF-Connecting-IP', async () => {
        const res = await get(backend.address().port, '/api/whoami', {
            'X-Forwarded-For': '203.0.113.99', 'CF-Connecting-IP': '203.0.113.98', 'X-Real-IP': '203.0.113.97',
        });
        assert.equal(JSON.parse(res.body).ip, '127.0.0.1');
    });

    it('cannot reset its budget by rotating X-Forwarded-For', async () => {
        const statuses = [];
        for (let i = 0; i < 3; i++) {
            statuses.push((await get(backend.address().port, '/api/whoami', { 'X-Forwarded-For': `198.51.100.${i}` })).status);
        }
        // One request was spent by the spec above; max is 2.
        assert.deepEqual(statuses, [200, 429, 429]);
    });
});
