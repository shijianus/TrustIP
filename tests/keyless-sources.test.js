// Specs for the key-free data paths a blank `.env` deployment relies on: the
// keyless tiers of api.ipapi.is / api.ip2location.io behind their geo routes,
// the `keylessGeo` flag that lists those cards, the dossier's extra key-free
// geolocation normalizers, the OONI route's long timeout and day cache, the RPKI
// prefix choice, and the /api/ai-news handler. Upstreams are stubbed.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import configsHandler from '../api/configs.js';
import ipapiisHandler, { modifyJsonForIPAPI, modifyFreeTierJson } from '../api/ipapi-is.js';
import ip2locationHandler from '../api/ip2location-io.js';
import ooniBlockingHandler, { OONI_TIMEOUT_MS, resetOoniCache } from '../api/ooni-blocking.js';
import edgeConfigs from '../functions/shared/configs.js';
import { countryCodeFromName } from '../common/country-name.js';
import { normaliseIpinfo, normaliseIpapiIsFree } from '../common/ip-dossier.js';
import { pickRpkiPrefix, ttlFor } from '../common/trust-signals.js';
import {
    applyConfigAvailability, createInitialIpDBs,
} from '../frontend/data/ip-databases.js';

const createRequest = (query = {}, method = 'GET') => ({ method, query, headers: {}, ip: '203.0.113.1' });
const createResponse = () => {
    const res = { statusCode: 200, headers: {}, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
    res.set = res.setHeader;
    return res;
};

const ENV = ['IPAPIIS_API_KEY', 'IP2LOCATION_API_KEY'];
const originalFetch = globalThis.fetch;
let envBackup = {};
beforeEach(() => { envBackup = Object.fromEntries(ENV.map((k) => [k, process.env[k]])); for (const k of ENV) delete process.env[k]; });
afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const k of ENV) { if (envBackup[k] === undefined) delete process.env[k]; else process.env[k] = envBackup[k]; }
});

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api.ipapi.is keyless tier', () => {
    const FREE = {
        ip: '52.26.208.45', is_bogon: false, company: 'Amazon Technologies Inc.', asn: 'AS16509 Amazon.com, Inc.',
        city: 'Boardman', region: 'Oregon', country: 'United States', lat: 45.83986, lon: -119.70058, timezone: 'America/Los_Angeles',
    };

    it('normalizes the flat free-tier body into the canonical shape', () => {
        assert.deepEqual(modifyFreeTierJson(FREE), {
            ip: '52.26.208.45', city: 'Boardman', region: 'Oregon', country: 'US', country_name: 'United States',
            country_code: 'US', latitude: 45.83986, longitude: -119.70058, asn: 'AS16509', org: 'Amazon Technologies Inc.',
        });
    });

    it('modifyJsonForIPAPI routes a string asn to the free-tier normalizer and keeps the keyed shape', () => {
        assert.equal(modifyJsonForIPAPI(FREE).asn, 'AS16509');
        const keyed = modifyJsonForIPAPI({ ip: '1.1.1.1', asn: { asn: 13335, org: 'Cloudflare' }, location: { city: 'X', country_code: 'US' }, is_datacenter: true });
        assert.equal(keyed.asn, 'AS13335');
        assert.equal(keyed.isHosting, true);
    });

    it('asks the keyless endpoint when no key is configured, and answers 200', async () => {
        const urls = [];
        globalThis.fetch = async (url) => { urls.push(String(url)); return jsonResponse(FREE); };
        const res = createResponse();
        await ipapiisHandler(createRequest({ ip: '52.26.208.45' }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(urls[0], 'https://api.ipapi.is?q=52.26.208.45');
        assert.equal(res.body.country_code, 'US');
    });

    it('keeps using a configured key', async () => {
        process.env.IPAPIIS_API_KEY = 'k1';
        const urls = [];
        globalThis.fetch = async (url) => { urls.push(String(url)); return jsonResponse({ ip: '1.1.1.1', asn: { asn: 1 }, location: {} }); };
        await ipapiisHandler(createRequest({ ip: '1.1.1.1' }), createResponse());
        assert.equal(urls[0], 'https://api.ipapi.is?q=1.1.1.1&key=k1');
    });
});

