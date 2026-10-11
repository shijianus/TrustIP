// The optional keyed abuse feed: which fields of an upstream answer this build is
// willing to score, how a configured key is picked, and what the gatherer does
// with the feed when it is switched on and when it is not.
//
// `interpretAbuseFeed` is where a third party's JSON becomes our evidence, so
// these tests pin the two ways that translation can lie: reading an absent field
// as a clean one, and copying out registrant contact data nobody asked for.
//
// The gatherer half runs the feed's answer through the same merge as the
// commercial lists (`common/providers/vote.js`), because one vendor's verdict on
// one address must cost one call however many switches want a piece of it.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { Resolver } from 'node:dns/promises';

import { interpretAbuseFeed, gatherTrustEvidence } from '../common/trust-signals.js';
import { pickIpApiIsKey } from '../common/ipapi-key.js';
import { INTERNETDB_SOURCE } from '../common/providers/internetdb.js';
import { resetTrustCache } from '../common/trust-cache.js';
import { resetQuota } from '../common/providers/quota.js';

const ENV_KEYS = [
    'IPAPIIS_API_KEY', 'TRUST_IPAPIIS_FEED', 'TRUST_PROVIDERS', 'PROXYCHECK_API_KEY',
    'TRUST_PROVIDER_DAILY_MAX', 'TRUST_CACHE_TTL_SECONDS',
];
let envBackup = {};

