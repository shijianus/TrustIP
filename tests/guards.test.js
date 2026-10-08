import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { requireReferer, requirePublicIP, requireValidPrefix, requireValidDomain, requireValidProviderId, requireValidRecordType, requireValidReportId, requireValidCountry, requireSplitSignals } from '../common/guards.js';

// Minimal (req, res, next) stubs — just enough to observe what the
// middleware does.
function makeReq({ referer, query = {} } = {}) {
    return {
        headers: referer ? { referer } : {},
        query,
    };
}

function makeRes() {
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
    };
    return res;
}

describe('requireReferer', () => {
    it('calls next() when the referer is on the allow-list (localhost)', () => {
        let nextCalled = false;
        const req = makeReq({ referer: 'http://localhost/foo' });
        requireReferer(req, makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('returns 403 "What are you doing?" when no referer header', () => {
        const res = makeRes();
        let nextCalled = false;
        requireReferer(makeReq(), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error, 'What are you doing?');
        assert.equal(nextCalled, false);
    });

    it('returns 403 "Access denied" when referer is not on the allow-list', () => {
        const res = makeRes();
        let nextCalled = false;
        requireReferer(makeReq({ referer: 'http://evil.example/x' }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.error, 'Access denied');
        assert.equal(nextCalled, false);
    });
});

describe('requirePublicIP', () => {
    const guard = requirePublicIP();

    it('calls next() when ip query param is a valid IPv4', () => {
        let nextCalled = false;
        guard(makeReq({ query: { ip: '1.1.1.1' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('calls next() when ip query param is a valid IPv6', () => {
        let nextCalled = false;
        guard(makeReq({ query: { ip: '2001:4860:4860::8888' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('returns 400 "No IP address provided" when ip is missing', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: {} }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'No IP address provided');
        assert.equal(nextCalled, false);
    });

    it('returns 400 "Invalid IP address" when ip is malformed', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: { ip: 'nope' } }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'Invalid IP address');
        assert.equal(nextCalled, false);
    });

    it('rejects leading-zero IPv4 input before reaching an upstream handler', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: { ip: '8.8.8.08' } }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'Invalid IP address');
        assert.equal(nextCalled, false);
    });

    // Reserved space is well-formed but unanswerable by any upstream, so it
    // gets its own message — rejected before the handler, never fetched.
    for (const ip of ['10.0.0.1', '192.168.1.1', '127.0.0.1', '198.18.0.2', 'fd00::1', '::1']) {
        it(`returns 400 "Not a public IP address" for ${ip}`, () => {
            const res = makeRes();
            let nextCalled = false;
            guard(makeReq({ query: { ip } }), res, () => { nextCalled = true; });
            assert.equal(res.statusCode, 400);
            assert.equal(res.body.error, 'Not a public IP address');
            assert.equal(nextCalled, false);
        });
    }

    it('honors a custom param name', () => {
        const custom = requirePublicIP('target');
        let nextCalled = false;
        custom(makeReq({ query: { target: '8.8.8.8' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });
});

describe('requireValidPrefix', () => {
    const guard = requireValidPrefix();

    it('calls next() when prefix is a valid IPv4 CIDR', () => {
        let nextCalled = false;
        guard(makeReq({ query: { prefix: '8.8.8.0/24' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('calls next() when prefix is a valid IPv6 CIDR', () => {
        let nextCalled = false;
        guard(makeReq({ query: { prefix: '2001:4860:4860::/48' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('returns 400 "No prefix provided" when prefix is missing', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: {} }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'No prefix provided');
        assert.equal(nextCalled, false);
    });

    it('returns 400 "Invalid prefix" when prefix is malformed', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: { prefix: '8.8.8.0' } }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'Invalid prefix');
        assert.equal(nextCalled, false);
    });

    it('returns 400 when prefix length is out of v4 range', () => {
        const res = makeRes();
        guard(makeReq({ query: { prefix: '8.8.8.0/33' } }), res, () => {});
        assert.equal(res.statusCode, 400);
    });
});

describe('requireValidCountry', () => {
    const guard = requireValidCountry();

    it('calls next() and uppercases the code in place', () => {
        let nextCalled = false;
        const req = makeReq({ query: { country: 'iq' } });
        guard(req, makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(req.query.country, 'IQ');
    });

    it('returns 400 "No country provided" when country is missing', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: {} }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'No country provided');
        assert.equal(nextCalled, false);
    });

    it('returns 400 "Invalid country" for anything but two letters', () => {
        for (const bad of ['USA', 'U', 'U1', 'us,de', 'ÜS']) {
            const res = makeRes();
            guard(makeReq({ query: { country: bad } }), res, () => {});
            assert.equal(res.statusCode, 400, bad);
            assert.equal(res.body.error, 'Invalid country', bad);
        }
    });
});

describe('requireValidProviderId', () => {
    const guard = requireValidProviderId();

    it('calls next() for a whitelisted provider id', () => {
        let nextCalled = false;
        guard(makeReq({ query: { id: 'claude' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('returns 400 "No provider id provided" when id is missing', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: {} }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'No provider id provided');
        assert.equal(nextCalled, false);
    });

    it('returns 400 "Invalid provider id" for an unknown id', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: { id: 'not-a-provider' } }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'Invalid provider id');
        assert.equal(nextCalled, false);
    });
});

describe('requireValidReportId', () => {
    const guard = requireValidReportId();
    // A report id is 16 random bytes as base64url — always exactly 22 chars.
    const validId = 'AbC123-_xyz987654321ab';

    // This guard reads req.params (route param), not req.query.
    const makeParamsReq = (params) => ({ headers: {}, params });

    it('calls next() for a well-formed 22-char base64url id', () => {
        let nextCalled = false;
        guard(makeParamsReq({ id: validId }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('returns 400 when the id is missing', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeParamsReq({}), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'Invalid report id');
        assert.equal(nextCalled, false);
    });

    it('returns 400 for wrong length or non-base64url characters', () => {
        for (const bad of ['short', 'a'.repeat(23), 'a'.repeat(21), `${'a'.repeat(21)}+`, `${'a'.repeat(21)}/`]) {
            const res = makeRes();
            let nextCalled = false;
            guard(makeParamsReq({ id: bad }), res, () => { nextCalled = true; });
            assert.equal(res.statusCode, 400, `should reject "${bad}"`);
            assert.equal(nextCalled, false);
        }
    });
});

describe('requireValidRecordType', () => {
    const guard = requireValidRecordType();

    it('calls next() for a supported type', () => {
        let nextCalled = false;
        guard(makeReq({ query: { type: 'CAA' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('uppercases the type in place so the handler switch matches', () => {
        const req = makeReq({ query: { type: 'caa' } });
        guard(req, makeRes(), () => {});
        assert.equal(req.query.type, 'CAA');
    });

    it('rejects a missing type', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: {} }), res, () => { nextCalled = true; });
        assert.equal(nextCalled, false);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No record type provided' });
    });

    it('rejects a type the resolver does not handle, so DoH never forwards it', () => {
        for (const type of ['ANY', 'DNSKEY', 'HTTPS', 'PTR', '../etc']) {
            const res = makeRes();
            let nextCalled = false;
            guard(makeReq({ query: { type } }), res, () => { nextCalled = true; });
            assert.equal(nextCalled, false, type);
            assert.equal(res.statusCode, 400);
            assert.deepEqual(res.body, { error: 'Invalid record type' });
        }
    });
});

describe('requireValidDomain', () => {
    const guard = requireValidDomain();

    it('calls next() for a valid domain', () => {
        let nextCalled = false;
        guard(makeReq({ query: { domain: 'example.com' } }), makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
    });

    it('lowercases the domain in place (canonical cache key)', () => {
        const req = makeReq({ query: { domain: 'WWW.Example.COM' } });
        let nextCalled = false;
        guard(req, makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(req.query.domain, 'www.example.com');
    });

    it('supports a custom query parameter name', () => {
        const hostnameGuard = requireValidDomain('hostname');
        const req = makeReq({ query: { hostname: 'WWW.Example.COM' } });
        let nextCalled = false;
        hostnameGuard(req, makeRes(), () => { nextCalled = true; });
        assert.equal(nextCalled, true);
        assert.equal(req.query.hostname, 'www.example.com');
    });

    it('returns 400 when the domain is missing', () => {
        const res = makeRes();
        let nextCalled = false;
        guard(makeReq({ query: {} }), res, () => { nextCalled = true; });
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'No domain provided');
        assert.equal(nextCalled, false);
    });

    it('returns 400 for non-domain inputs', () => {
        for (const bad of ['not a domain', 'nodot', '1.2.3.4.5.', 'http://example.com', 'exa_mple.com']) {
            const res = makeRes();
            let nextCalled = false;
            guard(makeReq({ query: { domain: bad } }), res, () => { nextCalled = true; });
            assert.equal(res.statusCode, 400, `should reject "${bad}"`);
            assert.equal(nextCalled, false);
        }
    });
});

// -- POST /api/split: the profile signals ---------------------------------

// The one body-shaped input this API scores rather than proxies. Everything the
// guard lets through reaches a pure function that reads it field by field, so the
// ceilings here are what keep a stranger's request from becoming this process's
// CPU bill — and the dropping behaviour is what keeps a half-invalid payload from
// being silently reinterpreted as a different one.
describe('requireSplitSignals', () => {
    const run = (body) => {
        const req = { body };
        const res = makeRes();
        let next = false;
        requireSplitSignals()(req, res, () => { next = true; });
        return { req, res, next };
    };

    it('accepts a missing body as the empty question it is', () => {
        for (const body of [undefined, null, {}]) {
            const { req, next } = run(body);
            assert.ok(next, 'must reach the handler');
            assert.deepEqual(req.body, { signals: {}, countries: [] });
        }
    });

    it('rejects an array or a scalar body outright', () => {
        for (const body of [[1, 2], 'signals', 42]) {
            const { res, next } = run(body);
            assert.equal(res.statusCode, 400);
            assert.ok(!next);
        }
    });

    it('rejects a signals field that is not an object', () => {
        const { res } = run({ signals: ['geo'] });
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid signals' });
    });

    it('keeps only the six slices it knows', () => {
        const { req } = run({ signals: { geo: { available: true, countries: ['CN'] }, stolen: { available: true }, big: 'x'.repeat(500) } });
        assert.deepEqual(Object.keys(req.body.signals), ['geo']);
    });

    it('uppercases and dedupes region codes, and drops malformed ones', () => {
        const { req } = run({
            signals: { geo: { available: true, countries: ['cn', 'CN', 'XYZ', '', null, 'US'] } },
            countries: ['ir', 'IR', 'QQ'],
        });
        assert.deepEqual(req.body.signals.geo.countries, ['CN', 'US']);
        assert.deepEqual(req.body.countries, ['IR', 'QQ']);
    });

    it('caps every list, so a payload cannot grow the work', () => {
        const { req } = run({
            signals: {
                lang: { available: true, languages: Array.from({ length: 400 }, (_, i) => `en-US-${i}`) },
                net: { available: true, exitCountries: Array(200).fill('CN'), leakedCountries: Array(200).fill('US') },
                ime: { available: true, keys: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`Key${i}`, String.fromCharCode(97 + (i % 26))])) },
                tz: { available: true, zone: 'A'.repeat(4000) },
            },
        });
        assert.ok(req.body.signals.lang.languages.length <= 6);
        assert.ok(req.body.signals.net.exitCountries.length <= 12);
        assert.ok(Object.keys(req.body.signals.ime.keys).length <= 32);
        // Too long to be a zone name: dropped rather than truncated, because a
        // clipped zone resolves to no country and would read as a measurement.
        assert.equal(req.body.signals.tz.zone, undefined);
    });

    it('treats anything that is not a boolean true as not measured', () => {
        const { req } = run({ signals: { geo: { available: 'yes', countries: ['CN'] }, os: { available: 1 } } });
        assert.equal(req.body.signals.geo.available, false);
        assert.equal(req.body.signals.os.available, false);
    });
});