describe('api.ip2location.io keyless tier', () => {
    it('omits the key parameter when none is configured', async () => {
        const urls = [];
        globalThis.fetch = async (url) => {
            urls.push(String(url));
            return jsonResponse({ ip: '52.26.208.45', country_code: 'US', country_name: 'United States of America', region_name: 'Oregon', city_name: 'Portland', latitude: 45.5, longitude: -122.6, asn: '16509', as: 'Amazon.com Inc.' });
        };
        const res = createResponse();
        await ip2locationHandler(createRequest({ ip: '52.26.208.45' }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(urls[0], 'https://api.ip2location.io/?ip=52.26.208.45');
        assert.equal(res.body.asn, 'AS16509');
    });

    it('a blank-padded key list still counts as no key', async () => {
        process.env.IP2LOCATION_API_KEY = ' , ';
        const urls = [];
        globalThis.fetch = async (url) => { urls.push(String(url)); return jsonResponse({ ip: '1.1.1.1' }); };
        await ip2locationHandler(createRequest({ ip: '1.1.1.1' }), createResponse());
        assert.equal(urls[0], 'https://api.ip2location.io/?ip=1.1.1.1');
    });
});

describe('countryCodeFromName', () => {
    it('maps CLDR English names, case and punctuation insensitive', () => {
        assert.equal(countryCodeFromName('United States'), 'US');
        assert.equal(countryCodeFromName('germany'), 'DE');
        assert.equal(countryCodeFromName('Hong Kong SAR China'), 'HK');
    });

    it('answers null rather than guessing', () => {
        assert.equal(countryCodeFromName('Atlantis'), null);
        assert.equal(countryCodeFromName(''), null);
        assert.equal(countryCodeFromName(undefined), null);
    });
});

describe('keylessGeo flag', () => {
    it('Express lists the keyless vendors; the edge, which has no such routes, does not', async () => {
        const res = createResponse();
        configsHandler({ method: 'GET', headers: { referer: 'http://localhost/' } }, res);
        assert.equal(res.body.keylessGeo, true);
        const edge = await (edgeConfigs(new Headers())).json();
        assert.equal(edge.keylessGeo, false);
    });

    it('enables keyless sources without their key flag, and only those', () => {
        const out = applyConfigAvailability(createInitialIpDBs(), { keylessGeo: true });
        const byId = Object.fromEntries(out.map((db) => [db.id, db.enabled]));
        assert.equal(byId[1], true); // IPinfo.io
        assert.equal(byId[3], true); // IPAPI.is
        assert.equal(byId[4], true); // IP2Location.io
        assert.equal(byId[0], false); // IPCheck.ing — private API, no keyless tier
        assert.equal(byId[6], false); // MaxMind — needs its database
    });

    it('without the flag, keyed sources still follow their key', () => {
        const out = applyConfigAvailability(createInitialIpDBs(), { keylessGeo: false, ipInfo: false });
        assert.equal(out.find((db) => db.id === 1).enabled, false);
    });
});

describe('dossier key-free geolocation normalizers', () => {
    it('ipinfo.io: code + loc', () => {
        assert.deepEqual(normaliseIpinfo({ ip: '52.26.208.45', city: 'Boardman', region: 'Oregon', country: 'US', loc: '45.8399,-119.7006' }), {
            country: 'United States', country_code: 'US', region: 'Oregon', city: 'Boardman', lat: 45.8399, lon: -119.7006,
        });
        assert.equal(normaliseIpinfo({ ip: '10.0.0.1', bogon: true }), null);
        assert.equal(normaliseIpinfo({}), null);
    });

    it('api.ipapi.is free tier: English name → code', () => {
        assert.deepEqual(normaliseIpapiIsFree({ country: 'United States', region: 'Oregon', city: 'Boardman', lat: 45.8, lon: -119.7 }), {
            country: 'United States', country_code: 'US', region: 'Oregon', city: 'Boardman', lat: 45.8, lon: -119.7,
        });
        assert.equal(normaliseIpapiIsFree({ is_bogon: true, country: 'X' }), null);
    });
});

describe('RPKI prefix choice', () => {
    it('prefers the routed prefix over the allocation and the /24 floor', () => {
        assert.equal(pickRpkiPrefix({ routed: '52.24.0.0/14', allocation: '52.0.0.0/10', fallback: '52.26.208.0/24' }), '52.24.0.0/14');
        assert.equal(pickRpkiPrefix({ routed: null, allocation: '52.0.0.0/10', fallback: '52.26.208.0/24' }), '52.0.0.0/10');
        assert.equal(pickRpkiPrefix({ routed: null, allocation: '1.2.3.0 - 1.2.3.255', fallback: '1.2.3.0/24' }), '1.2.3.0/24');
    });

    it('holds a failed source for minutes, a fact for its family TTL', () => {
        const SIX_H = 6 * 60 * 60 * 1000;
        assert.equal(ttlFor({ failed: true }, SIX_H), 5 * 60 * 1000);
        assert.equal(ttlFor({ data: {} }, SIX_H), SIX_H);
        assert.equal(ttlFor({ failed: true }, 60 * 1000), 60 * 1000);
    });
});

describe('ooni-blocking timeout and day cache', () => {
    it('gives OONI far more than the 8s default', () => {
        assert.ok(OONI_TIMEOUT_MS >= 45000);
    });

    it('asks OONI once per hostname variant per day and serves repeats from memory', async () => {
        resetOoniCache();
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return jsonResponse({ result: [{ probe_cc: 'CN', blocking_type: 'dns', measurement_count: 10, anomaly_count: 9, confirmed_count: 0, failure_count: 0, ok_count: 1 }] });
        };
        const first = createResponse();
        await ooniBlockingHandler(createRequest({ domain: 'example.org' }), first);
        assert.equal(first.statusCode, 200);
        assert.equal(calls, 2); // apex + www.
        const second = createResponse();
        await ooniBlockingHandler(createRequest({ domain: 'example.org' }), second);
        assert.equal(calls, 2);
        assert.deepEqual(second.body.countries, first.body.countries);
    });

    it('does not cache a failure', async () => {
        resetOoniCache();
        let calls = 0;
        globalThis.fetch = async () => { calls += 1; return jsonResponse({}, 503); };
        const res = createResponse();
        await ooniBlockingHandler(createRequest({ domain: 'fail.example' }), res);
        assert.equal(res.statusCode, 500);
        const before = calls;
        await ooniBlockingHandler(createRequest({ domain: 'fail.example' }), createResponse());
        assert.ok(calls > before, 'second request asked OONI again');
    });
});

describe('ASN profile listing', () => {
    it('is gated on the route existing (asnProfile), not on a Radar key', async () => {
        const { TOOL_BY_SLUG } = await import('../frontend/data/tools.js');
        const { isToolAvailable } = await import('../frontend/utils/tool-availability.js');
        const asn = TOOL_BY_SLUG.get('asn');
        assert.equal(asn.requiresConfig, 'asnProfile');
        const res = createResponse();
        configsHandler({ method: 'GET', headers: { referer: 'http://localhost/' } }, res);
        assert.equal(res.body.asnProfile, true);
        assert.equal(res.body.cloudFlare, false);
        assert.equal(isToolAvailable(asn, res.body), true);
        const edge = await (edgeConfigs(new Headers())).json();
        assert.equal(isToolAvailable(asn, edge), false);
    });
});
