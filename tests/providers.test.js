// The commercial anonymiser-list adapters (`common/providers/`), the parallel
// asking of them, and the merge that turns several vendors' answers into the one
// verdict the trust ladder reads.
//
// Four states are pinned for every vendor, because each one is scored differently
// downstream and each is a thing an adapter can quietly get wrong:
//   `ok`           — it answered, and only the fields the vendor sent are set;
//   `missing_key`  — nothing was asked at all, so the signal stays a declared gap;
//   non-200        — it was asked and the upstream refused: an `unknown`, which
//                    shrinks confidence, never a clearance;
//   timeout        — the same, arriving through the thrown branch.
//
// The parsers are tested against captured vendor JSON rather than a hand-written
// object, because their whole job is the vendor's spellings: `yes`/`no`,
// `True`/`False`, `0`/`1`, and the absence of any of them.
//
// No test here reaches the network: `globalThis.fetch` is stubbed and restored,
// and a timeout is simulated by rejecting the way `fetchWithTimeout` does when its
// controller aborts — waiting out the real 5s would only make the suite slow.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
    answered, unavailable, errored, toFlag, toNumber, toText, toAsn, usageFlags, pickKey,
    PROVIDER_TIMEOUT_MS,
} from '../common/providers/answer.js';
import { interpretProxycheck, askProxycheck, PROXYCHECK_SOURCE } from '../common/providers/proxycheck.js';
import { interpretAbuseipdb, askAbuseipdb, ABUSEIPDB_SOURCE } from '../common/providers/abuseipdb.js';
import { interpretIp2location, askIp2location, IP2LOCATION_SOURCE } from '../common/providers/ip2location.js';
import { interpretIpinfoLite, askIpinfoLite, IPINFO_SOURCE } from '../common/providers/ipinfo-lite.js';
import {
    interpretInternetdb, askInternetdb, INTERNETDB_SOURCE,
} from '../common/providers/internetdb.js';
import internetdbHandler from '../api/internetdb.js';
import { enabledProviders, askProviders } from '../common/providers/registry.js';
import { mergeProviders } from '../common/providers/vote.js';

const ENV_KEYS = [
    'PROXYCHECK_API_KEY', 'ABUSEIPDB_API_KEY', 'IP2LOCATION_API_KEY',
    'IPINFO_API_KEY', 'IPINFO_API_TOKEN', 'TRUST_PROVIDERS',
];

const originalFetch = globalThis.fetch;
let envBackup = {};

