import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { upstreamHeaders, resolveClientIp } from '../common/upstream-headers.js';
import { normalizeLang } from '../common/lang-param.js';
import { securityHeaders } from '../common/security-headers.js';
import getCountryName from '../common/country-name.js';
import ipCheckingHandler from '../api/ipcheck-ing.js';
import getUserInfoHandler from '../api/get-user-info.js';
import updateAchievementHandler from '../api/update-user-achievement.js';
import invisibilityHandler from '../api/invisibility-test.js';
import cfRadarHandler from '../api/cf-radar.js';
import asnProfileHandler from '../api/asn-profile.js';
import logger from '../common/logger.js';

const ENV = ['IPCHECKING_API_KEY', 'IPCHECKING_API_ENDPOINT'];
let envBackup;
const originalFetch = globalThis.fetch;
const originalLogError = logger.error;

beforeEach(() => {
    envBackup = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.IPCHECKING_API_KEY = 'SERVERKEY';
    process.env.IPCHECKING_API_ENDPOINT = 'https://upstream.test';
    logger.error = () => {};
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    logger.error = originalLogError;
    for (const k of ENV) {
        if (envBackup[k] === undefined) delete process.env[k];
        else process.env[k] = envBackup[k];
    }
});

const res = () => ({
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    set(k, v) { this.headers[k] = v; return this; },
});

// Records every upstream call and answers with `reply`.
const captureFetch = (reply = () => new Response('{}', { status: 200 })) => {
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return reply();
    };
    return calls;
};

const hostileHeaders = {
    referer: 'http://localhost/',
    cookie: 'session=VICTIM',
    authorization: 'Bearer FIREBASE',
    'x-forwarded-for': '6.6.6.6',
    'cf-connecting-ipv6': '2001:db8::6',
    'x-evil': 'injected',
    'content-length': '999',
    expect: '100-continue',
    connection: 'upgrade',
    'transfer-encoding': 'chunked',
    host: 'evil.example',
    'accept-language': 'ja-JP',
    'user-agent': 'UA/1.0',
};

describe('upstreamHeaders', () => {
    it('forwards only the allow-list, plus the server-resolved client IP', () => {
        const h = upstreamHeaders({ headers: hostileHeaders, ip: '203.0.113.9' });
        assert.deepEqual(Object.keys(h).sort(), ['accept-language', 'authorization', 'referer', 'user-agent', 'x-forwarded-for', 'x-real-ip']);
        assert.equal(h['x-forwarded-for'], '203.0.113.9');
        assert.equal(h.authorization, 'Bearer FIREBASE');
    });

    it('lets explicit extras win', () => {
        const h = upstreamHeaders({ headers: { 'content-type': 'text/plain' } }, { 'Content-Type': 'application/json' });
        assert.deepEqual(h, { 'Content-Type': 'application/json' });
    });

    it('resolveClientIp reads req.ip, CF-Connecting-IP only when declared, never the raw X-Forwarded-For', () => {
        assert.equal(resolveClientIp({ headers: { 'cf-connecting-ip': '198.51.100.1' }, ip: '10.0.0.1' }), '10.0.0.1');
        process.env.TRUST_CF_CONNECTING_IP = '1';
        try {
            assert.equal(resolveClientIp({ headers: { 'cf-connecting-ip': '198.51.100.1' }, ip: '10.0.0.1' }), '198.51.100.1');
        } finally {
            delete process.env.TRUST_CF_CONNECTING_IP;
        }
        assert.equal(resolveClientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }, ip: '203.0.113.9' }), '203.0.113.9');
        assert.equal(resolveClientIp({ headers: {} }), null);
    });
});

