// Smoke coverage for every Express handler under api/.
// Verifies method gating, param-presence checks, param-validity checks,
// and the "API key missing" early-return paths. We never hit the real
// upstream APIs — every assertion is on a branch that returns before
// any fetch fires.
//
// Referer + IP validation are enforced at the middleware layer now (see
// common/guards.js, tests/guards.test.js); handlers themselves no longer
// repeat those checks, so this file focuses on handler-specific branches.

import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';

import configsHandler from '../api/configs.js';
import googleMapHandler from '../api/google-map.js';
import dnsResolverHandler from '../api/dns-resolver.js';
import getUserInfoHandler from '../api/get-user-info.js';
import getWhoisHandler, { registryReplyFault } from '../api/get-whois.js';
import edgeWhoisHandler from '../functions/shared/whois.js';
import whoiser from 'whoiser';
import { cacheable } from '../common/cache-control.js';
import cfRadarHandler from '../api/cf-radar.js';
import invisibilityHandler from '../api/invisibility-test.js';
import macCheckerHandler, { createMacChecker } from '../api/mac-checker.js';
import githubStarsHandler, { resetGithubStarsCache } from '../api/github-stars.js';
import personaEvaluateHandler from '../api/persona.js';
import splitHandler from '../api/split.js';
import asnProfileHandler, { peeringdbReadiness, connectivityReadiness } from '../api/asn-profile.js';
import { isAsRelLoaded } from '../common/as-rel-db.js';
import { describeMac } from '../common/oui-db.js';
import { isCompleteProfile } from '../common/asn-profile.js';
import updateAchievementHandler from '../api/update-user-achievement.js';
import ipcheckIngHandler from '../api/ipcheck-ing.js';
import { getSessionResult as dnsLeakGetResult } from '../api/dns-leak-test.js';
import ooniBlockingHandler from '../api/ooni-blocking.js';
import globalpingProbesHandler from '../api/globalping-probes.js';
import serviceStatusHandler, {
    detailHandler as serviceStatusDetailHandler,
} from '../api/service-status.js';
import createReportHandler, { getReport as getReportHandler, normalizeTtlDays } from '../api/share-report.js';
import { modifyJsonForIPAPI } from '../api/ipapi-is.js';
import { modifyJson as modifyJsonForIpinfo } from '../api/ipinfo-io.js';
import { REPORT_VERSION } from '../common/report-schema.js';
import { EXIT_CANARIES } from '../common/site-packs.js';
import { PLAN_COUNTRIES_MAX } from '../common/split-profile.js';
import logger from '../common/logger.js';

// -- shared test utilities ------------------------------------------------

function createRequest(options = {}) {
    const method = options.method || 'GET';
    const query = options.query || {};
    const body = options.body;
    const referer = Object.hasOwn(options, 'referer') ? options.referer : 'http://localhost/';
    const headers = {};
    if (referer !== undefined) headers.referer = referer;
    return { method, headers, query, body };
}

function createResponse() {
    return {
        statusCode: 200,
        body: undefined,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        send(payload) { this.body = payload; return this; },
        headers: {},
        setHeader(name, value) { this.headers[name] = value; return this; },
    };
}

// Back up env keys touched by any test here; restore after each case.
const ENV_KEYS = [
    'IPCHECKING_API_KEY', 'IPCHECKING_API_ENDPOINT',
    'IPAPIIS_API_KEY',
    'IPINFO_API_KEY', 'IP2LOCATION_API_KEY',
    'CLOUDFLARE_API_KEY', 'GOOGLE_MAP_API_KEY',
    'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_KV_NAMESPACE_ID',
    // Pre-rename spellings, still honored as fallbacks.
    'IPINFO_API_TOKEN', 'CLOUDFLARE_API',
];
let envBackup = {};

// Stream tests stub globalThis.fetch; restore the real one after each case.
const originalFetch = globalThis.fetch;

beforeEach(() => {
    envBackup = {};
    for (const k of ENV_KEYS) envBackup[k] = process.env[k];
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const k of ENV_KEYS) {
        if (envBackup[k] === undefined) delete process.env[k];
        else process.env[k] = envBackup[k];
    }
});

// -- configs handler ------------------------------------------------------

describe('configs handler', () => {
    it('rejects non-GET with 405 before reading config state', () => {
        const res = createResponse();
        configsHandler(createRequest({ method: 'POST' }), res);
        assert.equal(res.statusCode, 405);
        assert.deepEqual(res.body, { message: 'Method Not Allowed' });
    });

    it('returns boolean config flags for localhost requests', () => {
        const res = createResponse();
        configsHandler(createRequest(), res);
        assert.equal(res.statusCode, 200);
        for (const key of ['map', 'ipInfo', 'ipChecking', 'ip2location', 'originalSite', 'cloudFlare', 'ipapiis', 'reportSharing', 'trust', 'dossier']) {
            assert.equal(typeof res.body[key], 'boolean');
        }
        assert.equal(res.body.originalSite, false);
    });

    // The two route tables differ, so the two `configs` halves differ too — but
    // only in values. A key the SPA can read on one deployment and not the other
    // is how a panel ends up fetching a route that is not there.
    it('serves the trust score and the dossier, which Express always mounts', () => {
        const res = createResponse();
        configsHandler(createRequest(), res);
        assert.equal(res.body.trust, true);
        assert.equal(res.body.dossier, true);
    });

    it('varies on Referer, since originalSite depends on it and the route is cached', () => {
        const res = createResponse();
        configsHandler(createRequest(), res);
        assert.equal(res.headers.Vary, 'Referer');
    });

    it('honors the pre-rename env spellings as fallbacks', () => {
        delete process.env.IPINFO_API_KEY;
        delete process.env.CLOUDFLARE_API_KEY;
        process.env.IPINFO_API_TOKEN = 'legacy-token';
        process.env.CLOUDFLARE_API = 'legacy-key';
        const res = createResponse();
        configsHandler(createRequest(), res);
        assert.equal(res.body.ipInfo, true);
        assert.equal(res.body.cloudFlare, true);
    });
});

// -- google-map handler ---------------------------------------------------