beforeEach(() => {
    envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    // A warm cache would make the "off path asks nothing keyed" tests pass
    // vacuously, so every test starts with an empty one.
    resetTrustCache();
    resetQuota();
});
afterEach(() => {
    for (const [k, v] of Object.entries(envBackup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

// A realistic answer: the documented detection flags, the score beside the ASN,
// and the registrant abuse contact that must never be carried out.
const SAMPLE = {
    ip: '198.51.100.9',
    is_datacenter: true,
    is_proxy: true,
    is_vpn: false,
    is_tor: false,
    is_abuser: false,
    is_mobile: false,
    company: { name: 'Example VPS', abuser_score: 0.03 },
    asn: { asn: 200001, abuser_score: 0.07 },
    abuse: { name: 'Jo Bloggs', address: '1 Road, City', email: 'net-abuse@example.test', phone: '+1-555-0000' },
    location: { city: 'Nowhere', country_code: 'ZZ' },
};

describe('interpretAbuseFeed', () => {
    it('maps the documented flags onto our own names', () => {
        const read = interpretAbuseFeed(SAMPLE);
        assert.equal(read.proxy, true);
        assert.equal(read.vpn, false);
        assert.equal(read.tor, false);
        assert.equal(read.abuser, false);
        assert.equal(read.source, 'ipapi.is');
    });

    it('carries the score the vendor actually published', () => {
        assert.equal(interpretAbuseFeed(SAMPLE).abuserScore, 0.07);
        assert.equal(interpretAbuseFeed({ company: { abuser_score: 0.02 } }).abuserScore, 0.02);
    });

    // The two objects describe different scopes (one network, one customer
    // block); the worse of the two is the one that accuses this address.
    it('takes the higher of the ASN and company scores', () => {
        assert.equal(interpretAbuseFeed({ asn: { abuser_score: 0.01 }, company: { abuser_score: 0.2 } }).abuserScore, 0.2);
    });

    // The failure that would silently hand out trust: a free-tier answer with no
    // detection fields must come back as "we were not told", never as four falses.
    it('answers failed when the response carries nothing it can score', () => {
        for (const body of [{}, { ip: '1.1.1.1' }, null, undefined, 'text', 7, { location: { city: 'X' } }]) {
            assert.deepEqual(interpretAbuseFeed(body), { failed: true, source: 'ipapi.is' }, `${JSON.stringify(body)}`);
        }
    });

    it('answers failed for a score that is not a number', () => {
        assert.equal(interpretAbuseFeed({ asn: { abuser_score: 'high' } }).failed, true);
        assert.equal(interpretAbuseFeed({ asn: { abuser_score: null } }).failed, true);
    });

    // A non-boolean is not a false: `is_proxy: null` means the vendor did not
    // answer, and scoring it as "not a proxy" would be the inversion above.
    it('ignores flags that are not plain booleans', () => {
        const read = interpretAbuseFeed({ is_proxy: null, is_vpn: 'false', is_tor: false });
        assert.ok(!('proxy' in read), 'null read as false');
        assert.ok(!('vpn' in read), 'a string read as a boolean');
        assert.equal(read.tor, false);
        assert.ok(!read.failed, 'one real flag is enough to have an answer');
    });

    // This is the standing boundary on every registry route: a trust verdict does
    // not need a registrant's name, address, e-mail or phone, and echoing them
    // would make the endpoint a people-search proxy.
    it('never carries the registrant abuse contact out', () => {
        const read = interpretAbuseFeed(SAMPLE);
        const text = JSON.stringify(read);
        assert.ok(!('abuse' in read));
        for (const secret of ['Jo Bloggs', 'net-abuse@example.test', '+1-555-0000', '1 Road']) {
            assert.ok(!text.includes(secret), `the answer leaked "${secret}"`);
        }
    });

    it('keeps only the fields the scorer reads', () => {
        assert.deepEqual(
            Object.keys(interpretAbuseFeed(SAMPLE)).sort(),
            ['abuser', 'abuserScore', 'hosting', 'mobile', 'proxy', 'source', 'tor', 'vpn'],
        );
    });
});

describe('pickIpApiIsKey', () => {
    it('returns null when nothing is configured', () => {
        assert.equal(pickIpApiIsKey(), null);
        process.env.IPAPIIS_API_KEY = '';
        assert.equal(pickIpApiIsKey(), null);
        process.env.IPAPIIS_API_KEY = ' , , ';
        assert.equal(pickIpApiIsKey(), null, 'blank entries are not keys');
    });

    it('returns the single configured key', () => {
        process.env.IPAPIIS_API_KEY = 'solo';
        assert.equal(pickIpApiIsKey(), 'solo');
    });

    // Rotation is the whole point of the comma list: one key taking every request
    // would exhaust it while the others sat idle.
    it('draws from every key of a comma-separated pool', () => {
        process.env.IPAPIIS_API_KEY = 'a, b ,c';
        const seen = new Set();
        for (let i = 0; i < 400; i += 1) seen.add(pickIpApiIsKey());
        assert.deepEqual([...seen].sort(), ['a', 'b', 'c'], 'keys are not trimmed or rotated');
    });
});

// The gatherer, with the feed switched on. The pure halves above cannot see the
// one failure this covers: the feed is consulted through the same address cache as
// every other registry, so getting its arguments in the wrong order throws before
// a request leaves — and only a deployment that enabled the feed would ever find
// out. Both the enabled and the disabled path are pinned, because "off" is the
// configuration this fork ships in and it must stay a declared gap rather than a
// failed source.
describe('gatherTrustEvidence and the optional feed', () => {
    const originalFetch = globalThis.fetch;
    const originalResolve = Resolver.prototype.resolve4;

    // Every upstream but the feed is made unreachable: the run stays offline, the
    // evidence stays sparse, and a failing registry must not hide what the feed
    // did or did not answer. Blocklist zones are answered at the Resolver, which
    // is not a fetch, so it is stubbed to a truthful NXDOMAIN.
    const stubNetwork = (feedBody) => {
        const calls = [];
        Resolver.prototype.resolve4 = () => Promise.reject(
            Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
        );
        globalThis.fetch = async (url) => {
            calls.push(String(url));
            if (String(url).includes('api.ipapi.is')) {
                if (feedBody === 'boom') throw new Error('feed timeout');
                return { ok: true, status: 200, json: async () => feedBody };
            }
            if (String(url).includes('proxycheck.io')) {
                const ip = String(url).split('/v2/')[1].split('?')[0];
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ status: 'ok', [ip]: { proxy: 'yes', type: 'Tor', risk: '1' } }),
                };
            }
            return { ok: false, status: 500, json: async () => ({}) };
        };
        return calls;
    };

    afterEach(() => {
        globalThis.fetch = originalFetch;
        Resolver.prototype.resolve4 = originalResolve;
    });

    it('carries the feed\'s verdict when it answers', async () => {
        process.env.TRUST_IPAPIIS_FEED = 'true';
        process.env.IPAPIIS_API_KEY = 'test-key';
        stubNetwork(SAMPLE);

        const evidence = await gatherTrustEvidence('203.0.113.55');

        assert.equal(evidence.privacy.proxy, true, 'the feed answered but the evidence is empty');
        assert.ok(!('abuse' in evidence.privacy), 'the registrant contact came through');
        assert.ok(!evidence.failed.includes('abuse-feed'), 'a feed that answered is not a failed source');
    });

    // The vendor's `is_datacenter` is a vote on the same question the registry's
    // own text answers, so it has to survive the merge to reach the ladder.
    it('carries the feed\'s read of the block itself', async () => {
        process.env.TRUST_IPAPIIS_FEED = 'true';
        process.env.IPAPIIS_API_KEY = 'test-key';
        stubNetwork(SAMPLE);

        const evidence = await gatherTrustEvidence('203.0.113.58');

        assert.equal(evidence.privacy.hosting, true);
        assert.equal(evidence.privacy.by.hosting, 'ipapi.is');
    });

    it('reports the feed as failed when it could not be reached', async () => {
        process.env.TRUST_IPAPIIS_FEED = 'true';
        process.env.IPAPIIS_API_KEY = 'test-key';
        stubNetwork('boom');

        const evidence = await gatherTrustEvidence('203.0.113.56');

        // Asked, and nothing answered: the roster says so, no capability has a
        // verdict, and the gatherer records the source as failed — which is what
        // makes the scorer charge it against confidence instead of declaring it a
        // capability this deployment never claimed.
        assert.deepEqual(evidence.privacy.sources, []);
        assert.deepEqual(evidence.privacy.status, [{ source: 'ipapi.is', status: 'error', reason: 'request-failed' }]);
        assert.equal(evidence.privacy.proxy, null);
        assert.ok(evidence.failed.includes('abuse-feed'), 'a consulted-but-failed feed must shrink confidence');
    });

    // Off, the gatherer must not ask anything keyed at all, and the scorer's
    // `gaps` mechanism depends on `privacy` being absent rather than empty.
    it('asks nothing keyed while the feed stays off', async () => {
        process.env.IPAPIIS_API_KEY = 'test-key';
        delete process.env.TRUST_IPAPIIS_FEED;
        const asked = [];
        stubNetwork(SAMPLE);
        globalThis.fetch = async (url) => {
            asked.push(String(url));
            return { ok: false, status: 500, json: async () => ({}) };
        };

        const evidence = await gatherTrustEvidence('203.0.113.57');

        assert.ok(!asked.some((u) => u.includes('api.ipapi.is')), `the feed was consulted: ${asked.join(' ')}`);
        assert.ok(!('privacy' in evidence), 'an unconsulted feed must not look like an empty answer');
        assert.ok(!evidence.failed.includes('abuse-feed'), 'a capability never claimed is not a failed source');
    });

    // Both switches on: one address still costs one call to a vendor, and the two
    // answers are merged rather than concatenated — which is the whole reason the
    // feed is re-expressed in the providers' shape instead of scored on its own.
    it('merges a listed provider with the feed, asking each vendor once', async () => {
        process.env.TRUST_IPAPIIS_FEED = 'true';
        process.env.TRUST_PROVIDERS = 'proxycheck';
        process.env.IPAPIIS_API_KEY = 'test-key';
        process.env.PROXYCHECK_API_KEY = 'test-proxy-key';
        const asked = [];
        stubNetwork(SAMPLE);
        globalThis.fetch = async (url) => {
            asked.push(String(url));
            if (String(url).includes('proxycheck.io')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({ status: 'ok', '203.0.113.59': { proxy: 'no', tor: 'yes', risk: '40' } }),
                };
            }
            if (String(url).includes('api.ipapi.is')) return { ok: true, status: 200, json: async () => SAMPLE };
            return { ok: false, status: 500, json: async () => ({}) };
        };

        const evidence = await gatherTrustEvidence('203.0.113.59');

        assert.equal(asked.filter((u) => u.includes('api.ipapi.is')).length, 1, 'the vendor was asked twice');
        assert.deepEqual(evidence.privacy.sources, ['ipapi.is', 'proxycheck.io']);
        // Each row names whoever decided it: the proxy verdict came from the feed,
        // the Tor one from the list, and neither vendor answers for the other.
        assert.equal(evidence.privacy.by.proxy, 'ipapi.is');
        assert.equal(evidence.privacy.by.tor, 'proxycheck.io');
        assert.deepEqual(evidence.privacy.votes.tor, { yes: 1, no: 1 });
        assert.ok(!evidence.failed.includes('abuse-feed'));
    });

    // The scan archive's facts stay beside the verdict: which ports were seen is a
    // different question from who is anonymising, and a CVE is the operator's patch
    // schedule, not the visitor's posture. Absent unless the deployment asks.
    it('keeps the scan archive\'s observations out of the verdict', async () => {
        process.env.TRUST_PROVIDERS = 'internetdb';
        stubNetwork(SAMPLE);
        globalThis.fetch = async (url) => (String(url).includes('internetdb.shodan.io')
            ? {
                ok: true,
                status: 200,
                json: async () => ({ ip: '203.0.113.60', ports: [22, 443], tags: ['ssh'], vulns: [], hostnames: [], cpes: [] }),
            }
            : { ok: false, status: 500, json: async () => ({}) });

        const evidence = await gatherTrustEvidence('203.0.113.60');

        assert.deepEqual(evidence.scan, {
            status: 'record', ports: [22, 443], tags: ['ssh'], vulns: [], hostnames: [], cpes: [],
        });
        // A tag list naming no anonymiser leaves every capability unanswered —
        // silence, not a clearance.
        assert.equal(evidence.privacy.proxy, null);
        assert.equal(evidence.privacy.hosting, null);
        assert.deepEqual(evidence.privacy.sources, [INTERNETDB_SOURCE]);
    });

    // The cache's whole purpose, asserted as a count rather than a feeling: one
    // address costs one fan-out per clock, not one per request. A visitor sharing
    // the link, a second reader of that link and the dossier that embeds the score
    // all ask about the same address, and without this the key behind the opt-in
    // feeds would be spent once per page view.
    it('asks nothing on a second lookup of the same address', async () => {
        process.env.TRUST_IPAPIIS_FEED = 'true';
        process.env.IPAPIIS_API_KEY = 'test-key';
        process.env.TRUST_PROVIDERS = 'proxycheck';
        process.env.PROXYCHECK_API_KEY = 'test-key';
        const calls = stubNetwork(SAMPLE);

        const first = await gatherTrustEvidence('203.0.113.90');
        const spent = calls.length;
        assert.ok(spent > 0, 'the first lookup should have asked the feed and the vendor');
        assert.ok(first.privacy.sources.includes('proxycheck.io'), 'the keyed vendor was not asked at all');

        const second = await gatherTrustEvidence('203.0.113.90');

        assert.equal(calls.length, spent, `${calls.length - spent} upstream calls on a cached address`);
        assert.deepEqual(second.privacy, first.privacy, 'the cached answer is not the same answer');
    });

    // The budget and the cache are different switches, and a reader of the response
    // has to be able to tell them apart: `missing_key` sends an operator to a key
    // they already have, when the thing to change is the ceiling.
    it('answers quota, not missing_key, once the declared budget is spent', async () => {
        process.env.TRUST_PROVIDERS = 'proxycheck';
        process.env.PROXYCHECK_API_KEY = 'test-key';
        process.env.TRUST_PROVIDER_DAILY_MAX = '1';
        const calls = stubNetwork(SAMPLE);

        const first = await gatherTrustEvidence('203.0.113.91');
        assert.deepEqual(first.privacy.status, [{ source: 'proxycheck.io', status: 'ok', reason: null }]);

        const second = await gatherTrustEvidence('203.0.113.92');
        const asked = calls.filter((url) => url.includes('proxycheck.io')).length;
        assert.equal(asked, 1, 'a vendor over its budget was still asked');
        assert.deepEqual(second.privacy.status, [{ source: 'proxycheck.io', status: 'unavailable', reason: 'quota' }]);
    });
});