describe('IPCheck.ing proxy routes no longer forward visitor headers wholesale', () => {
    for (const [name, run] of [
        ['getuserinfo', (req, r) => getUserInfoHandler(req, r)],
        ['invisibility', (req, r) => invisibilityHandler({ ...req, query: { id: 'a'.repeat(28) } }, r)],
        ['ipchecking', (req, r) => ipCheckingHandler({ ...req, query: { ip: '8.8.8.8' } }, r)],
    ]) {
        it(`${name}: drops cookie, x-evil, hop headers and the client XFF`, async () => {
            const calls = captureFetch();
            await run({ method: 'GET', headers: { ...hostileHeaders }, query: {}, ip: '203.0.113.9' }, res());
            assert.equal(calls.length, 1);
            const sent = calls[0].options.headers;
            for (const banned of ['cookie', 'x-evil', 'content-length', 'expect', 'connection', 'transfer-encoding', 'host', 'cf-connecting-ipv6']) {
                assert.equal(banned in sent, false, banned);
            }
            assert.equal(sent['x-forwarded-for'], '203.0.113.9');
            assert.equal(sent.authorization, 'Bearer FIREBASE');
        });
    }

    // asn-profile's reputation section calls the same private API, and its
    // answer sits behind a 7-day public cache — no visitor's cookie or bearer
    // token belongs in it.
    it('asn-profile: the reputation call sends only the anonymous allow-list and the resolved IP', async () => {
        const calls = captureFetch(() => new Response('{"found":false}', { status: 200, headers: { 'content-type': 'application/json' } }));
        await asnProfileHandler({
            method: 'GET', headers: { ...hostileHeaders, 'cf-connecting-ip': '7.7.7.7' }, query: { asn: '13335' }, ip: '203.0.113.9',
        }, res());
        const rep = calls.find((c) => c.url.includes('/asnreputation'));
        assert.ok(rep, 'the reputation source was not asked');
        assert.deepEqual(Object.keys(rep.options.headers).sort(), ['accept-language', 'referer', 'user-agent', 'x-forwarded-for', 'x-real-ip']);
        assert.equal(rep.options.headers['x-forwarded-for'], '203.0.113.9');
        assert.equal(rep.options.headers.cookie, undefined);
        assert.equal(rep.options.headers.authorization, undefined);
    });

    it('updateuserachievement: a pretty-printed JSON body no longer fails on a stale content-length', async () => {
        const calls = captureFetch();
        const r = res();
        await updateAchievementHandler({ method: 'PUT', headers: { ...hostileHeaders }, query: {}, body: { achievement: 'x' } }, r);
        assert.equal(r.statusCode, 200);
        assert.equal('content-length' in calls[0].options.headers, false);
        assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    });
});

describe('ipchecking ?lang can no longer inject upstream parameters', () => {
    it('keeps exactly one ip= and one key=', async () => {
        const calls = captureFetch();
        await ipCheckingHandler({ method: 'GET', headers: {}, query: { ip: '8.8.8.8', lang: 'en&ip=10.0.0.1&key=ATTACKER' } }, res());
        const url = new URL(calls[0].url);
        assert.deepEqual(url.searchParams.getAll('ip'), ['8.8.8.8']);
        assert.deepEqual(url.searchParams.getAll('key'), ['SERVERKEY']);
        assert.equal(url.searchParams.get('lang'), 'en');
    });

    it('passes a well-formed tag through', async () => {
        const calls = captureFetch();
        await ipCheckingHandler({ method: 'GET', headers: {}, query: { ip: '8.8.8.8', lang: 'zh-TW' } }, res());
        assert.equal(new URL(calls[0].url).searchParams.get('lang'), 'zh-TW');
    });
});

describe('normalizeLang', () => {
    it('accepts BCP-47-ish tags and rejects everything else', () => {
        for (const ok of ['en', 'zh-CN', 'pt-BR', 'zh-Hant-TW', 'fil']) assert.equal(normalizeLang(ok), ok);
        for (const bad of ['en&x=1', 'en#', '', 'e', 'english-', ['en'], undefined, 'a'.repeat(50)]) assert.equal(normalizeLang(bad), 'en');
    });
});

describe('upstream error text stays out of responses', () => {
    it('invisibility: upstream 500 body is not echoed', async () => {
        captureFetch(() => new Response(JSON.stringify({ message: 'upstream secret detail' }), { status: 500 }));
        const r = res();
        await invisibilityHandler({ method: 'GET', headers: {}, query: { id: 'a'.repeat(28) } }, r);
        assert.equal(r.statusCode, 500);
        assert.doesNotMatch(JSON.stringify(r.body), /secret/);
    });

    it('getuserinfo: network error message is not echoed', async () => {
        globalThis.fetch = async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:443'); };
        const r = res();
        await getUserInfoHandler({ method: 'GET', headers: {}, query: {} }, r);
        assert.deepEqual(r.body, { error: 'Upstream request failed' });
    });
});

describe('cfradar view registry', () => {
    for (const view of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
        it(`?view=${view} is a 400, not a TypeError`, async () => {
            const r = res();
            await cfRadarHandler({ method: 'GET', headers: {}, query: { view } }, r);
            assert.equal(r.statusCode, 400);
            assert.deepEqual(r.body, { error: 'Invalid view' });
        });
    }
});

describe('country-name cache', () => {
    it('still answers after many distinct lang values', () => {
        for (let i = 0; i < 200; i++) getCountryName('US', `x-${i.toString(36)}`);
        assert.equal(getCountryName('JP', 'en'), 'Japan');
    });
});

describe('securityHeaders', () => {
    it('sets nosniff, frame and referrer policy, then continues', () => {
        const r = res();
        let next = false;
        securityHeaders({}, r, () => { next = true; });
        assert.equal(next, true);
        assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
        assert.equal(r.headers['X-Frame-Options'], 'SAMEORIGIN');
        assert.equal(r.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    });
});