describe('google-map handler', () => {
    // Express-ish streaming response: a real Writable so pipeline() can pipe
    // into it, plus the status/json surface the handler's error paths use.
    const createStreamResponse = () => {
        const chunks = [];
        const res = new Writable({
            write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
        });
        res.locals = {};
        res.chunks = chunks;
        res.jsonCalls = [];
        Object.defineProperty(res, 'headersSent', { get: () => chunks.length > 0 });
        res.setHeader = () => res;
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (payload) => { res.jsonCalls.push(payload); res.body = payload; return res; };
        return res;
    };

    const jpegUpstream = (streamInit) => async () => new Response(
        new ReadableStream(streamInit),
        { headers: { 'content-type': 'image/jpeg' } },
    );

    const mapQuery = { query: { latitude: '1.0', longitude: '2.0', language: 'en' } };

    // The upstream-path cases below need a key; the shared afterEach restores it.
    beforeEach(() => { process.env.GOOGLE_MAP_API_KEY = 'test-map-key'; });

    it('answers 500 before any request leaves when no key is configured', async () => {
        delete process.env.GOOGLE_MAP_API_KEY;
        let fetched = false;
        globalThis.fetch = async () => { fetched = true; return new Response(''); };
        const res = createResponse();
        await googleMapHandler(createRequest(mapQuery), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
        assert.equal(fetched, false);
    });

    it('rejects invalid map parameters without calling the external API', () => {
        const res = createResponse();
        googleMapHandler(createRequest({
            query: { latitude: 'not-a-number', longitude: '0', language: 'en' },
        }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid request' });
    });

    it('rejects coordinates outside the globe without calling the external API', async () => {
        let fetched = false;
        globalThis.fetch = async () => { fetched = true; return new Response(''); };
        for (const query of [
            { latitude: '999', longitude: '0.0', language: 'en' },
            { latitude: '0.0', longitude: '-5000', language: 'en' },
        ]) {
            const res = createResponse();
            await googleMapHandler(createRequest({ query }), res);
            assert.equal(res.statusCode, 400);
        }
        assert.equal(fetched, false);
    });

    it('redirects any other spelling of a place to its one-decimal URL instead of calling Google', async () => {
        let fetched = false;
        globalThis.fetch = async () => { fetched = true; return new Response(''); };
        const cases = [
            [{ latitude: '35.689487', longitude: '139.691711', language: 'en' }, 'latitude=35.7&longitude=139.7&language=en'],
            [{ latitude: '35.70000', longitude: '139.7', language: 'en' }, 'latitude=35.7&longitude=139.7&language=en'],
            [{ latitude: '35.7', longitude: '139.7', language: 'en', CanvasMode: 'x1' }, 'latitude=35.7&longitude=139.7&language=en'],
            [{ latitude: '35.7', longitude: '139.7', language: 'en', cb: '1' }, 'latitude=35.7&longitude=139.7&language=en'],
            [{ latitude: '35.71', longitude: '139.7', language: 'en', CanvasMode: 'Dark' }, 'latitude=35.7&longitude=139.7&language=en&CanvasMode=Dark'],
        ];
        for (const [query, target] of cases) {
            const res = createResponse();
            res.locals = { cacheControl: 'public, max-age=31536000' };
            res.redirect = (code, url) => { res.statusCode = code; res.location = url; return res; };
            await googleMapHandler(createRequest({ query }), res);
            assert.equal(res.statusCode, 301, JSON.stringify(query));
            assert.equal(res.location, `/api/map?${target}`);
            assert.equal(res.headers['Cache-Control'], 'public, max-age=31536000');
        }
        assert.equal(fetched, false);
    });

    it('streams the upstream image through to completion', async () => {
        globalThis.fetch = jpegUpstream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('jpeg bytes'));
                controller.close();
            },
        });
        const res = createStreamResponse();
        await googleMapHandler(createRequest(mapQuery), res);
        assert.equal(Buffer.concat(res.chunks).toString(), 'jpeg bytes');
        assert.equal(res.writableFinished, true);
    });

    it('destroys a partial response instead of crashing when the upstream body fails', async () => {
        globalThis.fetch = jpegUpstream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('partial'));
                setImmediate(() => controller.error(new Error('upstream reset')));
            },
        });
        const res = createStreamResponse();
        // Resolving without an unhandled 'error' event is the crash regression.
        await googleMapHandler(createRequest(mapQuery), res);
        assert.equal(res.destroyed, true);
        assert.equal(res.jsonCalls.length, 0);
    });

    it('cancels the upstream body silently when the client disconnects', async () => {
        let bodyCancelled = false;
        globalThis.fetch = jpegUpstream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode('partial'));
            },
            cancel() { bodyCancelled = true; },
        });
        const errorCalls = [];
        const originalError = logger.error;
        logger.error = (...args) => { errorCalls.push(args); };
        try {
            const res = createStreamResponse();
            const handlerPromise = googleMapHandler(createRequest(mapQuery), res);
            await new Promise((resolve) => setImmediate(resolve));
            res.destroy();
            await handlerPromise;
            await new Promise((resolve) => setImmediate(resolve));
            assert.equal(bodyCancelled, true);
            assert.equal(res.jsonCalls.length, 0);
            assert.equal(errorCalls.length, 0);
        } finally {
            logger.error = originalError;
        }
    });

    it('returns 500 JSON when the upstream fetch itself rejects', async () => {
        globalThis.fetch = async () => { throw new Error('connect timeout'); };
        const res = createStreamResponse();
        await googleMapHandler(createRequest(mapQuery), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'Upstream request failed' });
    });
});

// -- dns-resolver handler -------------------------------------------------

describe('dns-resolver handler', () => {
    it('rejects non-GET with 405 before DNS lookup', async () => {
        const res = createResponse();
        await dnsResolverHandler(createRequest({ method: 'POST' }), res);
        assert.equal(res.statusCode, 405);
        assert.deepEqual(res.body, { message: 'Method Not Allowed' });
    });
});

// -- get-whois handler ----------------------------------------------------