beforeEach(() => {
    envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(envBackup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

// --- the fetch stub -------------------------------------------------------

const json = (body) => ({ ok: true, status: 200, json: async () => body });

// Records every URL it was called with, and answers from `impl` (a body, or a
// function of the url). A test that expects no request asserts on `called.length`.
const stubFetch = (impl) => {
    const called = [];
    globalThis.fetch = async (url, init) => {
        called.push({ url: String(url), init });
        if (impl instanceof Function) return impl(String(url), init);
        return json(impl);
    };
    return called;
};

// How `fetchWithTimeout` surfaces its own timer going off.
const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

// An answer, a refusal and a failure all carry the same detection fields, so a
// consumer can read `answer.isTor` without knowing which vendor wrote it. The two
// extra keys each form has — `authority` on an answer, `reason` on a missing one —
// are the difference between them, not an accident.
const DETECTION_KEYS = [
    'abuseReports', 'abuseScore', 'asName', 'asn', 'country', 'isAbuser', 'isHosting',
    'isMobile', 'isProxy', 'isTor', 'isVpn', 'lat', 'lon', 'riskScore', 'usageType',
].sort();

const baseKeys = (answer) => Object.keys(answer)
    .filter((k) => !['raw', 'reason', 'authority'].includes(k))
    .sort();

// --- the shared parsers ---------------------------------------------------

describe('providers/answer.js', () => {
    it('reads the dialects a vendor really writes', () => {
        for (const yes of [true, 1, '1', 'yes', 'Yes', ' true ']) assert.equal(toFlag(yes), true, String(yes));
        for (const no of [false, 0, '0', 'no', 'False']) assert.equal(toFlag(no), false, String(no));
        // Anything else is the vendor staying silent, not the vendor clearing it.
        for (const silent of [null, undefined, '', 'N/A', 2, {}, []]) assert.equal(toFlag(silent), null, String(silent));
    });

    it('refuses to invent a number or a coordinate out of a blank', () => {
        assert.equal(toNumber(''), null, "Number('') is 0 and 0 is a real answer");
        assert.equal(toNumber('N/A'), null);
        assert.equal(toNumber(Infinity), null);
        assert.equal(toNumber('-122.08'), -122.08);
    });

    it('treats the placeholders the geo handlers normalise to as absent', () => {
        for (const blank of ['', '   ', '-', 'N/A', null, 7]) assert.equal(toText(blank), null, String(blank));
        assert.equal(toText('  OVH SAS  '), 'OVH SAS');
    });

    it('parses an ASN out of every form a vendor sends', () => {
        assert.equal(toAsn('AS15169'), 15169);
        assert.equal(toAsn(15169), 15169);
        assert.equal(toAsn('AS15169 - Google LLC'), 15169);
        for (const junk of ['AS0', 'ASNaN', 'NOT-SET', null, '', 2 ** 32]) {
            assert.equal(toAsn(junk), null, String(junk));
        }
    });

    it('reads the two claims a usage-type label supports, and nothing else', () => {
        assert.deepEqual(usageFlags('Data Center/Web Hosting/Transit'), { isHosting: true, isMobile: false });
        assert.deepEqual(usageFlags('Mobile DSL'), { isHosting: false, isMobile: true });
        assert.deepEqual(usageFlags('Fixed Line ISP'), { isHosting: false, isMobile: false });
        assert.deepEqual(usageFlags(null), { isHosting: null, isMobile: null }, 'no label is not a denial');
    });

    it('answers with a fixed key set, so a consumer never reads another vendor\'s field', () => {
        for (const answer of [answered('x.y', { isTor: true }), unavailable('x.y', 'missing_key'), errored('x.y', 'http-500')]) {
            assert.deepEqual(baseKeys(answer), [...DETECTION_KEYS, 'source', 'status'].sort());
        }
        assert.equal(answered('x.y').isTor, null);
        assert.equal(answered('x.y', { isTor: true }).isTor, true);
        assert.equal(answered('x.y').authority, null);
        assert.equal(unavailable('x.y', 'missing_key').reason, 'missing_key');
    });

    it('picks a key from a comma-separated pool and null from a blank', () => {
        assert.equal(pickKey('PROXYCHECK_API_KEY'), null);
        process.env.PROXYCHECK_API_KEY = ' , ';
        assert.equal(pickKey('PROXYCHECK_API_KEY'), null);
        process.env.PROXYCHECK_API_KEY = 'solo';
        assert.equal(pickKey('PROXYCHECK_API_KEY'), 'solo');
        const seen = new Set();
        process.env.PROXYCHECK_API_KEY = 'a, b ,c';
        for (let i = 0; i < 300; i += 1) seen.add(pickKey('PROXYCHECK_API_KEY'));
        assert.deepEqual([...seen].sort(), ['a', 'b', 'c']);
    });

    // The legacy spelling stays readable wherever the vendor reads it, so a
    // deployment that never renamed the variable keeps its configuration.
    it('falls through the legacy spelling of a name list', () => {
        process.env.IPINFO_API_TOKEN = 'legacy';
        assert.equal(pickKey('IPINFO_API_KEY', 'IPINFO_API_TOKEN'), 'legacy');
        process.env.IPINFO_API_KEY = 'current';
        assert.equal(pickKey('IPINFO_API_KEY', 'IPINFO_API_TOKEN'), 'current');
    });
});

// --- proxycheck.io --------------------------------------------------------

const PROXYCHECK_BODY = {
    status: 'ok',
    '203.0.113.9': {
        proxy: 'yes', type: 'VPN', vpn: true, tor: false, risk: '95',
        ASN: 'AS9009', provider: 'M247', country: 'RO', latitude: '45.5', longitude: '9.1',
    },
};

describe('providers/proxycheck.js', () => {
    it('reads the entry keyed by the address and normalises its dialect', () => {
        const answer = interpretProxycheck(PROXYCHECK_BODY, '203.0.113.9');
        assert.equal(answer.status, 'ok');
        assert.equal(answer.authority, 'list');
        assert.equal(answer.isProxy, true);
        assert.equal(answer.isVpn, true);
        assert.equal(answer.isTor, false);
        assert.equal(answer.abuseScore, 95);
        assert.equal(answer.asn, 9009);
        assert.equal(answer.asName, 'M247');
        assert.equal(answer.lat, 45.5);
    });

    // An IPv6 address comes back in the vendor's own normalisation, which is not
    // the string we sent, so the keyed lookup cannot be the only way in.
    it('finds the entry when the vendor re-wrote the address', () => {
        const body = { status: 'ok', '2001:db8::1': { proxy: 'no' } };
        assert.equal(interpretProxycheck(body, '2001:DB8::1').isProxy, false);
    });

    it('leaves a flag the free module did not return as unknown, not as clean', () => {
        const answer = interpretProxycheck({ status: 'ok', ip: { proxy: 'no' } }, 'ip');
        assert.equal(answer.isProxy, false);
        assert.equal(answer.isTor, null);
        assert.equal(answer.isMobile, null);
        assert.equal(answer.abuseScore, null);
    });

    it('names Tor from the type label when the module is absent', () => {
        assert.equal(interpretProxycheck({ status: 'ok', ip: { type: 'Web Proxy, Tor' } }, 'ip').isTor, true);
        assert.equal(interpretProxycheck({ status: 'ok', ip: { type: 'VPN' } }, 'ip').isTor, null);
    });

    it('reports a top-level or per-IP error as the source failing', () => {
        assert.equal(interpretProxycheck({ status: 'error', message: 'quota exceeded' }, 'ip').reason, 'quota exceeded');
        assert.equal(interpretProxycheck({ status: 'ok', ip: { error: 'access denied' } }, 'ip').reason, 'access denied');
        assert.equal(interpretProxycheck({ status: 'ok' }, 'ip').reason, 'no-entry');
    });

    it('asks with the key and reports what the upstream did', async () => {
        process.env.PROXYCHECK_API_KEY = 'k1';
        const called = stubFetch(PROXYCHECK_BODY);
        const answer = await askProxycheck('203.0.113.9');
        assert.equal(answer.status, 'ok');
        assert.match(called[0].url, /^https:\/\/proxycheck\.io\/v2\/203\.0\.113\.9\?key=k1/);
        // The short budget is the point: these are redundant sources, and one
        // vendor's slow minute must not hold up a page four others can answer.
        assert.equal(PROVIDER_TIMEOUT_MS, 5000);
        assert.ok(called[0].init.signal instanceof AbortSignal, 'the call is not the timeout-capped one');

        stubFetch(() => ({ ok: false, status: 403, json: async () => ({}) }));
        assert.equal((await askProxycheck('203.0.113.9')).reason, 'http-403');

        stubFetch(() => Promise.reject(abortError()));
        assert.equal((await askProxycheck('203.0.113.9')).reason, 'request-failed');
    });

    it('asks nothing without a key', async () => {
        const called = stubFetch(PROXYCHECK_BODY);
        const answer = await askProxycheck('203.0.113.9');
        assert.equal(called.length, 0, 'a keyless call spends a shared anonymous budget');
        assert.deepEqual([answer.source, answer.status, answer.reason], [PROXYCHECK_SOURCE, 'unavailable', 'missing_key']);
    });
});

// --- AbuseIPDB ------------------------------------------------------------

const ABUSEIPDB_BODY = {
    data: {
        ipAddress: '203.0.113.9', abuseConfidenceScore: 74, totalReports: 41, isTor: false,
        isp: 'Example Hosting', domain: 'example.test', usageType: 'Data Center/Web Hosting/Transit',
        countryCode: 'US', asn: 15169,
        lastReports: [{ email: 'reporter@example.test', comment: 'brute force' }],
    },
};

describe('providers/abuseipdb.js', () => {
    it('reads the census and none of the reporters', () => {
        const answer = interpretAbuseipdb(ABUSEIPDB_BODY);
        assert.equal(answer.status, 'ok');
        assert.equal(answer.authority, 'observation', 'a reporting census is not an anonymiser list');
        assert.equal(answer.abuseScore, 74);
        assert.equal(answer.abuseReports, 41);
        assert.equal(answer.isTor, false);
        assert.equal(answer.isHosting, true);
        assert.equal(answer.asn, 15169);
        const text = JSON.stringify(answer);
        for (const secret of ['reporter@example.test', 'brute force']) {
            assert.ok(!text.includes(secret), `the answer leaked "${secret}"`);
        }
    });

    it('refuses to read a missing score as a clean address', () => {
        assert.equal(interpretAbuseipdb({ data: { ipAddress: '1.1.1.1' } }).reason, 'no-score');
        assert.equal(interpretAbuseipdb({ errors: [{ detail: 'Daily quota exceeded' }] }).reason, 'vendor-error');
        assert.equal(interpretAbuseipdb({}).reason, 'no-data');
    });

    it('sends the key as a header, never in the URL', async () => {
        process.env.ABUSEIPDB_API_KEY = 'k2';
        const called = stubFetch(ABUSEIPDB_BODY);
        assert.equal((await askAbuseipdb('203.0.113.9')).status, 'ok');
        assert.equal(called[0].init.headers.Key, 'k2');
        assert.ok(!called[0].url.includes('k2'), 'a credential in a URL ends up in somebody\'s access log');

        stubFetch(() => ({ ok: false, status: 429, json: async () => ({}) }));
        assert.equal((await askAbuseipdb('203.0.113.9')).reason, 'http-429');

        stubFetch(() => Promise.reject(abortError()));
        assert.equal((await askAbuseipdb('203.0.113.9')).reason, 'request-failed');
    });

    it('asks nothing without a key', async () => {
        const called = stubFetch(ABUSEIPDB_BODY);
        const answer = await askAbuseipdb('203.0.113.9');
        assert.equal(called.length, 0);
        assert.equal(answer.status, 'unavailable');
        assert.equal(answer.reason, 'missing_key');
    });
});

// --- IP2Location.io -------------------------------------------------------

describe('providers/ip2location.js', () => {
    it('reads the free plan for what the free plan is', () => {
        const answer = interpretIp2location({
            ip: '203.0.113.9', country_code: 'DE', latitude: 51.2, longitude: 10.4,
            asn: 'AS8560', as: 'IONOS SE', usage_type: 'Data Center/Web Hosting/Transit',
        });
        assert.equal(answer.status, 'ok');
        // The detection fields belong to paid tiers: absent, not denied.
        assert.equal(answer.isProxy, null);
        assert.equal(answer.isTor, null);
        assert.equal(answer.isHosting, true);
        assert.equal(answer.asn, 8560);
        assert.equal(answer.asName, 'IONOS SE');
    });

    it('takes the paid flags when the plan carries them, in either spelling', () => {
        const answer = interpretIp2location({ is_proxy: 'True', is_datacenter: 'False', usage_type: 'Hosting' });
        assert.equal(answer.isProxy, true);
        assert.equal(answer.isHosting, false, 'the paid flag outranks the label');
    });

    it('reports the vendor\'s own error object', () => {
        assert.equal(interpretIp2location({ error: true, code: 403 }).reason, 'code-403');
    });

    it('asks with the key in the query, and reports what came back', async () => {
        process.env.IP2LOCATION_API_KEY = 'k3';
        const called = stubFetch({ ip: '203.0.113.9', country_code: 'DE' });
        assert.equal((await askIp2location('203.0.113.9')).status, 'ok');
        assert.match(called[0].url, /^https:\/\/api\.ip2location\.io\/\?ip=203\.0\.113\.9&key=k3/);

        stubFetch(() => ({ ok: false, status: 402, json: async () => ({}) }));
        assert.equal((await askIp2location('203.0.113.9')).reason, 'http-402');

        stubFetch(() => Promise.reject(abortError()));
        assert.equal((await askIp2location('203.0.113.9')).reason, 'request-failed');
    });

    it('asks nothing without a key', async () => {
        const called = stubFetch({ country_code: 'DE' });
        assert.equal((await askIp2location('203.0.113.9')).reason, 'missing_key');
        assert.equal(called.length, 0);
    });
});

// --- ipinfo Lite ----------------------------------------------------------

describe('providers/ipinfo-lite.js', () => {
    it('reads the privacy block and the ASN it describes', () => {
        const answer = interpretIpinfoLite({
            ip: '203.0.113.9', country: 'US', loc: '37.4220,-122.0841',
            asn: { asn: 'AS15169', domain: 'google.com', type: 'hosting', route: '15169' },
            company: { name: 'Google LLC' },
            privacy: { proxy: false, vpn: true, tor: false, relay: false, hosting: true },
        });
        assert.equal(answer.status, 'ok');
        assert.equal(answer.authority, 'list');
        assert.equal(answer.isVpn, true);
        assert.equal(answer.isProxy, false);
        assert.equal(answer.isHosting, true);
        assert.equal(answer.asn, 15169);
        assert.equal(answer.asName, 'Google LLC');
        assert.equal(answer.lat, 37.4220);
        assert.equal(answer.lon, -122.0841);
    });

    it('counts a Warp relay as an anonymising exit', () => {
        assert.equal(interpretIpinfoLite({ privacy: { relay: true } }).isVpn, true);
        assert.equal(interpretIpinfoLite({ privacy: {} }).isVpn, null, 'an empty block is not a denial');
    });

    it('reads a hosted ASN type when the privacy block has no hosting field', () => {
        assert.equal(interpretIpinfoLite({ asn: { type: 'hosting' }, privacy: {} }).isHosting, true);
    });

    it('refuses an undecodable location rather than placing the address at (0,0)', () => {
        const answer = interpretIpinfoLite({ loc: '', privacy: { tor: false } });
        assert.equal(answer.lat, null);
        assert.equal(answer.lon, null);
    });

    it('reports a bogon and a vendor error as the source failing', () => {
        assert.equal(interpretIpinfoLite({ bogon: true }).reason, 'bogon');
        assert.equal(interpretIpinfoLite({ error: 'unauthorized' }).reason, 'vendor-error');
    });

    it('asks with the token, and reports what came back', async () => {
        process.env.IPINFO_API_KEY = 'k4';
        const called = stubFetch({ country: 'US', privacy: { proxy: false } });
        assert.equal((await askIpinfoLite('203.0.113.9')).status, 'ok');
        assert.match(called[0].url, /^https:\/\/api\.ipinfo\.io\/lite\/203\.0\.113\.9\?token=k4/);

        stubFetch(() => ({ ok: false, status: 500, json: async () => ({}) }));
        assert.equal((await askIpinfoLite('203.0.113.9')).reason, 'http-500');

        stubFetch(() => Promise.reject(abortError()));
        assert.equal((await askIpinfoLite('203.0.113.9')).reason, 'request-failed');
    });

    // The geolocation card spends this token once per visitor, so a per-lookup
    // feed asks only where a token is configured.
    it('asks nothing without a token', async () => {
        const called = stubFetch({ country: 'US' });
        assert.equal((await askIpinfoLite('203.0.113.9')).reason, 'missing_key');
        assert.equal(called.length, 0);
    });
});

// --- Shodan InternetDB ----------------------------------------------------

// A real record: a Tor exit's own ports and tags, as the archive answers them.
const INTERNETDB_TOR = {
    cpes: ['cpe:/a:f5:nginx'],
    hostnames: ['berlin01.tor-exit.example.test'],
    ip: '185.220.101.1',
    ports: [443, 9001, 80, 9002],
    tags: ['tor', 'self-signed'],
    vulns: [],
};

describe('providers/internetdb.js', () => {
    it('reads the record and sorts the ports it saw', () => {
        const answer = interpretInternetdb(INTERNETDB_TOR, '185.220.101.1');
        assert.equal(answer.status, 'ok');
        assert.equal(answer.found, true);
        assert.equal(answer.authority, 'observation', 'a service listening is not a visitor anonymising');
        assert.equal(answer.isTor, true);
        assert.equal(answer.isProxy, null);
        assert.deepEqual(answer.ports, [80, 443, 9001, 9002]);
        assert.deepEqual(answer.hostnames, ['berlin01.tor-exit.example.test']);
    });

    it('reads an open proxy and refuses to read anything else as one', () => {
        assert.equal(interpretInternetdb({ tags: ['open_proxy'] }, 'i').isProxy, true);
        assert.equal(interpretInternetdb({ tags: ['http'] }, 'i').isProxy, null);
        // A tag is matched as a word, so a product named around it cannot accuse.
        assert.equal(interpretInternetdb({ tags: ['proximity'] }, 'i').isProxy, null);
    });

    // The inversion this whole folder exists to prevent: the archive only knows
    // what its scanners happened to see, and most addresses are never scanned.
    it('leaves an empty tag list as silence, never as a clearance', () => {
        const answer = interpretInternetdb({ ip: '1.1.1.1', ports: [22], tags: [], vulns: [] }, '1.1.1.1');
        assert.equal(answer.found, true);
        assert.equal(answer.isProxy, null);
        assert.equal(answer.isTor, null);
    });

    it('drops ports that are not ports', () => {
        assert.deepEqual(interpretInternetdb({ ports: [80, '443', 0, -1, 70000, null], tags: [] }, 'i').ports, [80]);
    });

    it('answers no-record for the archive\'s 404, which is not a failure', async () => {
        const called = stubFetch(() => ({ ok: false, status: 404, json: async () => ({ detail: 'No information available' }) }));
        const answer = await askInternetdb('203.0.113.77');
        assert.equal(called.length, 1);
        assert.equal(answer.status, 'ok', 'an address nobody has looked at is an answer');
        assert.equal(answer.found, false);
        assert.equal(answer.isProxy, null);
    });

    it('reports a refusal and a timeout as the source failing', async () => {
        stubFetch(() => ({ ok: false, status: 429, json: async () => ({ detail: 'slow down' }) }));
        assert.equal((await askInternetdb('203.0.113.78')).reason, 'http-429');

        stubFetch(() => Promise.reject(abortError()));
        assert.equal((await askInternetdb('203.0.113.79')).reason, 'request-failed');
    });

    // Key-free: there is no configuration that could be missing, so no answer of
    // ours may be `unavailable`.
    it('asks with no credential at all', async () => {
        const called = stubFetch(INTERNETDB_TOR);
        const answer = await askInternetdb('185.220.101.1');
        assert.equal(answer.status, 'ok');
        assert.equal(called[0].url, 'https://internetdb.shodan.io/185.220.101.1');
        assert.ok(!('key' in (called[0].init.headers || {})));
    });

    // An observation cannot accuse on its own, and a `no-record` carries no claim
    // at all — so the archive changes a verdict only when a list vendor agrees.
    it('corroborates a list vendor but never accuses alone', () => {
        const observed = answered(INTERNETDB_SOURCE, { authority: 'observation', isTor: true });
        assert.equal(mergeProviders([observed]).flags.tor, null);
        const second = answered('abuseipdb.com', { authority: 'observation', isTor: true });
        assert.equal(mergeProviders([observed, second]).flags.tor, true);
        assert.equal(mergeProviders([answered(INTERNETDB_SOURCE, { found: false })]).flags.tor, null);
    });
});

// --- GET /api/internetdb --------------------------------------------------

// The response double an Express handler is called with, read live: `status` has
// to be asked for *after* the handler ran, so a test that destructures it would
// compare the 200 the object started with — a code path that passes whether or not
// the handler ever refused.
const collect = () => {
    const body = {};
    const out = {
        statusCode: 200,
        res: {
            json: (payload) => { Object.assign(body, payload); return body; },
            status: (code) => { out.statusCode = code; return out.res; },
        },
        body,
        get status() { return out.statusCode; },
    };
    return out;
};

describe('GET /api/internetdb', () => {
    it('answers with the record, the schema and the clock', async () => {
        stubFetch(INTERNETDB_TOR);
        const c = collect();

        await internetdbHandler({ query: { ip: '185.220.101.1' } }, c.res);

        assert.equal(c.status, 200);
        assert.equal(c.body.schema, 'internetdb/v1');
        assert.equal(c.body.status, 'record');
        assert.deepEqual(c.body.ports, [80, 443, 9001, 9002]);
        assert.deepEqual(c.body.tags, ['tor', 'self-signed']);
        assert.ok(c.body.generatedAt, 'an observation without a clock reads as the present');
        assert.equal(c.body.raw, undefined, 'the vendor payload is not ours to ship');
    });

    it('says no-record instead of failing when nobody has looked', async () => {
        stubFetch(() => ({ ok: false, status: 404, json: async () => ({ detail: 'No information available' }) }));
        const c = collect();

        await internetdbHandler({ query: { ip: '203.0.113.80' } }, c.res);

        assert.equal(c.status, 200);
        assert.equal(c.body.status, 'no-record');
        assert.equal(c.body.ports, undefined, 'no record is not a record with nothing in it');
    });

    it('answers 500 when the archive could not be asked', async () => {
        stubFetch(() => Promise.reject(abortError()));
        const c = collect();

        await internetdbHandler({ query: { ip: '203.0.113.81' } }, c.res);

        assert.equal(c.status, 500);
        assert.equal(c.body.error, 'request-failed');
        assert.equal(c.body.status, 'failed', 'a 500 that cannot name its own state is unhelpful to store');
    });
});

// --- the registry ---------------------------------------------------------

describe('providers/registry.js', () => {
    it('asks nobody while TRUST_PROVIDERS stays empty', async () => {
        const called = stubFetch({});
        assert.deepEqual(enabledProviders(), []);
        assert.deepEqual(await askProviders('203.0.113.9'), []);
        assert.equal(called.length, 0, 'the default deployment must not make a keyed call');
    });

    it('matches the bare id, the dotted one and the noise around it', () => {
        process.env.TRUST_PROVIDERS = ' PROXYCHECK_IO , abuseipdb.com , bogus ';
        assert.deepEqual(enabledProviders().map((p) => p.id), [PROXYCHECK_SOURCE, ABUSEIPDB_SOURCE]);
    });

    it('keeps the catalog order whatever order the variable lists', () => {
        process.env.TRUST_PROVIDERS = 'ipinfo,proxycheck';
        assert.deepEqual(enabledProviders().map((p) => p.id), [PROXYCHECK_SOURCE, IPINFO_SOURCE]);
    });

    // Key-free, so listing it is a decision about consulting a scan archive, not
    // about having a credential to spend.
    it('enables the scan archive without any key', () => {
        process.env.TRUST_PROVIDERS = 'internetdb';
        assert.deepEqual(enabledProviders().map((p) => p.id), [INTERNETDB_SOURCE]);
    });

    // One vendor's 500 is a missing vote, never a reason to answer nothing.
    it('reports every enabled provider even when one throws past its own catch', async () => {
        process.env.TRUST_PROVIDERS = 'proxycheck,abuseipdb';
        process.env.PROXYCHECK_API_KEY = 'k';
        process.env.ABUSEIPDB_API_KEY = 'k';
        stubFetch((url) => (url.includes('proxycheck.io')
            ? Promise.reject(new Error('adapter blew up'))
            : json(ABUSEIPDB_BODY)));
        const answers = await askProviders('203.0.113.9');
        assert.equal(answers.length, 2);
        assert.deepEqual(
            answers.map((a) => [a.source, a.status]).sort(),
            [[ABUSEIPDB_SOURCE, 'ok'], [PROXYCHECK_SOURCE, 'error']],
        );
    });

    // A key that is absent is not a failure: the answer comes back `unavailable`
    // and the overall response is still a 200 with the key-free sources in it.
    it('answers unavailable for a provider listed without its key', async () => {
        process.env.TRUST_PROVIDERS = 'proxycheck';
        stubFetch({});
        const [answer] = await askProviders('203.0.113.9');
        assert.equal(answer.status, 'unavailable');
        assert.equal(answer.reason, 'missing_key');
    });
});

// --- the merge ------------------------------------------------------------

const listYes = (source, cap) => answered(source, { authority: 'list', [cap]: true });
const obsYes = (source, cap) => answered(source, { authority: 'observation', [cap]: true });

describe('providers/vote.js', () => {
    it('lets a list vendor decide on its own', () => {
        const merged = mergeProviders([listYes('proxycheck.io', 'isProxy')]);
        assert.equal(merged.flags.proxy, true);
        assert.equal(merged.by.proxy, 'proxycheck.io');
        assert.deepEqual(merged.votes.proxy, { yes: 1, no: 0 });
    });

    // The false accusation this split exists to prevent: one scanned port, or one
    // registry label, must not turn a whole hosting range into an anonymiser.
    it('will not let a lone observation accuse', () => {
        const merged = mergeProviders([obsYes('internetdb.shodan.io', 'isProxy')]);
        assert.equal(merged.flags.proxy, null, 'uncorroborated observation is neither an accusation nor a clearance');
        assert.equal(merged.by.proxy, null);
    });

    it('lets two observations accuse between them', () => {
        const merged = mergeProviders([
            obsYes('abuseipdb.com', 'isTor'), obsYes('ip2location.io', 'isTor'),
        ]);
        assert.equal(merged.flags.tor, true);
        assert.equal(merged.by.tor, 'abuseipdb.com + ip2location.io');
    });

    it('records a clearance only when somebody actually said no', () => {
        const merged = mergeProviders([
            answered('a.test', { authority: 'list', isVpn: false }),
            answered('b.test', { authority: 'list' }),
        ]);
        assert.equal(merged.flags.vpn, false);
        assert.equal(merged.by.vpn, 'a.test');
        assert.deepEqual(merged.votes.vpn, { yes: 0, no: 1 });
    });

    it('keeps a dissent as a count instead of dropping it', () => {
        const merged = mergeProviders([
            answered('a.test', { authority: 'list', isProxy: false }),
            obsYes('b.test', 'isProxy'),
        ]);
        assert.equal(merged.flags.proxy, false);
        assert.deepEqual(merged.votes.proxy, { yes: 1, no: 1 });
    });

    it('normalises every vendor\'s abuse number onto one 0–1 scale', () => {
        const merged = mergeProviders([
            answered('abuseipdb.com', { abuseScore: 74 }),
            answered('ipapi.is', { abuseScore: 0.07 }),
        ]);
        assert.equal(Math.round(merged.abuse.score * 100) / 100, 0.74);
        assert.equal(merged.abuse.by, 'abuseipdb.com');
    });

    it('takes the largest report count rather than a sum of overlapping windows', () => {
        const merged = mergeProviders([
            answered('abuseipdb.com', { abuseReports: 41 }),
            answered('proxycheck.io', { abuseReports: 7 }),
        ]);
        assert.equal(merged.abuse.reports, 41);
    });

    it('reads an abuser flag in both directions and never out of silence', () => {
        assert.equal(mergeProviders([answered('a.test', { isAbuser: true })]).abuse.flag, true);
        assert.equal(mergeProviders([answered('a.test', { isAbuser: false })]).abuse.flag, false);
        assert.equal(mergeProviders([answered('a.test')]).abuse.flag, null);
        assert.equal(mergeProviders([answered('a.test', { isAbuser: true })]).abuse.flaggedBy, 'a.test');
    });

    it('keeps the roster of who was asked, as distinct from who answered', () => {
        const merged = mergeProviders([
            answered('a.test', { isProxy: false }),
            unavailable('b.test', 'missing_key'),
            errored('c.test', 'http-500'),
        ]);
        assert.deepEqual(merged.sources, ['a.test']);
        assert.deepEqual(merged.unavailable, [{ source: 'b.test', reason: 'missing_key' }]);
        assert.deepEqual(merged.failed, ['c.test']);
        assert.deepEqual(merged.status.map((s) => s.status), ['ok', 'unavailable', 'error']);
    });

    it('merges an empty list into an all-unknown verdict without throwing', () => {
        const merged = mergeProviders([null, undefined, 'nonsense']);
        assert.deepEqual(merged.flags, { proxy: null, vpn: null, tor: null, hosting: null, mobile: null });
        assert.deepEqual(merged.status, []);
    });

    it('drops a vendor\'s raw payload on the way through', () => {
        const merged = mergeProviders([answered('a.test', { raw: { secret: 'registrant@example.test' } })]);
        assert.ok(!JSON.stringify(merged).includes('registrant@example.test'));
        assert.ok(!('raw' in merged));
    });
});
