// common/dnsbl.js — what a blocklist pass reports for a given set of DNS
// answers, with the resolver faked at its boundary.
//
// The behaviour worth pinning is not "did it parse an A record" but the four
// ways an answer can be misread as a verdict: a diagnostic code (the zone
// refusing *our query*), an answer outside 127.0.0.0/8 (a sinkhole), a resolver
// that invents answers for every name, and a code that describes the address's
// range rather than its conduct. The canary is what separates an accusation from
// a lie, so the tests below drive it directly.

import assert from 'node:assert/strict';
import { after, afterEach, describe, it } from 'node:test';
import { Resolver } from 'node:dns/promises';

import { checkBlocklists, tallyOf, classifyError, isBlocklistedRange, readCode } from '../common/dnsbl.js';
import { DNSBL_ZONES } from '../common/dnsbl-zones.js';
import { reverseName } from '../common/ip-math.js';
import dnsblHandler from '../api/dnsbl.js';

const ZONE_NAMES = ['bl.spamcop.net', 'b.barracudacentral.org', 'bl.blocklist.de', 'psbl.surriel.com'];

const dnsError = (code) => Object.assign(new Error(code), { code });

const originalResolve = Resolver.prototype.resolve4;
const originalSetServers = Resolver.prototype.setServers;

// Which recursor a query went through is what the module asks a Resolver for, so
// the fake records it — a test that wants one resolver to lie and the next to
// answer truthfully needs to tell them apart.
Resolver.prototype.setServers = function (list) {
    this.__servers = list;
    return originalSetServers.call(this, list);
};

// `handler(name, server, index)` returns an address list, or throws dnsError().
const install = (handler) => {
    const seen = [];
    Resolver.prototype.resolve4 = function (name) {
        seen.push({ name, server: this.__servers?.[0] });
        return Promise.resolve(handler(name, this.__servers?.[0], seen.length - 1));
    };
    return seen;
};

afterEach(() => {
    Resolver.prototype.resolve4 = originalResolve;
    delete process.env.DNSBL_RESOLVERS;
});

// A name whose first label is the process canary: 32 hex chars, which no
// blocklist publishes as content.
const isCanary = (name) => /^[0-9a-f]{32}\./.test(name);

const cleanEverywhere = () => {
    throw dnsError('ENOTFOUND');
};

