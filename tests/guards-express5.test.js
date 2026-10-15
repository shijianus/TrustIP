// The guards' canonical values must reach the handler through a real Express 5
// app. Express 5 re-parses `req.query` on every read, so a guard that wrote
// `req.query[k] = v` was a no-op there: `AS13335` reached the ASN handlers as
// NaN and `GOOGLE.COM` stayed mixed-case — while a plain-object request in a
// unit test showed the write working. These specs therefore go through
// `express()` and a real socket.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import express from 'express';

import {
    requireValidASN, requireValidDomain, requireValidCountry, requireValidRecordType, normalizeAsnQuery,
} from '../common/guards.js';

const listen = (app) => new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(server));
});

const getJson = (port, path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
});

describe('guards under Express 5', () => {
    let server;
    let port;
    before(async () => {
        const app = express();
        const echo = (name) => (req, res) => res.json({ seen: req.query[name], all: req.query });
        app.get('/asn', requireValidASN(), echo('asn'));
        app.get('/domain', requireValidDomain(), echo('domain'));
        app.get('/hostname', requireValidDomain('hostname'), echo('hostname'));
        app.get('/country', requireValidCountry(), echo('country'));
        app.get('/type', requireValidRecordType(), echo('type'));
        app.get('/whois', normalizeAsnQuery(), echo('q'));
        // Two guards in a row: the second must see the first one's write.
        app.get('/both', requireValidDomain('hostname'), requireValidRecordType(), (req, res) => res.json(req.query));
        server = await listen(app);
        port = server.address().port;
    });
    after(() => new Promise((resolve) => server.close(resolve)));

    it('hands the handler the canonical ASN number', async () => {
        assert.deepEqual((await getJson(port, '/asn?asn=AS13335')).body.seen, '13335');
        assert.deepEqual((await getJson(port, '/asn?asn=as013335')).body.seen, '13335');
        assert.deepEqual((await getJson(port, '/asn?asn=13335')).body.seen, '13335');
    });

    it('lowercases a domain', async () => {
        assert.equal((await getJson(port, '/domain?domain=GOOGLE.COM')).body.seen, 'google.com');
        assert.equal((await getJson(port, '/hostname?hostname=ExAmple.COM')).body.seen, 'example.com');
    });

    it('uppercases a country code and a record type', async () => {
        assert.equal((await getJson(port, '/country?country=us')).body.seen, 'US');
        assert.equal((await getJson(port, '/type?type=aaaa')).body.seen, 'AAAA');
    });

    it('canonicalises an AS-prefixed whois query and leaves other values alone', async () => {
        assert.equal((await getJson(port, '/whois?q=as13335')).body.seen, 'AS13335');
        assert.equal((await getJson(port, '/whois?q=Example.com')).body.seen, 'Example.com');
    });

    it('keeps the other parameters and composes across guards', async () => {
        const res = await getJson(port, '/both?hostname=ExAmple.COM&type=mx&extra=1');
        assert.deepEqual(res.body, { hostname: 'example.com', type: 'MX', extra: '1' });
    });

    it('still rejects what it rejected', async () => {
        assert.equal((await getJson(port, '/asn?asn=AS')).status, 400);
        assert.equal((await getJson(port, '/domain?domain=bad..com')).status, 400);
        assert.equal((await getJson(port, '/domain?domain=no-dot')).status, 400);
        assert.equal((await getJson(port, '/whois?q=AS99999999999')).status, 400);
    });
});

// The handler that showed the bug: /api/asn-profile with `AS13335` asked every
// source about AS "NaN". Through the real guard it must ask about 13335.
describe('/api/asn-profile behind requireValidASN under Express 5', () => {
    const originalFetch = globalThis.fetch;
    let server;
    let urls;
    before(async () => {
        const { default: asnProfileHandler } = await import('../api/asn-profile.js');
        urls = [];
        // The RDAP bootstrap answers with a real-shaped registry entry so the
        // autnum lookup goes on to build its per-ASN URL; everything else 503s.
        globalThis.fetch = async (url) => {
            urls.push(String(url));
            if (String(url) === 'https://data.iana.org/rdap/asn.json') {
                return new Response(JSON.stringify({
                    services: [[['13312-18431'], ['https://rdap.arin.net/registry/']]],
                }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return new Response('{}', { status: 503 });
        };
        const app = express();
        app.get('/api/asn-profile', requireValidASN(), asnProfileHandler);
        server = await listen(app);
    });
    after(async () => {
        globalThis.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
    });

    it('asks its upstreams about 13335, never NaN', async () => {
        await getJson(server.address().port, '/api/asn-profile?asn=AS13335');
        assert.ok(urls.length > 0, 'no upstream was asked');
        assert.equal(urls.some((u) => u.includes('NaN')), false, urls.join('\n'));
        assert.ok(urls.includes('https://rdap.arin.net/registry/autnum/13335'), urls.join('\n'));
    });
});