describe('get-whois handler', () => {
    it('rejects missing ?q', async () => {
        const res = createResponse();
        await getWhoisHandler(createRequest(), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No address provided' });
    });

    it('rejects neither-IP-nor-domain inputs before calling whoiser', async () => {
        const res = createResponse();
        await getWhoisHandler(createRequest({ query: { q: 'not an address' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid IP or address' });
    });

    for (const ip of ['10.92.24.150', '192.168.1.1', '198.18.0.2', 'fd00::1', '::1']) {
        it(`rejects the non-public address ${ip} before any lookup`, async () => {
            const res = createResponse();
            await getWhoisHandler(createRequest({ query: { q: ip } }), res);
            assert.equal(res.statusCode, 400);
            assert.deepEqual(res.body, { error: 'Not a public IP address' });
        });
    }

    // The AS branch lives past validation, so the registry is stubbed rather than
    // asked: IANA's asn.json first (which server answers), then that server.
    const stubAsnRdap = (autnumResponder) => {
        const called = [];
        globalThis.fetch = async (url, options) => {
            called.push(String(url));
            if (String(url).includes('data.iana.org/rdap/asn.json')) {
                return {
                    ok: true,
                    json: async () => ({ services: [[['1-4294967294'], ['https://rdap.arin.net/registry/']]] }),
                };
            }
            return autnumResponder(String(url), options);
        };
        return called;
    };

    it('answers an AS number with the registry record, keyed by who answered', async () => {
        stubAsnRdap(async () => ({
            ok: true,
            json: async () => ({
                objectClassName: 'autnum',
                handle: 'AS15169',
                name: 'GOOGLE',
                startAutnum: 15169,
                endAutnum: 15169,
                status: ['active'],
                events: [{ eventAction: 'registration', eventDate: '2000-03-30T00:00:00-05:00' }],
                entities: [],
            }),
        }));
        const res = createResponse();
        await getWhoisHandler(createRequest({ query: { q: 'AS15169' } }), res);
        assert.equal(res.statusCode, 200);
        const [host, record] = Object.entries(res.body)[0];
        assert.equal(host, 'rdap.arin.net');
        assert.match(record.__raw, /^ASNumber: 15169/m);
        assert.match(record.__raw, /ASName: GOOGLE/);
        // The handle already spells the prefix; printing `ASHandle: AS15169` twice
        // as `ASAS15169` is the way this goes wrong.
        assert.doesNotMatch(record.__raw, /ASAS\d/);
    });

    it('reads a bare number as an AS, not as an invalid query', async () => {
        const called = stubAsnRdap(async () => ({
            ok: true,
            json: async () => ({ handle: 'AS9268', name: 'X', entities: [] }),
        }));
        const res = createResponse();
        await getWhoisHandler(createRequest({ query: { q: '9268' } }), res);
        assert.equal(res.statusCode, 200);
        assert.ok(called.some((u) => u.includes('/autnum/9268')), 'asked the registry for the number');
    });

    // An unallocated number is an answer, not an outage: the page shows "no
    // record". Before this branch existed, the registry's 404 became a 500 and the
    // SPA rendered it as "the lookup broke".
    for (const status of [404, 400]) {
        it(`maps a registry ${status} for an AS to no record, not to a server error`, async () => {
            stubAsnRdap(async () => ({
                ok: false,
                status,
                json: async () => ({ errorCode: status, title: 'Not Found' }),
            }));
            const res = createResponse();
            await getWhoisHandler(createRequest({ query: { q: 'AS4294967200' } }), res);
            assert.equal(res.statusCode, 404);
        });
    }

    it('rejects an out-of-range number as not an AS at all', async () => {
        const res = createResponse();
        await getWhoisHandler(createRequest({ query: { q: '4294967295' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid IP or address' });
    });

    it('answers an AS lookup that broke upstream with 502 and none of its error text', async () => {
        stubAsnRdap(async () => { throw new Error('connect ECONNREFUSED 10.0.0.7:443'); });
        const res = createResponse();
        await getWhoisHandler(createRequest({ query: { q: 'AS15169' } }), res);
        assert.equal(res.statusCode, 502);
        assert.deepEqual(res.body, { error: 'Upstream request failed' });
    });
});

// -- get-whois: registry text that is not a record -------------------------

// Port-43 servers say "no" in prose; whoiser parses it into a record-shaped
// object. Upstreams are stubbed: whoiser's two entry points on the module object
// the handler imports, and globalThis.fetch for RDAP (restored in afterEach).
describe('get-whois registry replies', () => {
    const realDomain = whoiser.domain;
    const realIp = whoiser.ip;
    afterEach(() => {
        whoiser.domain = realDomain;
        whoiser.ip = realIp;
    });

    // whoiser.domain()'s shape for whois.nic.io answering `127.0.0.1.nip.io`.
    const MALFORMED = {
        'whois.nic.io': {
            'Domain Status': [],
            'Name Server': [],
            '>>> Last update of WHOIS database': '2026-10-14T01:57:32Z <<<',
            text: ['Malformed request.', '', 'Terms of Use: Access to WHOIS information is provided to assist persons…'],
            __raw: 'Malformed request.\r\n>>> Last update of WHOIS database: 2026-10-14T01:57:32Z <<<\r\n\r\nTerms of Use: Access to WHOIS information is provided to assist persons…\r\n',
        },
    };
    const NO_MATCH = {
        'whois.verisign-grs.com': {
            'Domain Status': [],
            'Name Server': [],
            '>>> Last update of whois database': '2026-10-15T01:00:00Z <<<',
            text: ['No match for "UNREGISTERED-XQ7Z.COM".'],
            __raw: 'No match for "UNREGISTERED-XQ7Z.COM".\r\n>>> Last update of whois database: 2026-10-15T01:00:00Z <<<\r\n\r\nNOTICE: The expiration date displayed in this record…\r\n',
        },
    };
    const RECORD = {
        'whois.verisign-grs.com': {
            'Domain Name': 'EXAMPLE.COM',
            'Domain Status': ['clientTransferProhibited'],
            'Name Server': ['a.iana-servers.net'],
            text: [],
            __raw: 'Domain Name: EXAMPLE.COM\r\nRegistry Domain ID: 2336799_DOMAIN_COM-VRSN\r\n',
        },
    };
    // One bootstrap for every case: rdap.js caches dns.json for the process.
    const DNS_BOOTSTRAP = { services: [[['io', 'com'], ['https://rdap.registry.test/']]] };
    const stubRdap = (domainResponder) => {
        const called = [];
        globalThis.fetch = async (url) => {
            called.push(String(url));
            if (String(url).endsWith('/rdap/dns.json')) return { ok: true, status: 200, json: async () => DNS_BOOTSTRAP };
            return domainResponder(String(url));
        };
        return called;
    };
    // The route as backend-server.js wires it: every /api answer starts no-store,
    // and cacheable() stamps a 2xx only.
    const runRoute = async (q) => {
        const req = createRequest({ query: { q } });
        const res = { ...createResponse(), locals: {} };
        res.setHeader('Cache-Control', 'no-store');
        cacheable(24 * 60 * 60)(req, res, () => {});
        await getWhoisHandler(req, res);
        return res;
    };

    it('classifies registry prose, and leaves real records alone', () => {
        assert.equal(registryReplyFault(MALFORMED), 'error');
        assert.equal(registryReplyFault(NO_MATCH), 'no-match');
        assert.equal(registryReplyFault(RECORD), null);
        // An RIR reply (whoiser.ip) is the object itself, its verdict in % comments.
        assert.equal(registryReplyFault({ __raw: '% This is the RIPE Database query service.\n%\n%ERROR:101: no entries found\n' }), 'no-match');
        assert.equal(registryReplyFault({ __raw: '%ERROR:201: access denied for 10.0.0.1\n' }), 'error');
        assert.equal(registryReplyFault({ range: '8.8.8.0 - 8.8.8.255', NetName: 'GOGL', __raw: 'NetRange: 8.8.8.0 - 8.8.8.255\n' }), null);
        // A refusal line inside a real record is not a verdict on the record.
        assert.equal(registryReplyFault({ s: { ...RECORD['whois.verisign-grs.com'], __raw: 'Error: see below\nDomain Name: EXAMPLE.COM\n' } }), null);
        // Text this does not recognise keeps today's behaviour.
        assert.equal(registryReplyFault({ s: { 'Domain Status': [], 'Name Server': [], __raw: 'Some registry banner\n' } }), null);
        assert.equal(registryReplyFault(null), null);
    });

    it('reads the free-name replies of DENIC, SIDN, .it, EURid, KISA and TWNIC as misses', () => {
        // Shapes as whoiser parsed them from the live registries (audit 6).
        const free = {
            de: { 'whois.denic.de': { 'Domain Status': ['free'], 'Name Server': [], 'Domain Name': 'zz-free.de', text: [], __raw: 'Domain: zz-free.de\nStatus: free\n' } },
            nl: { 'whois.domain-registry.nl': { 'Domain Status': [], 'Name Server': [], text: [], __raw: 'zz-free.nl is free\n' } },
            it: { 'whois.nic.it': { 'Domain Status': ['AVAILABLE'], 'Name Server': [], 'Domain Name': 'zz-free.it', text: [], __raw: 'Domain:             zz-free.it\nStatus:             AVAILABLE\n' } },
            eu: { 'whois.eu': { 'Domain Status': ['AVAILABLE'], 'Name Server': [], 'Domain Name': 'zz-free.eu', Script: 'LATIN', text: [], __raw: '% The WHOIS service offered by EURid\n%\nDomain: zz-free.eu\nScript: LATIN\nStatus: AVAILABLE\n' } },
            kr: { 'whois.kr': { 'Domain Status': [], 'Name Server': [], query: 'zz-free.kr', text: [], __raw: 'query : zz-free.kr\n\n\n# KOREAN(UTF8)\n\n상기 도메인이름은 등록되어 있지 않습니다.\n상기 도메인이름의 사용을 원하실 경우 도메인이름 등록대행자를 통해 \n등록 신청하시기 바랍니다.\n\n\n\n# ENGLISH\n\nThe requested domain was not found in the Registry or Registrar’s WHOIS Server.\n' } },
            tw: { 'whois.twnic.net.tw': { 'Domain Status': [], 'Name Server': [], text: [], __raw: 'No Found\n' } },
        };
        for (const [tld, reply] of Object.entries(free)) assert.equal(registryReplyFault(reply), 'no-match', tld);
        // A registered .de / .eu keeps its record: a live status, or a name server beside it.
        assert.equal(registryReplyFault({ s: { 'Domain Status': ['connect'], 'Name Server': ['ns1.example.de'], 'Domain Name': 'example.de', __raw: 'Domain: example.de\nNserver: ns1.example.de\nStatus: connect\n' } }), null);
        assert.equal(registryReplyFault({ s: { 'Domain Status': ['AVAILABLE'], 'Name Server': ['ns1.example.eu'], 'Domain Name': 'example.eu', __raw: 'Domain: example.eu\n' } }), null);
        assert.equal(registryReplyFault({ 'whois.nic.io': { error: 'Timeout' } }), null);
    });

    it('answers a registry refusal that RDAP cannot settle with 502, no-store, no registry text', async () => {
        whoiser.domain = async () => MALFORMED;
        const called = stubRdap(async () => ({ ok: false, status: 503, json: async () => ({}) }));
        const res = await runRoute('127.0.0.1.nip.io');
        assert.equal(res.statusCode, 502);
        assert.equal(res.headers['Cache-Control'], 'no-store');
        assert.deepEqual(res.body, { error: 'Upstream request failed' });
        assert.ok(called.some((u) => u.includes('/domain/127.0.0.1.nip.io')), 'asked RDAP after the refusal');
    });

    it('answers a registry refusal on a TLD without RDAP with 502, not "no record"', async () => {
        whoiser.domain = async () => ({ 'whois.nic.zz': { ...MALFORMED['whois.nic.io'] } });
        stubRdap(async () => { throw new Error('unexpected RDAP call'); });
        const res = await runRoute('127.0.0.1.nip.zz');
        assert.equal(res.statusCode, 502);
        assert.equal(res.headers['Cache-Control'], 'no-store');
    });

    it('serves RDAP when the registry refused port 43 but RDAP has the record', async () => {
        whoiser.domain = async () => MALFORMED;
        stubRdap(async () => ({ ok: true, status: 200, json: async () => ({ objectClassName: 'domain', ldhName: 'nip.io', events: [], entities: [] }) }));
        const res = await runRoute('nip.io');
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Cache-Control'], 'public, max-age=86400');
        assert.ok(res.body['rdap.registry.test']);
    });

    it('answers a registry refusal plus an RDAP 404 with no record', async () => {
        whoiser.domain = async () => MALFORMED;
        stubRdap(async () => ({ ok: false, status: 404, json: async () => ({}) }));
        const res = await runRoute('127.0.0.1.nip.io');
        assert.equal(res.statusCode, 404);
        assert.equal(res.headers['Cache-Control'], 'no-store');
    });

    it('answers the registry\'s own "No match" with 404, no-store, without asking RDAP', async () => {
        whoiser.domain = async () => NO_MATCH;
        const called = stubRdap(async () => { throw new Error('unexpected RDAP call'); });
        const res = await runRoute('unregistered-xq7z.com');
        assert.equal(res.statusCode, 404);
        assert.equal(res.headers['Cache-Control'], 'no-store');
        assert.deepEqual(res.body, { error: 'Domain not found: unregistered-xq7z.com' });
        assert.equal(called.length, 0);
    });

    it('still serves and caches a real port-43 record', async () => {
        whoiser.domain = async () => RECORD;
        const res = await runRoute('example.com');
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers['Cache-Control'], 'public, max-age=86400');
        assert.equal(res.body, RECORD);
    });

    // The IP path reaches whoiser only after RDAP fails, so fetch fails first.
    for (const [raw, status] of [
        ['%ERROR:101: no entries found\n', 404],
        ['Query rate limit exceeded\n', 502],
    ]) {
        it(`answers an RIR fallback reply ${JSON.stringify(raw.trim())} with ${status}, no-store`, async () => {
            globalThis.fetch = async () => { throw new Error('rdap down'); };
            whoiser.ip = async () => ({ text: [], __raw: raw });
            const res = await runRoute('193.0.6.139');
            assert.equal(res.statusCode, status);
            assert.equal(res.headers['Cache-Control'], 'no-store');
            assert.doesNotMatch(JSON.stringify(res.body), /rate limit|ERROR:101|rdap down/);
        });
    }

    it('edge: an RDAP fault is 502 no-store with no upstream text', async () => {
        stubRdap(async () => ({ ok: false, status: 500, json: async () => ({ title: 'internal' }) }));
        const response = await edgeWhoisHandler(new URLSearchParams({ q: 'example.com' }));
        assert.equal(response.status, 502);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.deepEqual(await response.json(), { error: 'Upstream request failed' });
    });
});

// -- github-stars handler -------------------------------------------------

describe('github-stars handler', () => {
    it('rejects non-GET with 405 before hitting GitHub', async () => {
        const res = createResponse();
        await githubStarsHandler(createRequest({ method: 'POST' }), res);
        assert.equal(res.statusCode, 405);
        assert.deepEqual(res.body, { message: 'Method Not Allowed' });
    });

    it('asks GitHub once per hour however the query string varies', async () => {
        resetGithubStarsCache();
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return { status: 200, ok: true, json: async () => ({ stargazers_count: 42 }) };
        };
        for (let i = 0; i < 5; i += 1) {
            const res = createResponse();
            await githubStarsHandler(createRequest({ method: 'GET', query: { n: String(i) } }), res);
            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.body, { stars: 42 });
        }
        assert.equal(calls, 1);
        resetGithubStarsCache();
    });

    it('concurrent misses share one GitHub call, and a failure is held briefly too', async () => {
        resetGithubStarsCache();
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return { status: 403, ok: false, json: async () => ({}) };
        };
        const answers = await Promise.all([0, 1, 2].map(async () => {
            const res = createResponse();
            await githubStarsHandler(createRequest({ method: 'GET' }), res);
            return res;
        }));
        for (const res of answers) {
            assert.equal(res.statusCode, 500);
            assert.deepEqual(res.body, { error: 'Failed to fetch GitHub stars' });
        }
        const again = createResponse();
        await githubStarsHandler(createRequest({ method: 'GET' }), again);
        assert.equal(again.statusCode, 500);
        assert.equal(calls, 1);
        resetGithubStarsCache();
    });
});

// -- persona handler (thin proxy) -----------------------------------------

describe('persona handler', () => {
    it('rejects non-POST with 405', async () => {
        const res = createResponse();
        await personaEvaluateHandler(createRequest({ method: 'GET' }), res);
        assert.equal(res.statusCode, 405);
        assert.deepEqual(res.body, { error: 'Method Not Allowed' });
    });

    it('reports the missing API key rather than calling out', async () => {
        delete process.env.IPCHECKING_API_KEY;
        const res = createResponse();
        await personaEvaluateHandler(createRequest({ method: 'POST', body: {} }), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
    });

    it('rejects a call carrying no persona', async () => {
        process.env.IPCHECKING_API_KEY = 'test-key';
        process.env.IPCHECKING_API_ENDPOINT = 'https://upstream.invalid';
        const res = createResponse();
        await personaEvaluateHandler(createRequest({ method: 'POST', body: { observation: {} } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No persona provided' });
    });

    it('passes the upstream status and payload back verbatim', async () => {
        process.env.IPCHECKING_API_KEY = 'test-key';
        process.env.IPCHECKING_API_ENDPOINT = 'https://upstream.invalid';
        let requested;
        globalThis.fetch = async (url, options) => {
            requested = { url: String(url), options };
            return {
                status: 200,
                ok: true,
                json: async () => ({ grade: 'B', results: [] }),
            };
        };

        const req = createRequest({ method: 'POST', body: { persona: { country: 'JP' } } });
        req.headers['accept-language'] = 'ja-JP,ja;q=0.9';
        // Framing headers describe this hop; the body is re-serialized here, so
        // forwarding them would announce a length that no longer matches.
        req.headers['content-length'] = '999';
        req.headers.host = 'ipcheck.ing';
        req.headers['content-type'] = 'application/json';
        const res = createResponse();
        await personaEvaluateHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.grade, 'B');
        // The visitor's own Accept-Language is one of the things being checked,
        // so it has to reach the evaluator untouched.
        assert.equal(requested.options.headers['accept-language'], 'ja-JP,ja;q=0.9');
        assert.equal('content-length' in requested.options.headers, false);
        assert.equal('host' in requested.options.headers, false);
        // Exactly one content-type reaches the upstream: two would arrive as
        // "application/json, application/json" and be refused with 415.
        assert.equal(requested.options.headers['Content-Type'], 'application/json');
        assert.equal('content-type' in requested.options.headers, false);
        assert.match(requested.url, /\/persona\/evaluate\?key=test-key$/);
    });

    it('answers 502 when the evaluator cannot be reached', async () => {
        process.env.IPCHECKING_API_KEY = 'test-key';
        process.env.IPCHECKING_API_ENDPOINT = 'https://upstream.invalid';
        globalThis.fetch = async () => { throw new Error('network down'); };
        const res = createResponse();
        await personaEvaluateHandler(
            createRequest({ method: 'POST', body: { persona: { country: 'JP' } } }), res);
        assert.equal(res.statusCode, 502);
        assert.deepEqual(res.body, { error: 'Upstream fetch failed' });
    });
});

// -- cf-radar handler -----------------------------------------------------
// One dispatch route for all Radar views; params are validated by each
// view's guards from common/guards.js, so per-view checks here only cover
// the dispatch wiring. The pure transform pipeline (outage normalize/merge,
// traffic matrix) is unit-tested in tests/cf-radar.test.js.

describe('cf-radar handler', () => {
    it('rejects non-GET methods', async () => {
        const res = createResponse();
        await cfRadarHandler(createRequest({ method: 'POST', query: { view: 'outages' } }), res);
        assert.equal(res.statusCode, 405);
    });

    it('rejects missing ?view', async () => {
        const res = createResponse();
        await cfRadarHandler(createRequest(), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No view provided' });
    });

    it('rejects an unknown ?view', async () => {
        const res = createResponse();
        await cfRadarHandler(createRequest({ query: { view: 'nope' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid view' });
    });

    it("runs the asn view's guard: missing ?asn", async () => {
        const res = createResponse();
        await cfRadarHandler(createRequest({ query: { view: 'asn' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No ASN provided' });
    });

    it("runs the asn view's guard: non-numeric ASN", async () => {
        const res = createResponse();
        await cfRadarHandler(createRequest({ query: { view: 'asn', asn: 'not-an-asn' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid ASN' });
    });

    for (const asn of ['AS0', '0', '4294967296', '00000000013335']) {
        it(`runs the asn view's guard: out-of-range or overlong ASN ${asn}`, async () => {
            const res = createResponse();
            await cfRadarHandler(createRequest({ query: { view: 'asn', asn } }), res);
            assert.equal(res.statusCode, 400);
            assert.deepEqual(res.body, { error: 'Invalid ASN' });
        });
    }

    it("runs the bgp-prefixes view's guard: non-numeric ASN", async () => {
        const res = createResponse();
        await cfRadarHandler(createRequest({ query: { view: 'bgp-prefixes', asn: 'nope' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid ASN' });
    });

    it('serves bgp-prefixes from pfx2as with a countries list', async () => {
        process.env.CLOUDFLARE_API_KEY = 'test-key';
        const urls = [];
        globalThis.fetch = async (url) => {
            urls.push(String(url));
            return new Response(JSON.stringify({ result: { prefix_origins: [
                { origin: 13335, peer_count: 76, prefix: '104.22.21.0/24', rpki_validation: 'Valid' },
            ] } }));
        };
        const res = createResponse();
        await cfRadarHandler(createRequest({ query: { view: 'bgp-prefixes', asn: 'AS13335' } }), res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(urls, ['https://api.cloudflare.com/client/v4/radar/bgp/routes/pfx2as?origin=13335']);
        assert.deepEqual(res.body.prefixes, [{ prefix: '104.22.21.0/24', rpki: 'Valid', peers: 76 }]);
        // No MaxMind database is loaded in tests — countries degrade to [].
        assert.deepEqual(res.body.countries, []);
    });

    it('answers 500, not an empty list, when pfx2as lacks prefix_origins', async () => {
        process.env.CLOUDFLARE_API_KEY = 'test-key';
        globalThis.fetch = async () => new Response(JSON.stringify({ success: true, result: {} }));
        const originalError = logger.error;
        logger.error = () => {};
        try {
            const res = createResponse();
            await cfRadarHandler(createRequest({ query: { view: 'bgp-prefixes', asn: '13335' } }), res);
            assert.equal(res.statusCode, 500);
        } finally {
            logger.error = originalError;
        }
    });

    it("runs the asn view's guard: ASN outside the 32-bit range", async () => {
        for (const asn of ['0', 'AS0', '4294967296', '99999999999999999999']) {
            const res = createResponse();
            await cfRadarHandler(createRequest({ query: { view: 'asn', asn } }), res);
            assert.equal(res.statusCode, 400, asn);
            assert.deepEqual(res.body, { error: 'Invalid ASN' });
        }
    });

    it("runs the country-traffic view's guard: missing ?country", async () => {
        const res = createResponse();
        await cfRadarHandler(createRequest({ query: { view: 'country-traffic' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No country provided' });
    });

    it('returns 500 when no Cloudflare API key is configured', async () => {
        delete process.env.CLOUDFLARE_API_KEY;
        delete process.env.CLOUDFLARE_API;
        const res = createResponse();
        // 'AS15169' also pins the guard's normalization: the AS prefix is
        // now accepted (stripped in place), so the request passes validation
        // and stops at the key check — before any upstream call.
        await cfRadarHandler(createRequest({ query: { view: 'asn', asn: 'AS15169' } }), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
    });
});

// -- invisibility-test handler --------------------------------------------

describe('invisibility-test handler', () => {
    it('rejects missing ?id', async () => {
        const res = createResponse();
        await invisibilityHandler(createRequest(), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No ID provided' });
    });

    it('rejects wrong-length id (must be 28 alphanumeric chars)', async () => {
        const res = createResponse();
        await invisibilityHandler(createRequest({ query: { id: 'short' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid ID' });
    });

    it('rejects 28-char id containing non-alphanumerics', async () => {
        const res = createResponse();
        await invisibilityHandler(createRequest({ query: { id: 'aaaaaaaaaaaaaaaaaaaaaaaa----' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid ID' });
    });

    it('reports missing API key after param validation passes', async () => {
        delete process.env.IPCHECKING_API_KEY;
        const res = createResponse();
        await invisibilityHandler(createRequest({ query: { id: 'a'.repeat(28) } }), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
    });

    it('passes an upstream auth rejection through as its own 4xx, not a 500', async () => {
        process.env.IPCHECKING_API_KEY = 'test-key';
        process.env.IPCHECKING_API_ENDPOINT = 'https://upstream.invalid';
        globalThis.fetch = async () => ({
            status: 403,
            ok: false,
            json: async () => ({ message: 'Authorization header is missing.' }),
        });
        const res = createResponse();
        await invisibilityHandler(createRequest({ query: { id: 'a'.repeat(28) } }), res);
        assert.equal(res.statusCode, 403);
        assert.deepEqual(res.body, { error: 'Authorization header is missing.' });
    });
});

// -- mac-checker handler --------------------------------------------------

describe('mac-checker handler', () => {
    it('rejects missing ?mac', async () => {
        const res = createResponse();
        await macCheckerHandler(createRequest(), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'No MAC address provided' });
    });

    it('rejects invalid MAC format', async () => {
        const res = createResponse();
        await macCheckerHandler(createRequest({ query: { mac: 'not-a-mac' } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid MAC address' });
    });

    it('rejects a prefix shorter than 24 bits', async () => {
        const res = createResponse();
        await macCheckerHandler(createRequest({ query: { mac: '3C:5A' } }), res);
        assert.equal(res.statusCode, 400);
    });

    // Over fixture registries, so the answer doesn't depend on a download.
    const fixtureBlocks = new Map([
        ['3C5AB4', { registry: 'MA-L', company: 'Google, Inc.', address: 'Mountain View US 94043', country: 'US' }],
    ]);

    it('answers a vendor prefix in any notation from the registries', async () => {
        const handler = createMacChecker((hex) => describeMac(fixtureBlocks, hex));
        const res = createResponse();
        await handler(createRequest({ query: { mac: '3c5a.b4' } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.found, true);
        assert.equal(res.body.company, 'Google, Inc.');
        assert.equal(res.body.blockSize, 16777216);
    });

    it('answers 503 when no registries are loaded', async () => {
        const res = createResponse();
        await createMacChecker(() => null)(createRequest({ query: { mac: '3C:5A:B4' } }), res);
        assert.equal(res.statusCode, 503);
        assert.deepEqual(res.body, { error: 'MAC database unavailable' });
    });

    it('rejects a repeated ?mac (array) with 400 instead of throwing', async () => {
        const res = createResponse();
        await macCheckerHandler(createRequest({ query: { mac: ['00:1A:2B:3C:4D:5E', 'x'] } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid MAC address' });
    });

    it('rejects a repeated ?mac of two valid addresses with 400, not a lookup', async () => {
        let called = false;
        const handler = createMacChecker(() => { called = true; return { found: false }; });
        const res = createResponse();
        await handler(createRequest({ query: { mac: ['3C:5A:B4:00:00:01', '3C:5A:B4:00:00:02'] } }), res);
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid MAC address' });
        assert.equal(called, false);
    });
});

// -- update-user-achievement handler --------------------------------------

describe('update-user-achievement handler', () => {
    it('rejects non-PUT methods with 405', async () => {
        const res = createResponse();
        await updateAchievementHandler(createRequest({ method: 'POST', body: { name: 'X' } }), res);
        assert.equal(res.statusCode, 405);
        assert.deepEqual(res.body, { error: 'Method not allowed' });
    });

    it('reports missing API key before forwarding', async () => {
        delete process.env.IPCHECKING_API_KEY;
        const res = createResponse();
        await updateAchievementHandler(createRequest({ method: 'PUT', body: { name: 'X' } }), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
    });
});

// -- get-user-info handler ------------------------------------------------

describe('get-user-info handler', () => {
    it('reports missing API key before fetch', async () => {
        delete process.env.IPCHECKING_API_KEY;
        const res = createResponse();
        await getUserInfoHandler(createRequest(), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
    });
});

// -- dns-leak-test handler ------------------------------------------------

describe('dns-leak-test getSessionResult', () => {
    it('rejects non-GET with 405', async () => {
        const res = createResponse();
        await dnsLeakGetResult({ method: 'POST', headers: {}, query: {}, params: {} }, res);
        assert.equal(res.statusCode, 405);
        assert.deepEqual(res.body, { error: 'Method Not Allowed' });
    });

    it('rejects missing / malformed token before calling upstream', async () => {
        const missing = createResponse();
        await dnsLeakGetResult({ method: 'GET', headers: {}, query: {}, params: {} }, missing);
        assert.equal(missing.statusCode, 400);
        assert.deepEqual(missing.body, { error: 'Invalid token' });

        const tooShort = createResponse();
        await dnsLeakGetResult({ method: 'GET', headers: {}, query: {}, params: { token: 'abc' } }, tooShort);
        assert.equal(tooShort.statusCode, 400);
        assert.deepEqual(tooShort.body, { error: 'Invalid token' });

        const notHex = createResponse();
        await dnsLeakGetResult({
            method: 'GET', headers: {}, query: {}, params: { token: 'G'.repeat(32) },
        }, notHex);
        assert.equal(notHex.statusCode, 400);
        assert.deepEqual(notHex.body, { error: 'Invalid token' });
    });

    it('reports missing API key after token passes validation', async () => {
        delete process.env.IPCHECKING_API_KEY;
        delete process.env.IPCHECKING_API_ENDPOINT;
        const res = createResponse();
        await dnsLeakGetResult({
            method: 'GET', headers: {}, query: {},
            params: { token: 'a'.repeat(32) },
            set() { return this; },
        }, res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
    });

    // ?lang is a pass-through: the upstream owns tag resolution, so the handler
    // neither validates nor substitutes a default.
    describe('lang forwarding', () => {
        const callWithLang = async (query) => {
            process.env.IPCHECKING_API_KEY = 'test-key';
            process.env.IPCHECKING_API_ENDPOINT = 'https://upstream.invalid';
            let requested;
            globalThis.fetch = async (url) => {
                requested = new URL(String(url));
                return { status: 200, ok: true, json: async () => ({}) };
            };
            // The success path sets a Cache-Control header on the way out.
            const res = createResponse();
            res.set = () => res;
            await dnsLeakGetResult({
                method: 'GET', headers: {}, query,
                params: { token: 'a'.repeat(32) },
            }, res);
            assert.equal(res.statusCode, 200);
            return requested;
        };

        it('forwards the caller tag verbatim, family variants included', async () => {
            for (const lang of ['zh-TW', 'ja', 'pt-PT', 'tr']) {
                const url = await callWithLang({ lang });
                assert.equal(url.searchParams.get('lang'), lang);
            }
        });

        it('sends no lang at all when the caller omits it', async () => {
            const url = await callWithLang({});
            assert.equal(url.searchParams.has('lang'), false);
            // The apikey still rides along — proof the request was built, not skipped.
            assert.equal(url.searchParams.get('apikey'), 'test-key');
        });

        it('drops a non-string lang rather than stringifying it', async () => {
            // Express turns a repeated ?lang= into an array; "a,b" is not a tag.
            const url = await callWithLang({ lang: ['zh-CN', 'en'] });
            assert.equal(url.searchParams.has('lang'), false);
        });
    });
});

// -- ipcheck-ing handler --------------------------------------------------

describe('ipcheck-ing handler', () => {
    it('reports missing API key after IP passes validation', async () => {
        delete process.env.IPCHECKING_API_KEY;
        const res = createResponse();
        await ipcheckIngHandler(createRequest({ query: { ip: '1.1.1.1' } }), res);
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'API key is missing' });
    });
});

// -- asn-profile handler ---------------------------------------------------
// Composition and deadlines are covered in tests/asn-profile-aggregate.test.js;
// here: unconfigured sources read as disabled, failing upstreams as error,
// a partial Radar answer, the local PeeringDB section, and the private-API
// pass-through for the reputation section.

describe('asn-profile handler', () => {
    it('answers 200 with per-section statuses when only some sources work', async () => {
        delete process.env.CLOUDFLARE_API_KEY;
        delete process.env.CLOUDFLARE_API;
        delete process.env.IPCHECKING_API_KEY;
        delete process.env.IPCHECKING_API_ENDPOINT;
        globalThis.fetch = async () => { throw new Error('network down'); };
        const res = createResponse();
        await asnProfileHandler(createRequest({ query: { asn: '64511' } }), res);

        // With the network down, the local CAIDA graph is the one source that
        // can answer — when this checkout has an as-rel snapshot. Without one
        // (CI, a fresh checkout) connectivity is an error too, every
        // configured source has failed, and the answer is a 502.
        if (!isAsRelLoaded()) {
            assert.equal(res.statusCode, 502);
            assert.equal(res.body.status.connectivity, 'error');
            return;
        }
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.asn, 64511);
        assert.equal(res.body.status.radar, 'disabled');
        assert.equal(res.body.status.prefixes, 'disabled');
        assert.equal(res.body.status.reputation, 'disabled');
        assert.equal(res.body.status.whois, 'error');
        assert.equal(res.body.status.rank, 'error');
        assert.ok(['ok', 'empty'].includes(res.body.status.connectivity));
        assert.equal(res.body.whois, null);
        assert.equal(res.body.rank, null);
        // No Cloudflare key: PeeringDB isn't configured here.
        assert.equal(res.body.status.peeringdb, 'disabled');
    });

    it('PeeringDB: disabled only when unconfigured; configured but not loaded is an error', () => {
        assert.equal(peeringdbReadiness({ configured: () => false, loaded: () => false })(), false);
        assert.equal(peeringdbReadiness({ configured: () => true, loaded: () => true })(), true);
        assert.throws(() => peeringdbReadiness({ configured: () => true, loaded: () => false })(), /not loaded/);
    });

    it('connectivity: no as-rel snapshot is an error; as2org matters only while loading', async () => {
        const fetch = async () => 'graph';
        const missingRel = connectivityReadiness({ relLoaded: () => false, orgLoaded: () => true, fetch });
        assert.throws(() => missingRel(13335), /as-rel snapshot not loaded/);
        // as2org failed after boot: RIPEstat names the nodes, the graph is served.
        const noOrg = connectivityReadiness({ relLoaded: () => true, orgLoaded: () => false, fetch });
        assert.equal(await noOrg(13335), 'graph');
    });

    it('shows a partial Radar summary but flags it incomplete (not cacheable)', async () => {
        process.env.CLOUDFLARE_API_KEY = 'test-key';
        delete process.env.IPCHECKING_API_KEY;
        delete process.env.IPCHECKING_API_ENDPOINT;
        globalThis.fetch = async (url) => {
            const { hostname, pathname } = new URL(String(url));
            if (hostname !== 'api.cloudflare.com') throw new Error('network down');
            if (pathname.endsWith('/radar/entities/asns/64511')) {
                return new Response(JSON.stringify({ result: { asn: { name: 'EXAMPLE-NET' } } }));
            }
            if (pathname.endsWith('/radar/bgp/routes/pfx2as')) {
                return new Response(JSON.stringify({ result: { prefix_origins: [] } }));
            }
            return new Response('busy', { status: 503 });
        };
        const originalWarn = logger.warn;
        logger.warn = () => {};
        try {
            const res = createResponse();
            await asnProfileHandler(createRequest({ query: { asn: '64511' } }), res);
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.status.radar, 'ok');
            assert.equal(res.body.radar.asnName, 'EXAMPLE-NET');
            assert.equal(res.body.status.prefixes, 'empty');
            assert.deepEqual(res.body.incomplete, ['radar']);
            assert.equal(isCompleteProfile(res.body), false);
        } finally {
            logger.warn = originalWarn;
        }
    });

    it('forwards the caller headers to the private API for reputation', async () => {
        delete process.env.CLOUDFLARE_API_KEY;
        delete process.env.CLOUDFLARE_API;
        process.env.IPCHECKING_API_KEY = 'test-key';
        process.env.IPCHECKING_API_ENDPOINT = 'https://upstream.invalid';
        const payload = {
            found: true, ratio: { abuse: 1.2, vpn: 0.4 }, level: 'none',
            dropListed: false, proxy: 0, updatedAt: '2026-10-03T11:54:33.740Z',
        };
        let requested;
        globalThis.fetch = async (url, options) => {
            const { hostname, pathname } = new URL(String(url));
            if (hostname === 'upstream.invalid' && pathname === '/asnreputation') {
                requested = { url: new URL(String(url)), options };
                return { status: 200, ok: true, json: async () => payload };
            }
            throw new Error('network down');
        };
        const req = createRequest({ query: { asn: '64511' } });
        req.headers['accept-language'] = 'de-DE';
        const res = createResponse();
        await asnProfileHandler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.status.reputation, 'ok');
        assert.deepEqual(res.body.reputation, payload);
        assert.equal(requested.url.searchParams.get('asn'), '64511');
        assert.equal(requested.url.searchParams.get('key'), 'test-key');
        assert.equal(requested.options.headers['accept-language'], 'de-DE');
    });
});

// -- ipinfo-io normalizer -------------------------------------------------
// Pure transform, no fetch involved.

describe('ipinfo-io normalize', () => {
    const CANONICAL_KEYS = [
        'ip', 'city', 'region', 'country', 'country_name', 'country_code',
        'latitude', 'longitude', 'asn', 'org',
    ];

    it('maps a fully populated upstream payload', () => {
        const out = modifyJsonForIpinfo({
            ip: '8.8.8.8',
            city: 'Mountain View',
            region: 'California',
            country: 'US',
            loc: '37.4056,-122.0775',
            org: 'AS15169 Google LLC',
        });
        assert.equal(out.country_name, 'United States');
        assert.equal(out.country_code, 'US');
        assert.equal(out.latitude, 37.4056);
        assert.equal(out.longitude, -122.0775);
        assert.equal(out.asn, 'AS15169');
        assert.equal(out.org, 'Google LLC');
    });

    it('degrades coordinates to null when the upstream omits loc', () => {
        // Anycast ranges answer 200 without loc.
        const out = modifyJsonForIpinfo({
            ip: '104.28.212.153', city: 'Los Angeles', country: 'US', org: 'AS13335 Cloudflare, Inc.',
        });
        assert.equal(out.latitude, null);
        assert.equal(out.longitude, null);
        assert.equal(out.asn, 'AS13335');
    });

    it('degrades a partial or non-numeric loc to null', () => {
        assert.equal(modifyJsonForIpinfo({ loc: '37.4056' }).longitude, null);
        assert.equal(modifyJsonForIpinfo({ loc: '' }).latitude, null);
        assert.equal(modifyJsonForIpinfo({ loc: 'unknown,unknown' }).latitude, null);
        assert.equal(modifyJsonForIpinfo({ loc: ',-122.0775' }).latitude, null);
        // 0 is a real coordinate, not a blank one.
        assert.equal(modifyJsonForIpinfo({ loc: '0,0' }).latitude, 0);
    });

    it('empties asn / org when the upstream omits org', () => {
        const out = modifyJsonForIpinfo({ ip: '8.8.8.8', country: 'US', loc: '37.4,-122.0' });
        assert.equal(out.asn, '');
        assert.equal(out.org, '');
    });

    it('uses ICU country names and accepts lowercase upstream codes', () => {
        assert.equal(modifyJsonForIpinfo({ country: 'TR' }).country_name, 'Türkiye');
        assert.equal(modifyJsonForIpinfo({ country: 'us' }).country_name, 'United States');
    });

    it('falls back to Unknown Country for absent, unknown or malformed codes', () => {
        for (const country of [undefined, null, '', 'XX', 'ZZ', 'T1', 'USA', 123, {}]) {
            assert.equal(modifyJsonForIpinfo({ country }).country_name, 'Unknown Country');
        }
    });

    it('survives a bogon payload and still emits the canonical shape', () => {
        // ipinfo.io answers {"ip":…,"bogon":true} — no loc, org or country.
        const out = modifyJsonForIpinfo({ ip: '192.0.2.1', bogon: true });
        assert.equal(out.ip, '192.0.2.1');
        for (const key of CANONICAL_KEYS) {
            assert.ok(key in out, `${key} must stay present in the response`);
        }
    });

    it('survives an empty or null upstream body', () => {
        for (const payload of [{}, null, undefined]) {
            const out = modifyJsonForIpinfo(payload);
            for (const key of CANONICAL_KEYS) {
                assert.ok(key in out, `${key} must stay present in the response`);
            }
        }
    });
});

// -- ipapi-is normalizer --------------------------------------------------
// Pure transform, no fetch involved.

describe('ipapi-is normalize', () => {
    it('maps a fully populated upstream payload', () => {
        const out = modifyJsonForIPAPI({
            ip: '8.8.8.8',
            location: {
                city: 'Mountain View', state: 'California', country: 'United States',
                country_code: 'US', latitude: 37.4, longitude: -122.07,
            },
            asn: { asn: 15169, org: 'Google LLC' },
            is_datacenter: true,
        });
        assert.equal(out.city, 'Mountain View');
        assert.equal(out.country_code, 'US');
        assert.equal(out.asn, 'AS15169');
        assert.equal(out.isHosting, true);
        assert.equal(out.isProxy, false);
    });

    it('falls back to N/A when the upstream places no location', () => {
        // Anycast / bogon addresses come back 200 with location: null.
        const out = modifyJsonForIPAPI({ ip: '104.28.212.153', location: null });
        assert.equal(out.ip, '104.28.212.153');
        for (const key of ['city', 'region', 'country', 'country_name', 'country_code', 'latitude', 'longitude']) {
            assert.equal(out[key], 'N/A', `${key} should degrade to N/A`);
        }
        assert.equal(out.asn, 'N/A');
        assert.equal(out.isHosting, false);
        assert.equal(out.isProxy, false);
    });

    it('flags a proxy when any of the vpn / tor / proxy bits is set', () => {
        assert.equal(modifyJsonForIPAPI({ location: {}, is_vpn: true }).isProxy, true);
        assert.equal(modifyJsonForIPAPI({ location: {}, is_tor: true }).isProxy, true);
    });
});

// -- service-status handlers ----------------------------------------------

describe('service-status overview handler', () => {
    it('serves the in-memory overview shape without any upstream call', async () => {
        const res = createResponse();
        await serviceStatusHandler(createRequest(), res);
        // Before the poller's first tick the snapshot is empty, but the shape
        // ({ updatedAt, providers[] }) is always present — and nothing was fetched.
        assert.equal(res.statusCode, 200);
        assert.ok(Array.isArray(res.body.providers), 'providers must be an array');
        assert.ok('updatedAt' in res.body, 'overview must carry updatedAt');
    });
});

describe('service-status detail handler', () => {
    it('rejects non-GET with 405', async () => {
        const res = createResponse();
        await serviceStatusDetailHandler(createRequest({ method: 'POST', query: { id: 'claude' } }), res);
        assert.equal(res.statusCode, 405);
    });

    it('serves components + incidents arrays (empty until the poller fills the snapshot)', async () => {
        const res = createResponse();
        await serviceStatusDetailHandler(createRequest({ query: { id: 'claude' } }), res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.id, 'claude');
        assert.ok(Array.isArray(res.body.components));
        assert.ok(Array.isArray(res.body.incidents));
    });
});

// -- share-report (POST /api/report + GET /api/report/:id) -----------------
// Everything asserted here returns before the first fetchUpstream (KV is
// never hit).

describe('share-report handlers', () => {
    const kvEnv = () => {
        process.env.CLOUDFLARE_API_KEY = 'test-key';
        process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
        process.env.CLOUDFLARE_KV_NAMESPACE_ID = 'test-namespace';
    };
    const noKvEnv = () => {
        delete process.env.CLOUDFLARE_API_KEY;
        delete process.env.CLOUDFLARE_API;
        delete process.env.CLOUDFLARE_ACCOUNT_ID;
        delete process.env.CLOUDFLARE_KV_NAMESPACE_ID;
    };

    const createReq = (body, method = 'POST') => createRequest({ method, body });

    const validReport = () => ({
        v: REPORT_VERSION,
        generatedAt: '2026-07-14T08:00:00.000Z',
        origin: 'ipcheck.ing',
        locale: 'zh',
        sections: {
            ruletest: {
                testedAt: '2026-07-14T08:00:00.000Z',
                uniqueIPCount: 1,
                workers: [{ id: 1, ip: '1.2.3.4', countryCode: 'US', org: 'CF' }],
            },
        },
    });

    it('POST rejects non-POST with 405', async () => {
        const res = createResponse();
        await createReportHandler(createReq(undefined, 'GET'), res);
        assert.equal(res.statusCode, 405);
    });

    it('POST returns 503 when KV env is not configured', async () => {
        noKvEnv();
        const res = createResponse();
        await createReportHandler(createReq({ report: validReport(), ttlDays: 7 }), res);
        assert.equal(res.statusCode, 503);
    });

    it('forces a tampered ttlDays down to 1 day, keeps whitelisted values', () => {
        for (const ttlDays of [0, 2, 30, 365, -1, '7', null, undefined]) {
            assert.equal(normalizeTtlDays(ttlDays), 1, `ttlDays=${ttlDays} should coerce to 1`);
        }
        for (const ttlDays of [1, 3, 7]) {
            assert.equal(normalizeTtlDays(ttlDays), ttlDays);
        }
    });

    it('POST rejects an invalid report with the validator details', async () => {
        kvEnv();
        const res = createResponse();
        await createReportHandler(createReq({ report: { v: REPORT_VERSION, smuggled: 'x' }, ttlDays: 7 }), res);
        assert.equal(res.statusCode, 400);
        assert.equal(res.body.error, 'Invalid report');
        assert.ok(Array.isArray(res.body.details));
    });

    it('POST rejects a schema-valid but oversized report with 413', async () => {
        kvEnv();
        const report = validReport();
        // Inflate within schema caps: 32 mtr probes × 64 hops with long
        // hostnames ≈ 300KB+ serialized ≫ REPORT_MAX_BYTES (256KB).
        report.sections.mtrtest = {
            testedAt: '2026-07-14T08:00:00.000Z',
            target: '8.8.8.8',
            probes: Array.from({ length: 32 }, () => ({
                countryCode: 'US',
                network: 'n'.repeat(120),
                hops: Array.from({ length: 64 }, (_, i) => ({
                    n: i + 1, host: 'h'.repeat(120), lossPct: 0, avgMs: 1.5,
                })),
            })),
        };
        const res = createResponse();
        await createReportHandler(createReq({ report, ttlDays: 7 }), res);
        assert.equal(res.statusCode, 413);
    });

    it('GET rejects non-GET with 405', async () => {
        const res = createResponse();
        const req = createReq(undefined, 'POST');
        req.params = { id: 'a'.repeat(22) };
        await getReportHandler(req, res);
        assert.equal(res.statusCode, 405);
    });

    it('GET returns 503 when KV env is not configured', async () => {
        noKvEnv();
        const res = createResponse();
        const req = createReq(undefined, 'GET');
        req.params = { id: 'a'.repeat(22) };
        await getReportHandler(req, res);
        assert.equal(res.statusCode, 503);
    });
});

// -- ooni-blocking handler -------------------------------------------------
// Domain presence/shape is enforced by requireValidDomain middleware
// (tests/guards.test.js); the handler's only pre-fetch branch is the
// defensive method gate.

describe('ooni-blocking handler', () => {
    it('rejects non-GET with 405 before hitting OONI', async () => {
        const res = createResponse();
        await ooniBlockingHandler(createRequest({ method: 'POST', query: { domain: 'example.com' } }), res);
        assert.equal(res.statusCode, 405);
        assert.equal(res.body.error, 'Method Not Allowed');
    });
});

// -- globalping-probes handler ----------------------------------------------
// No params to validate; the only pre-fetch branch is the method gate.

describe('globalping-probes handler', () => {
    it('rejects non-GET with 405 before hitting Globalping', async () => {
        const res = createResponse();
        await globalpingProbesHandler(createRequest({ method: 'POST' }), res);
        assert.equal(res.statusCode, 405);
        assert.equal(res.body.error, 'Method Not Allowed');
    });
});

// -- split handler ---------------------------------------------------------
// POST only, and the answer is a list of destinations and nothing else. The
// method gate, the shape of the work order, and — most importantly — the absence
// of anything that explains how the order was chosen are the whole surface.

describe('split handler', () => {
    it('refuses a catalog read', async () => {
        // Not shyness about the route: publishing the packs and the weights would
        // hand anyone a copy of the reasoning the browser is deliberately not given.
        for (const method of ['GET', 'PUT', 'DELETE']) {
            const res = createResponse();
            await splitHandler(createRequest({ method }), res);
            assert.equal(res.statusCode, 405);
            assert.equal(res.body.error, 'Method Not Allowed');
        }
    });

    it('answers a profile with the work order and no explanation', async () => {
        const res = createResponse();
        await splitHandler(createRequest({
            method: 'POST',
            body: {
                signals: {
                    geo: { available: true, countries: ['CN'] },
                    tz: { available: true, zone: 'Asia/Shanghai' },
                    lang: { available: true, languages: ['zh-CN'] },
                },
            },
        }), res);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(Object.keys(res.body), ['rows'], 'the response carries the order, never the reasoning');
        assert.ok(res.body.rows.length > 30, `only ${res.body.rows.length} rows: the 国际 block plus the CN pack`);
        assert.ok(res.body.rows.every((r) => r.host && r.name && r.kind), 'a work order row must be probeable');
        assert.ok(res.body.rows.some((r) => r.cc === 'CN'), 'the inferred country is the one being tested');
        assert.ok(res.body.rows.some((r) => r.kind === 'world'), 'the floor always ships');
        assert.ok(!JSON.stringify(res.body).match(/weight|ranking|geoMissing|osVotes/i), 'nothing about the scoring leaked through');
    });

    it('tests both countries a split network actually has, in the order the addresses say', async () => {
        // The traffic goes out in the United States and the WebRTC answer is a
        // mainland address. Neither half of that is a guess, so neither has to
        // out-vote the other to earn a place in the table — which is exactly what
        // used to happen when one network's two countries split the geolocation
        // signal down the middle.
        const res = createResponse();
        await splitHandler(createRequest({
            method: 'POST',
            body: {
                signals: {
                    geo: { available: true, countries: ['US'] },
                    net: { available: true, exitCountries: ['US'], leakedCountries: ['CN'] },
                },
            },
        }), res);
        assert.equal(res.statusCode, 200);
        const tested = [...new Set(res.body.rows.map((r) => r.cc).filter((cc) => cc === 'CN' || cc === 'US'))];
        assert.deepEqual(tested, ['CN', 'US'], 'the machine first, then the road it takes');
        assert.ok(res.body.rows.some((r) => r.host === 'www.baidu.com'), 'the mainland pack is probed, not just named');
        assert.ok(res.body.rows.some((r) => r.host === 'www.reddit.com'), 'and so is the exit country');
        assert.ok(!JSON.stringify(res.body).match(/weight|ranking|measured|inferred/i), 'and the response still says nothing about how it was chosen');
    });

    it('answers a zone name that is not a zone', async () => {
        // The browser posts the clock's IANA name and `requireSplitSignals` bounds
        // only its length, so `constructor` reaches the lookup exactly as
        // `Asia/Shanghai` does. Reading it off a plain object literal used to return
        // a function, throw on `.split`, and turn the route every homepage load calls
        // into a 500.
        for (const zone of ['constructor', '__proto__', 'toString', 'valueOf']) {
            const res = createResponse();
            await splitHandler(createRequest({
                method: 'POST',
                body: { signals: { tz: { available: true, zone } } },
            }), res);
            assert.equal(res.statusCode, 200, `${zone} must not break the route`);
            assert.ok(res.body.rows.length > 0, `${zone} returned no work order`);
        }
    });

    it('answers an explicit country list without needing signals', async () => {
        const res = createResponse();
        await splitHandler(createRequest({ method: 'POST', body: { countries: ['IR', 'ZZ'] } }), res);
        assert.equal(res.statusCode, 200);
        assert.ok(res.body.rows.some((r) => r.cc === 'IR'), 'the known country is probed');
        assert.ok(!res.body.rows.some((r) => r.cc === 'ZZ'), 'an unknown code is dropped, not guessed at');
    });

    it('holds an explicit country list to the size of a judged order', async () => {
        // `requireSplitSignals` caps the *body* at twelve codes, which is a limit on
        // what a client may send, not on what the page may show: twelve countries in
        // the door used to produce a hundred-row work order — more national rows
        // than any profile could ever have justified, from a route that is supposed
        // to be the same shape whoever calls it.
        const res = createResponse();
        await splitHandler(createRequest({
            method: 'POST',
            body: { countries: ['CN', 'US', 'JP', 'KR', 'RU', 'IR', 'IN', 'BR', 'DE', 'FR', 'GB', 'TW'] },
        }), res);
        assert.equal(res.statusCode, 200);
        const canaries = new Set(EXIT_CANARIES.map((r) => r.host));
        const packs = [...new Set(res.body.rows.filter((r) => r.cc && !canaries.has(r.host)).map((r) => r.cc))];
        assert.deepEqual(packs, ['CN', 'US', 'JP', 'KR', 'RU'], 'the first ones asked for, and no more');
        assert.ok(packs.length <= PLAN_COUNTRIES_MAX, `${packs.length} packs from an explicit list`);
    });

    it('answers an empty request with the destinations that need no judgement', async () => {
        const res = createResponse();
        await splitHandler(createRequest({ method: 'POST', body: { signals: {} } }), res);
        assert.equal(res.statusCode, 200);
        const canaries = new Set(EXIT_CANARIES.map((r) => r.host));
        assert.ok(res.body.rows.every((r) => r.kind !== 'country' || canaries.has(r.host)),
            'a country row in an unjudged plan is a canary and nothing else');
        assert.ok(res.body.rows.some((r) => canaries.has(r.host)),
            'the canary ships with nothing to go on — a leak hides the very signals that would have picked its country');
    });
});