describe('checkBlocklists', () => {
    it('reads an NXDOMAIN from every zone as clean, and counts them', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.1';
        install(cleanEverywhere);

        const pass = await checkBlocklists('203.0.113.11');
        assert.equal(pass.supported, true);
        assert.equal(pass.resolver, '10.53.0.1');
        assert.equal(pass.results.length, ZONE_NAMES.length);
        assert.ok(pass.results.every((r) => r.status === 'clean' && r.listed === false));
        assert.deepEqual(
            { ...pass.tally },
            { zones: ZONE_NAMES.length, answered: ZONE_NAMES.length, listed: 0, botnet: 0, policy: 0 },
        );
    });

    it('names the zone that listed the address, with the code it answered', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.2';
        const target = reverseName('198.51.100.7');
        const seen = install((name) => {
            if (isCanary(name)) return [];
            if (name.startsWith(target) && name.endsWith('bl.blocklist.de')) return ['127.0.0.2'];
            if (name.startsWith(target)) throw dnsError('ENOTFOUND');
            return [];
        });

        const pass = await checkBlocklists('198.51.100.7');
        const hit = pass.results.find((r) => r.listed);
        assert.equal(hit.zone, 'bl.blocklist.de');
        assert.equal(hit.category, 'Botnet');
        assert.equal(hit.codes[0].address, '127.0.0.2');
        assert.equal(hit.codes[0].meaning, 'listed');
        assert.equal(pass.tally.listed, 1);
        // The canary is asked because an accusation is about to be reported — and
        // only of the zone that made it. A zone that answered "clean" has already
        // proved this resolver told the truth about it, since interception always
        // shows up as a hit.
        const canaries = seen.filter((q) => isCanary(q.name));
        assert.equal(canaries.length, 1, `${canaries.length} canary queries for one accusation`);
        assert.ok(canaries[0].name.endsWith('bl.blocklist.de'), 'the canary was asked in the wrong zone');
        assert.ok(pass.results.filter((r) => !r.listed).every((r) => r.status === 'clean'));
    });

    // 127.255.255.254 means "you are not entitled to ask". Scoring it either way
    // would be a lie: as listed it accuses, as clean it passes. It must land in
    // neither bucket, so `answered` drops and the signal turns unknown.
    it('treats a query-refusal code as no answer, in neither direction', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.3';
        install(() => ['127.255.255.254']);

        const pass = await checkBlocklists('198.51.100.8');
        assert.ok(pass.results.every((r) => r.status === 'query-refused'));
        assert.ok(pass.results.every((r) => r.listed === false));
        assert.equal(pass.tally.answered, 0);
    });

    it('keeps an undocumented 127.x answer as a listing it cannot name', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.4';
        install((name) => (isCanary(name) ? [] : ['127.0.0.99']));
        const pass = await checkBlocklists('198.51.100.9');
        assert.equal(pass.tally.listed, ZONE_NAMES.length);
        assert.ok(pass.results.every((r) => r.codes[0].meaning === 'undocumented'));
    });

    // A poisoned recursor answering 0.0.0.0 for everything is a different fault
    // from a blocklist: the address was not named by any zone.
    it('refuses to read an answer outside 127.0.0.0/8 as a listing', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.5';
        install(() => ['0.0.0.0']);

        const pass = await checkBlocklists('198.51.100.10');
        assert.ok(pass.results.every((r) => r.status === 'bogus-answer'));
        assert.equal(pass.tally.listed, 0);
        assert.equal(pass.tally.answered, 0);
    });

    it('throws away a pass from a resolver that invents answers', async () => {
        // The first recursor fabricates every answer, the second tells the truth.
        process.env.DNSBL_RESOLVERS = '10.53.0.6,10.53.0.7';
        install((name, server) => {
            if (server === '10.53.0.6') return ['127.0.0.2'];
            throw dnsError('ENOTFOUND');
        });

        const pass = await checkBlocklists('198.51.100.11');
        assert.equal(pass.resolver, '10.53.0.7', 'the fabricating resolver must not be the source');
        assert.equal(pass.tally.listed, 0);
        assert.equal(pass.tally.answered, ZONE_NAMES.length);
    });

    // A canary that could not be asked is not a canary that passed. Reporting
    // the listing would be exactly the false accusation the canary exists for.
    it('downgrades a listing whose canary timed out, without abandoning the resolver', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.8';
        const target = reverseName('198.51.100.12');
        install((name) => {
            if (isCanary(name)) throw dnsError('ETIMEOUT');
            if (name.startsWith(target) && name.endsWith('bl.spamcop.net')) return ['127.0.0.2'];
            throw dnsError('ENOTFOUND');
        });

        const pass = await checkBlocklists('198.51.100.12');
        const hit = pass.results.find((r) => r.zone === 'bl.spamcop.net');
        assert.equal(hit.status, 'unverified');
        assert.equal(hit.listed, false);
        assert.equal(pass.tally.listed, 0);
        assert.equal(pass.resolver, '10.53.0.8', 'unproven is not proof of interception');
    });

    it('reports a resolver error as no answer, never as clean', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.9';
        install(() => {
            throw dnsError('ESERVFAIL');
        });

        const pass = await checkBlocklists('198.51.100.13');
        assert.ok(pass.results.every((r) => r.status === 'servfail'));
        assert.equal(pass.tally.answered, 0);
    });

    it('declines IPv6 rather than reporting every v6 address as unlisted', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.10';
        const seen = install(() => []);

        const pass = await checkBlocklists('2001:db8::1');
        assert.equal(pass.supported, false);
        assert.equal(pass.reason, 'no-ipv6-zone');
        assert.equal(pass.tally.answered, 0);
        assert.equal(seen.length, 0, 'an unsupported family must not be queried at all');
    });

    it('answers a repeat query for the same address from cache', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.11';
        const seen = install(cleanEverywhere);

        await checkBlocklists('198.51.100.14');
        const first = seen.length;
        assert.ok(first >= ZONE_NAMES.length);
        const again = await checkBlocklists('198.51.100.14');
        assert.equal(seen.length, first, 'the second pass re-queried the zones instead of reading the cache');
        assert.equal(again.resolver, '10.53.0.11');
    });
});

// A policy code is a zone's rule about an address *range* — a dynamic block
// that should not speak SMTP directly, say — not something the zone saw this
// address do. So it accuses nobody. The half that is easy to get wrong is the
// other direction: it also clears nobody, and a pass made only of policy answers
// leaves `answered` at zero, which the score reads as unmeasured rather than as a
// clean sheet.
describe('a range-policy answer', () => {
    // No shipped zone declares one (common/dnsbl-zones.js explains why), so the
    // path is driven by appending a zone to the very array a pass iterates, and
    // removing it again before anything else gets to ask a question.
    const POLICY_ZONE = {
        id: 'spec-range-policy',
        label: 'Spec Range Policy BL',
        zone: 'policy.spec.test',
        category: 'Reputation',
        listings: { '127.0.0.2': 'listed' },
        policy: { '127.0.0.11': 'range-policy' },
    };

    const withPolicyZone = async (run) => {
        DNSBL_ZONES.push(POLICY_ZONE);
        try {
            return await run();
        } finally {
            DNSBL_ZONES.pop();
        }
    };

    it('reads the declared code as its own status, code and all', async () => {
        // A fresh address per pass: `checkBlocklists` caches by address, so an IP
        // another block has already asked about would answer from that cache.
        process.env.DNSBL_RESOLVERS = '10.53.0.40';
        const target = reverseName('198.51.100.150');
        const seen = install((name) => {
            if (isCanary(name)) return [];
            if (name.startsWith(target) && name.endsWith(POLICY_ZONE.zone)) return ['127.0.0.11'];
            throw dnsError('ENOTFOUND');
        });

        const pass = await withPolicyZone(() => checkBlocklists('198.51.100.150'));
        const hit = pass.results.find((r) => r.zone === POLICY_ZONE.zone);
        assert.equal(hit.status, 'policy');
        assert.equal(hit.listed, false);
        assert.deepEqual(hit.codes, [{ address: '127.0.0.11', kind: 'policy', meaning: 'range-policy' }]);
        assert.equal(pass.tally.policy, 1);
        // The zones that returned NXDOMAIN did answer about this address, so
        // they stay in `answered`; the policy zone joins neither bucket.
        assert.equal(pass.tally.answered, ZONE_NAMES.length);
        assert.equal(pass.tally.listed, 0);
        // A policy answer is canary-checked like an accusation: a recursor that
        // invents the policy code for every name would otherwise hide a genuinely
        // listed address behind "that is only the range's policy".
        const canaries = seen.filter((q) => isCanary(q.name));
        assert.equal(canaries.length, 1, 'the policy answer was not canary-checked');
        assert.ok(canaries[0].name.endsWith(POLICY_ZONE.zone), 'canary asked in the wrong zone');
    });

    it('lets a real listing stand when a policy code arrives beside it', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.41';
        const target = reverseName('198.51.100.151');
        install((name) => {
            if (isCanary(name)) return [];
            if (name.startsWith(target) && name.endsWith(POLICY_ZONE.zone)) return ['127.0.0.2', '127.0.0.11'];
            throw dnsError('ENOTFOUND');
        });

        const pass = await withPolicyZone(() => checkBlocklists('198.51.100.151'));
        const hit = pass.results.find((r) => r.zone === POLICY_ZONE.zone);
        assert.equal(hit.status, 'listed');
        assert.equal(hit.listed, true);
        assert.equal(pass.tally.listed, 1);
        assert.equal(pass.tally.policy, 0, 'a mixed answer is an accusation, not a policy row');
    });

    it('classifies each code once, in the order the zone speaks about it', () => {
        assert.deepEqual(readCode(POLICY_ZONE, '127.0.0.11'), { address: '127.0.0.11', kind: 'policy', meaning: 'range-policy' });
        assert.deepEqual(readCode(POLICY_ZONE, '127.0.0.2'), { address: '127.0.0.2', kind: 'accusation', meaning: 'listed' });
        assert.equal(readCode(POLICY_ZONE, '127.0.0.99').kind, 'accusation', 'undocumented');
        assert.equal(readCode(POLICY_ZONE, '127.0.0.99').meaning, 'undocumented');
        assert.equal(readCode(POLICY_ZONE, '127.255.255.254').kind, 'diagnostic');
        // A zone that declares no policy list cannot invent one: the same code is
        // an unnamed listing there, which is the shipped behaviour unchanged.
        assert.equal(readCode({ listings: {} }, '127.0.0.11').kind, 'accusation');
    });

    it('counts a policy-only pass as nothing answered', () => {
        const tally = tallyOf([
            { status: 'policy', listed: false, category: 'Spam' },
            { status: 'policy', listed: false, category: 'Botnet' },
        ]);
        assert.deepEqual(tally, { zones: 2, answered: 0, listed: 0, botnet: 0, policy: 2 });
    });
});

describe('reverseName', () => {
    it('reverses v4 octets under in-addr.arpa', () => {
        assert.equal(reverseName('198.51.100.7'), '7.100.51.198.in-addr.arpa');
    });

    it('reverses v6 nibbles, expanded, under ip6.arpa', () => {
        const name = reverseName('2001:db8::1');
        // 32 nibbles is the whole contract; the string is checked against the
        // canonical form of this address so a padding bug cannot hide in it.
        const parts = name.split('.');
        assert.equal(parts.length - 2, 32, `${name} is not 32 nibbles`);
        assert.deepEqual(parts.slice(-2), ['ip6', 'arpa']);
        assert.equal(name, '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
    });

    it('returns null for something that is not an address', () => {
        for (const bad of ['', 'example.com', '01.2.3.4', '999.1.1.1', '1.2.3']) {
            assert.equal(reverseName(bad), null, `${bad} must not produce a query name`);
        }
    });
});

// The HTTP shell. `api/dnsbl.js` has no branch that returns before a query
// fires — no key to be missing, no param to validate (requirePublicIP is
// middleware, covered by tests/guards.test.js) — so it is not a fit for
// api-handlers.test.js's stated scope. What is worth pinning is the response
// contract a stored row is written from, and that a path which cannot answer
// DNS degrades to an unanswered signal instead of an accusation or an outage.
describe('GET /api/dnsbl', () => {
    const collect = () => {
        const body = {};
        let status = 200;
        return {
            res: {
                json: (payload) => { Object.assign(body, payload); return body; },
                status: (code) => { status = code; return { json: (payload) => Object.assign(body, payload) }; },
            },
            body,
            get status() { return status; },
        };
    };

    it('answers with the schema and the per-zone pass', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.12';
        install(cleanEverywhere);
        const { res, body, status } = collect();

        await dnsblHandler({ query: { ip: '198.51.100.20' } }, res);

        assert.equal(status, 200);
        assert.equal(body.schema, 'dnsbl/v1');
        assert.equal(body.ip, '198.51.100.20');
        assert.equal(body.resolver, '10.53.0.12');
        assert.equal(body.tally.zones, ZONE_NAMES.length);
        assert.ok(Array.isArray(body.results));
        assert.ok(body.results.every((r) => 'status' in r && 'listed' in r && 'label' in r));
    });

    // The property an operator needs from a deployment whose network intercepts
    // DNS: the endpoint answers, says it could not trust any path, and accuses
    // nobody. A 500 would make a blocked network look like an outage; a "clean"
    // would be the false pass this module exists to prevent.
    it('answers without accusing when every candidate resolver fabricates', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.13,10.53.0.14';
        install(() => ['127.0.0.2']);
        const { res, body, status } = collect();

        await dnsblHandler({ query: { ip: '198.51.100.21' } }, res);

        assert.equal(status, 200);
        assert.equal(body.resolver, null);
        assert.equal(body.reason, 'no-trustworthy-resolver');
        assert.equal(body.tally.listed, 0);
        assert.equal(body.tally.answered, 0);
    });

    // A recursor that cannot answer at all — the state of a network that
    // intercepts DNS — has to produce an unanswered signal, not an accusation and
    // not a 500. A blocked path is a property of the deployment, and the page must
    // be able to say "not measured" without the endpoint looking like an outage.
    it('answers an unmeasured pass when no zone can be reached', async () => {
        process.env.DNSBL_RESOLVERS = '10.53.0.15';
        install(() => { throw dnsError('ETIMEOUT'); });
        const { res, body, status } = collect();

        await dnsblHandler({ query: { ip: '198.51.100.23' } }, res);

        assert.equal(status, 200);
        assert.equal(body.tally.answered, 0);
        assert.equal(body.tally.listed, 0);
        assert.ok(body.results.every((r) => r.status === 'timeout' && r.listed === false));
    });
});

describe('answer classification', () => {
    it('maps node resolver error codes onto a closed set', () => {
        assert.equal(classifyError(dnsError('ENOTFOUND')), 'clean');
        assert.equal(classifyError(dnsError('ENODATA')), 'clean');
        assert.equal(classifyError(dnsError('ESERVFAIL')), 'servfail');
        assert.equal(classifyError(dnsError('EREFUSED')), 'refused');
        assert.equal(classifyError(dnsError('ENOTIMP')), 'refused');
        assert.equal(classifyError(dnsError('ETIMEOUT')), 'timeout');
        assert.equal(classifyError(dnsError('WEIRD')), 'error');
    });

    it('recognises the blocklist answer range', () => {
        assert.equal(isBlocklistedRange('127.0.0.2'), true);
        assert.equal(isBlocklistedRange('127.255.255.254'), true);
        assert.equal(isBlocklistedRange('0.0.0.0'), false);
        assert.equal(isBlocklistedRange('192.0.2.1'), false);
    });

    it('counts only definite answers as evidence', () => {
        const tally = tallyOf([
            { status: 'listed', listed: true, category: 'Spam' },
            { status: 'clean', listed: false, category: 'Spam' },
            { status: 'query-refused', listed: false, category: 'Spam' },
            { status: 'intercepting', listed: false, category: 'Botnet' },
            { status: 'bogus-answer', listed: false, category: 'Botnet' },
        ]);
        assert.deepEqual(tally, { zones: 5, answered: 2, listed: 1, botnet: 0, policy: 0 });
    });
});

after(() => {
    Resolver.prototype.resolve4 = originalResolve;
    Resolver.prototype.setServers = originalSetServers;
});
