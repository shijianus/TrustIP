// The trust score's classification and arithmetic, tested with no network at
// all: `assessTrust` takes evidence and returns a verdict, so every branch is
// reachable with a literal input object. The gatherer is not covered here —
// it is I/O, and its contract with the scorer is these input shapes.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessTrust, auditView, fingerprint, CLASSES, GAPS, TRUST_SCHEMA, WEIGHTS_VERSION } from '../common/trust-score.js';

// Fixed clock so allocation-age expectations do not drift with the calendar.
const NOW = Date.parse('2026-10-03T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const signal = (result, id) => result.signals.find((s) => s.id === id);

// A blocklist pass with every zone answering truthfully and none naming the
// address — the fully-evidenced case the fixtures are built to represent.
const CLEAN_BL = { answered: 4, listed: 0, botnet: 0, labels: ['SpamCop BL', 'Barracuda BRBL'] };

const hosting = {
    ip: '65.21.201.224',
    geo: { asn: 24940, country_code: 'FI', isp: 'Hetzner Online', org: 'Hetzner Online' },
    asOrg: 'Hetzner Online GmbH',
    rir: { netName: 'DE-HETZNER', country: 'FI', regDate: '2020-06-24T14:02:28Z' },
    rdns: 'static.224.201.21.65.clients.your-server.de',
    announce: { v4Count: 91, smallShare: 0.25, largest: 15 },
    rpki: 'valid',
    blocklists: CLEAN_BL,
    now: NOW,
};

const accessLine = {
    ip: '78.0.0.1',
    geo: { asn: 13096, country_code: 'HR', isp: 'Hrvatski Telekom', org: 'Hrvatski Telekom' },
    asOrg: 'Hrvatski Telekom d.d.',
    rir: { netName: 'HT-OOO', country: 'HR', regDate: '2007-03-14T10:00:39Z' },
    rdns: '78-0-0-1.adsl.net.t-com.hr',
    announce: { v4Count: 47, smallShare: 0.09, largest: 17 },
    rpki: 'valid',
    blocklists: CLEAN_BL,
    now: NOW,
};

describe('assessTrust', () => {
    it('gives a reserved address no score at all', () => {
        const r = assessTrust({ ip: '192.168.1.1', reserved: true });
        assert.equal(r.score, null);
        assert.equal(r.band, null);
        assert.equal(r.cls, 'non-public');
        assert.equal(r.signals.length, 1);
    });

    it('reads a hosting operator and its platform PTR as a datacenter', () => {
        const r = assessTrust(hosting);
        assert.equal(r.cls, CLASSES.datacenter);
        assert.equal(signal(r, 'registryClass').matched, 'hetzner');
        assert.equal(signal(r, 'rdns').state, 'negative');
        assert.ok(r.score < 50, `expected a low score, got ${r.score}`);
    });

    it('reads an access provider with a subscriber PTR as a line worth trusting', () => {
        const r = assessTrust(accessLine);
        assert.equal(r.cls, CLASSES.isp);
        assert.equal(signal(r, 'rdns').state, 'positive');
        assert.equal(signal(r, 'nativeness').detail, 'native');
        assert.ok(r.score >= 80, `expected a high score, got ${r.score}`);
    });

    it('orders a hosting verdict above an access verdict for the same address', () => {
        assert.ok(assessTrust(accessLine).score > assessTrust(hosting).score + 30);
    });

    // The reason matching is word-anchored rather than substring-based: 'host'
    // inside "g**host**" would otherwise hand a cable company a datacenter
    // penalty, and names like this exist.
    it('does not fire a token inside an unrelated word', () => {
        const r = assessTrust({
            ...hosting,
            asOrg: 'Ghost Communications',
            geo: { asn: 999999, country_code: 'FI', isp: 'Ghost Communications', org: 'Ghost Communications' },
            rir: { netName: 'GHOST-NET', country: 'FI' },
            rdns: null,
        });
        assert.notEqual(r.cls, CLASSES.datacenter);
        assert.equal(r.cls, CLASSES.isp);
    });

    it('does not read a city name containing "pool" as a customer pool', () => {
        const r = assessTrust({ ...hosting, asOrg: 'Liverpool Broadband', rdns: 'host-86-1.liverpool.virginmedia.net' });
        assert.notEqual(signal(r, 'rdns').state, 'positive');
    });

    it('classifies a public resolver as anycast and drops the signals that stop meaning anything', () => {
        const r = assessTrust({
            ip: '8.8.8.8',
            geo: { asn: 15169, country_code: 'US', isp: 'Google LLC', org: 'Google LLC' },
            asOrg: 'Google LLC',
            rir: { netName: 'GOGL', country: 'US', regDate: '2000-03-30' },
            rdns: 'dns.google',
            announce: { v4Count: 1235, smallShare: 0.81, largest: 14 },
            rpki: 'valid',
            now: NOW,
        });
        assert.equal(r.cls, CLASSES.anycast);
        assert.equal(r.anycast, true);
        // A resolver announces customer-facing space everywhere by design, so
        // its announcement shape and its registration-versus-geo country are
        // not evidence about anything.
        assert.equal(signal(r, 'announcement').detail, 'not-applicable');
        assert.equal(signal(r, 'nativeness').detail, 'not-applicable');
        assert.equal(signal(r, 'announcement').effect, 0);
    });

    it('does not let a cloud or CDN edge borrow the anycast exemption', () => {
        const aws = assessTrust({
            ip: '52.14.100.5',
            geo: { asn: 16509, country_code: 'US', isp: 'Amazon Technologies Inc.', org: 'AWS EC2' },
            asOrg: 'Amazon Technologies, Inc.',
            rir: { netType: 'Direct Allocation', netName: 'AMAZON-4', country: 'US', regDate: '1991-12-19' },
            rdns: 'ec2-52-14-100-5.us-east-2.compute.amazonaws.com',
            announce: { v4Count: 900, smallShare: 0.9, largest: 12 },
            rpki: 'valid',
            now: NOW,
        });
        assert.equal(aws.cls, CLASSES.datacenter);
        assert.equal(aws.anycast, false);
        assert.ok(aws.score < 50, `a rented VM should not read as trustworthy, got ${aws.score}`);
    });

    describe('signal states', () => {
        // A provably unauthorized route origin is a contradiction, not a
        // deduction: it has to cap the result whatever else the address has
        // going for it, or a misconfigured ROA becomes a rounding error.
        it('caps a disqualifying route origin below the trusting bands', () => {
            const clean = assessTrust(accessLine);
            const r = assessTrust({ ...accessLine, rpki: 'invalid' });
            assert.equal(signal(r, 'rpki').effect, -40);
            assert.equal(r.capped, 'disqualified');
            assert.ok(r.score <= 44, `expected a disqualified ceiling, got ${r.score}`);
            assert.ok(r.score < clean.score);
            assert.ok(r.raw > r.score, 'the gate should visibly pull the score down');
        });

        it('separates an over-long announcement from a wrong origin', () => {
            const over = assessTrust({ ...accessLine, rpki: 'invalid_length' });
            const wrong = assessTrust({ ...accessLine, rpki: 'invalid_asn' });
            assert.ok(Math.abs(signal(over, 'rpki').effect) < Math.abs(signal(wrong, 'rpki').effect));
        });

        // The distinction that keeps a score honest: no answer is not a clean
        // answer, and "provably no ROA covers this" is a third thing again. The
        // two are separated by effect, not by total — an unknown also shrinks
        // the confidence ceiling, which is a different mechanism.
        it('keeps "we could not validate" away from "validation found nothing"', () => {
            const unknown = assessTrust({ ...accessLine, rpki: 'unknown' });
            const missing = assessTrust({ ...accessLine, rpki: 'not-found' });
            assert.equal(signal(unknown, 'rpki').state, 'unknown');
            assert.equal(signal(unknown, 'rpki').effect, 0);
            assert.equal(signal(missing, 'rpki').state, 'negative');
            assert.equal(signal(missing, 'rpki').effect, -8);
            assert.ok(unknown.confidence.measured < missing.confidence.measured);
        });

        it('marks reverse DNS unknown when the lookup failed, not when it came back empty', () => {
            const failed = assessTrust({ ...hosting, rdnsFailed: true });
            const empty = assessTrust({ ...hosting, rdns: null });
            assert.equal(signal(failed, 'rdns').state, 'unknown');
            assert.equal(signal(failed, 'rdns').effect, 0);
            assert.notEqual(signal(empty, 'rdns').state, 'unknown');
        });

        // RIPE legacy objects use 1970-01-01 for "date unknown". Reading it as
        // a 56-year-old allocation would hand out trust for a missing fact.
        it('refuses to award age to a placeholder registration date', () => {
            const r = assessTrust({ ...accessLine, rir: { ...accessLine.rir, regDate: '1970-01-01T00:00:00Z' } });
            assert.equal(signal(r, 'allocationAge').state, 'unknown');
            assert.equal(signal(r, 'allocationAge').effect, 0);
        });

        it('awards the most age to the oldest registration', () => {
            const old = assessTrust({ ...accessLine, rir: { ...accessLine.rir, regDate: '1995-01-01' } });
            const young = assessTrust({ ...accessLine, rir: { ...accessLine.rir, regDate: new Date(NOW - 100 * DAY).toISOString() } });
            assert.ok(signal(old, 'allocationAge').effect > 0);
            assert.ok(signal(young, 'allocationAge').effect < 0);
        });
    });

    describe('the reading of an incompletely evidenced address', () => {
        // Nothing measured at all: no reverse answer (the lookup failed, as
        // opposed to coming back empty), no geo, no registry, no routing data.
        const bare = { ip: '203.0.113.9', rdnsFailed: true, now: NOW };

        it('reports every signal it could not measure as unknown', () => {
            const r = assessTrust(bare);
            assert.equal(r.confidence.measured, 0);
            assert.equal(r.confidence.total, r.signals.length);
            assert.equal(r.confidence.level, 'low');
            assert.ok(r.signals.every((s) => s.state === 'unknown'));
        });

        // The cap is what stops "we know nothing" from being displayed as a
        // pass: the raw total would sit on the neutral base, and the ceiling a
        // half-evaluated address may claim is pushed below it.
        it('caps an unevidenced address below the neutral base', () => {
            const r = assessTrust(bare);
            assert.equal(r.raw, 70);
            assert.equal(r.score, 66);
            assert.ok(r.score < r.raw);
            assert.ok(r.band <= 3, `expected no top band without evidence, got band ${r.band}`);
        });

        it('lets a fully evidenced good address reach the top band', () => {
            const r = assessTrust(accessLine);
            assert.equal(r.confidence.measured, r.confidence.total);
            assert.equal(r.confidence.level, 'high');
            assert.equal(r.band, 5);
        });

        it('widens the floor by the worst case of every unknown', () => {
            const full = assessTrust(accessLine);
            const partial = assessTrust({ ...accessLine, rpki: null, rdnsFailed: true });
            assert.equal(full.floor, full.score);
            assert.ok(partial.floor < partial.score);
            assert.ok(partial.score <= partial.ceiling);
        });

        it('never lets the floor exceed the score or the score exceed the ceiling', () => {
            for (const input of [hosting, accessLine, bare, { ...hosting, rpki: 'invalid' }]) {
                const r = assessTrust(input);
                assert.ok(r.floor <= r.score, `floor ${r.floor} above score ${r.score}`);
                assert.ok(r.score <= r.raw + 1, `score ${r.score} above raw ${r.raw}`);
            }
        });

        it('keeps the score inside 0..100 under stacked penalties', () => {
            const bad = assessTrust({
                ...hosting,
                rpki: 'invalid',
                rir: { netName: 'VPS-POOL', country: 'DE', regDate: new Date(NOW - 30 * DAY).toISOString() },
                rdns: null,
                announce: { v4Count: 4420, smallShare: 0.99, largest: 20 },
                geo: { asn: 9009, country_code: 'NL', isp: 'M247 Europe', org: 'M247' },
            });
            assert.ok(bad.score >= 0 && bad.score <= 100);
            assert.equal(bad.band, 1);
        });
    });

    it('publishes what it deliberately does not measure', () => {
        const r = assessTrust(hosting);
        assert.deepEqual(r.gaps, GAPS);
        // These are the signals a visitor could reasonably expect and would
        // otherwise read silence about as an all-clear.
        assert.ok(GAPS.includes('proxyVpnDb'));
        assert.ok(GAPS.includes('anonymityNetworks'));
        assert.ok(GAPS.includes('botTrafficRatio'));
    });

    // The optional keyed abuse feed. Its whole design is the difference between
    // "this deployment does not have the feed" and "the feed did not say".
    describe('the optional abuse feed', () => {
        const withFeed = (privacy) => assessTrust({ ...accessLine, privacy });

        // Turning the feed on must not silently cost the key-free default
        // anything: with no key the three signals stay out of the ladder, so
        // `total` and the confidence ceiling are exactly as they were.
        it('is absent from the ladder when the feed was never consulted', () => {
            const r = assessTrust(accessLine);
            assert.equal(r.confidence.total, 7, 'the key-free ladder is seven signals');
            assert.deepEqual(r.gaps, GAPS);
            for (const id of ['proxyVpnDb', 'anonymityNetworks', 'historicalAbuseReports']) {
                assert.equal(signal(r, id), undefined, `${id} should not be scored`);
            }
        });

        it('joins the ladder and closes its gaps once consulted', () => {
            const r = withFeed({ proxy: false, vpn: false, tor: false, abuser: false, abuserScore: 0, source: 'feed.test' });
            assert.equal(r.confidence.total, 10);
            assert.deepEqual(r.gaps, ['botTrafficRatio']);
            assert.equal(r.confidence.measured, 10, 'a fully answered feed is fully measured');
        });

        // Measured on `hosting`, whose raw total sits mid-range: against a
        // maxed-out access line both answers would clamp to 100 and the charge
        // would be invisible.
        it('charges a proxy or VPN and credits a clean answer', () => {
            const feed = (over) => ({
                vpn: false, tor: false, abuser: false, abuserScore: 0, source: 'feed.test', ...over,
            });
            const proxied = assessTrust({ ...hosting, privacy: feed({ proxy: true }) });
            const clean = assessTrust({ ...hosting, privacy: feed({ proxy: false }) });
            assert.equal(signal(proxied, 'proxyVpnDb').state, 'negative');
            assert.equal(signal(clean, 'proxyVpnDb').state, 'positive');
            assert.ok(clean.score > proxied.score, `${clean.score} must beat ${proxied.score}`);
            assert.equal(
                signal(assessTrust({ ...hosting, privacy: feed({ proxy: false, vpn: true }) }), 'proxyVpnDb').detail,
                'vpn', 'a VPN-only answer must not be labelled proxy',
            );
        });

        // A 0.01%-prevalence fact carries no information when it is absent, so
        // "not a Tor exit" is reported and pays nothing. The feed's clean answer
        // is worth something precisely because the vendor looked.
        it('reports not-Tor without paying for it', () => {
            const r = withFeed({ tor: false, source: 'feed.test' });
            assert.equal(signal(r, 'anonymityNetworks').state, 'neutral');
            assert.equal(signal(r, 'anonymityNetworks').effect, 0);
            const exit = withFeed({ tor: true, source: 'feed.test' });
            assert.equal(signal(exit, 'anonymityNetworks').state, 'negative');
            assert.ok(signal(exit, 'anonymityNetworks').effect < signal(r, 'anonymityNetworks').effect);
        });

        // The failure this rule exists for: a free-tier answer that simply omits
        // the detection fields must not read as a set of clears.
        it('will not read a missing field as a false one', () => {
            const r = withFeed({ source: 'feed.test' });
            for (const id of ['proxyVpnDb', 'anonymityNetworks', 'historicalAbuseReports']) {
                assert.equal(signal(r, id).state, 'unknown', `${id}: absence became a verdict`);
                assert.equal(signal(r, id).effect, 0);
            }
            assert.equal(r.confidence.measured, 7, 'three unanswerable rows cannot count as measured');
        });

        it('scales the abuse score and reads a percentage as one', () => {
            const low = withFeed({ abuserScore: 0.002, source: 'feed.test' });
            const mid = withFeed({ abuserScore: 0.03, source: 'feed.test' });
            const high = withFeed({ abuserScore: 5, source: 'feed.test' });
            const e = (r) => signal(r, 'historicalAbuseReports').effect;
            assert.ok(e(low) > 0, 'a scored-low address earns the clear bonus');
            assert.ok(e(mid) < e(low));
            assert.ok(e(high) < e(mid), '5 must be read as 5%, not as 500%');
        });

        it('honours the vendor categorical abuser flag over an absent score', () => {
            const r = withFeed({ abuser: true, source: 'feed.test' });
            assert.equal(signal(r, 'historicalAbuseReports').state, 'negative');
            assert.equal(signal(r, 'historicalAbuseReports').detail, 'abuser');
        });

        it('keeps a failed feed unknown without dropping it from the ladder', () => {
            const r = withFeed({ failed: true, source: 'feed.test' });
            assert.equal(r.confidence.total, 10, 'we asked, so the gap is about this address');
            assert.equal(r.confidence.measured, 7);
            assert.deepEqual(r.gaps, ['botTrafficRatio'], 'the feed was consulted, so it is no longer a gap');
        });

        // Stacked anonymity on an otherwise impeccable access line: it must land
        // in "risky", and it must get there by arithmetic rather than by the
        // disqualification gate — that ceiling belongs to routing facts, and a
        // vendor's flag would then be unrecoverable in a way a listing is not.
        it('never disqualifies on feed evidence alone', () => {
            const r = withFeed({ proxy: true, vpn: true, tor: true, abuser: true, source: 'feed.test' });
            assert.notEqual(r.capped, 'disqualified');
            assert.equal(r.capped, null, 'nothing should be pulling this below the additive total');
            assert.ok(r.score <= 40, `deliberate anonymising must not read as trustworthy, got ${r.score}`);
            assert.equal(r.band, 2);
        });

        // `floor` is the range the score could have occupied had the unknowns
        // resolved against us, so each unanswerable row must widen it by *that
        // row's* own charge. A hand-copied worst-case table would drift the first
        // time a weight moved; these two rows widening by different amounts is
        // what shows the values are read from where the charges live.
        it('widens the floor by each unknown row on its own terms', () => {
            const full = assessTrust({
                ...hosting,
                privacy: { proxy: false, vpn: false, tor: false, abuser: false, abuserScore: 0, source: 'feed.test' },
            });
            assert.equal(full.floor, full.score, 'a fully evidenced address has no range left');
            const dropTor = assessTrust({
                ...hosting,
                privacy: { proxy: false, vpn: false, abuser: false, abuserScore: 0, source: 'feed.test' },
            });
            const dropProxy = assessTrust({
                ...hosting,
                // Both halves of the row must go: `vpn` alone is enough for the
                // proxy/VPN signal to be answered, so dropping one field would
                // not make it unknown.
                privacy: { tor: false, abuser: false, abuserScore: 0, source: 'feed.test' },
            });
            assert.ok(dropTor.floor < dropTor.score);
            assert.ok(dropProxy.floor < dropProxy.score);
            assert.notEqual(dropTor.score - dropTor.floor, dropProxy.score - dropProxy.floor);
        });
    });

    // Blocklist answers are the one signal here that comes from somebody else's
    // accusation, so how much of the pass was actually able to speak matters as
    // much as what it said.
    describe('blocklist evidence', () => {
        const withBl = (blocklists) => assessTrust({ ...accessLine, blocklists });

        it('treats a pass where nothing answered as unmeasured, not as clean', () => {
            for (const empty of [null, undefined, { answered: 0, listed: 0 }]) {
                const r = withBl(empty);
                assert.equal(signal(r, 'blocklists').state, 'unknown');
                assert.equal(signal(r, 'blocklists').effect, 0);
            }
        });

        // One zone saying "not listed" is a sample of one; two is the smallest
        // basis worth awarding anything for.
        it('withholds the clean bonus from a single answering zone', () => {
            assert.equal(signal(withBl({ answered: 1, listed: 0 }), 'blocklists').effect, 0);
            assert.ok(signal(withBl({ answered: 2, listed: 0 }), 'blocklists').effect > 0);
        });

        it('charges more as more zones name the address', () => {
            const one = signal(withBl({ answered: 4, listed: 1 }), 'blocklists').effect;
            const two = signal(withBl({ answered: 4, listed: 2 }), 'blocklists').effect;
            const many = signal(withBl({ answered: 4, listed: 3 }), 'blocklists').effect;
            assert.ok(one < 0 && two < one && many < two, `expected a worsening ladder: ${one} ${two} ${many}`);
        });

        // A botnet feed accuses the address of attacking; a spam list accuses it
        // of annoyances. Same count, different weight.
        it('charges a botnet listing more than a spam listing', () => {
            const spam = signal(withBl({ answered: 4, listed: 1, botnet: 0 }), 'blocklists').effect;
            const botnet = signal(withBl({ answered: 4, listed: 1, botnet: 1 }), 'blocklists').effect;
            assert.ok(botnet < spam);
        });

        // The gate is a routing privilege (see GATED_SIGNALS): a stale listing
        // must be able to sink an address without disqualifying it outright, or
        // delisting would never be able to bring it back.
        it('never disqualifies on a listing alone', () => {
            const r = withBl({ answered: 4, listed: 4, botnet: 2 });
            assert.equal(signal(r, 'blocklists').state, 'negative');
            assert.notEqual(r.capped, 'disqualified');
        });

        it('shows which zones spoke', () => {
            const r = withBl({ answered: 4, listed: 1, botnet: 0, labels: ['SpamCop BL', 'Surriel PSBL'] });
            assert.equal(signal(r, 'blocklists').matched, 'SpamCop BL, Surriel PSBL');
        });
    });

    it('names the evidence behind every judgement it makes', () => {
        const r = assessTrust(hosting);
        for (const s of r.signals) {
            assert.ok(s.label.startsWith('trustip.signal.'), `signal ${s.id} has no i18n label key`);
            if (s.state === 'negative' || s.state === 'positive') {
                assert.ok(s.matched || s.detail, `signal ${s.id} asserts ${s.state} with nothing to show`);
            }
        }
    });
});

// The contract a database writes against. A stored score is only interpretable
// next to the version of the ladder that produced it, and the audit view is what
// an external consumer is allowed to hold.
describe('the stored contract', () => {
    it('names the schema and the weight table on every verdict', () => {
        const scored = assessTrust(hosting);
        const reserved = assessTrust({ ip: '10.0.0.1', reserved: true });
        assert.equal(scored.schema, TRUST_SCHEMA);
        assert.equal(reserved.schema, TRUST_SCHEMA, 'a non-public address still gets a versioned row');
        assert.match(scored.weights, /^w-[0-9a-z]+$/);
    });

    // The version identifies the arithmetic, not the address: two different IPs
    // assessed by one build must agree on it, or a stored row cannot be grouped.
    it('reports the same weight fingerprint for every address', () => {
        assert.equal(assessTrust(hosting).weights, assessTrust(accessLine).weights);
        assert.equal(assessTrust({ ip: '203.0.113.9', rdnsFailed: true, now: NOW }).weights, assessTrust(hosting).weights);
    });

    // The fingerprint is the only thing that tells a stored row which ladder
    // made it, so a hash that survives an edit is worse than no version at all:
    // two different builds would certify each other's rows as comparable. These
    // perturbations are the edits a contributor actually makes — one base, one
    // effect, one rung, one added table — and each must produce its own version.
    it('moves the fingerprint whenever the arithmetic moves', () => {
        assert.equal(fingerprint({ a: 1 }), fingerprint({ a: 1 }), 'not deterministic');
        const base = { BASE: 70, CLASS_EFFECT: { isp: 14 }, CONFIDENCE_CAPS: [100, 92, 79, 66] };
        const ladders = [
            base,
            { ...base, BASE: 71 },
            { ...base, CLASS_EFFECT: { isp: 15 } },
            { ...base, CONFIDENCE_CAPS: [100, 92, 79, 65] },
            { ...base, WORST_EFFECT: { rpki: -40 } },
        ];
        const versions = new Set(ladders.map(fingerprint));
        assert.equal(versions.size, ladders.length, 'two different ladders share one version');
    });

    it('names a version that is stable for the build', () => {
        assert.match(WEIGHTS_VERSION, /^w-[0-9a-z]+$/);
        assert.equal(assessTrust(hosting).weights, WEIGHTS_VERSION);
    });

    it('strips every number we chose from the audit view', () => {
        const view = auditView(assessTrust(hosting));
        for (const banned of ['raw', 'floor', 'ceiling']) {
            assert.ok(!(banned in view), `the audit view leaks the ${banned} total`);
        }
        for (const s of view.signals) {
            assert.ok(!('effect' in s), `signal ${s.id} ships its weight`);
        }
    });

    // What the view keeps is the point of it: the verdict, and the literal text
    // a reviewer needs to check whether the verdict was well founded.
    it('keeps the verdict and its evidence in the audit view', () => {
        const full = assessTrust(accessLine);
        const view = auditView(full);
        assert.equal(view.score, full.score);
        assert.equal(view.band, full.band);
        assert.deepEqual(view.confidence, full.confidence);
        assert.deepEqual(view.schema, full.schema);
        assert.equal(view.signals.length, full.signals.length);
        const rdns = view.signals.find((s) => s.id === 'rdns');
        assert.equal(rdns.matched, full.signals.find((s) => s.id === 'rdns').matched);
        assert.ok(rdns.state);
    });

    it('carries the version through the reserved short-circuit', () => {
        const view = auditView(assessTrust({ ip: '192.168.0.1', reserved: true }));
        assert.equal(view.score, null);
        assert.equal(view.weights, assessTrust(hosting).weights);
    });
});

// The origin-AS half of `nativeness`. These checks exist because the signal grew
// without the ladder growing: no new row means no new confidence denominator, so
// every address that has no origin recorded — or whose answers agree — must come
// out exactly as it did before. The expected objects below are the recorded
// output of the published build, not numbers chosen to match the code.
describe('nativeness at routing granularity', () => {
    const of = (input) => signal(assessTrust(input), 'nativeness');

    it('leaves an address with no origin recorded exactly as it was', () => {
        assert.deepEqual(of(hosting), {
            id: 'nativeness', state: 'positive', effect: 2,
            label: 'trustip.signal.nativeness', detail: 'native', matched: null,
        });
        assert.deepEqual(of(accessLine), {
            id: 'nativeness', state: 'positive', effect: 2,
            label: 'trustip.signal.nativeness', detail: 'native', matched: null,
        });
        assert.deepEqual(of({ ip: '203.0.113.9', rdnsFailed: true, now: NOW }), {
            id: 'nativeness', state: 'unknown', effect: 0,
            label: 'trustip.signal.nativeness', detail: null, matched: null,
        });
    });

    // A country disagreement is the stronger claim and is reported alone: the
    // two must not be added together or a single address would be charged twice
    // for one piece of disagreeing evidence.
    it('keeps the country mismatch reading exactly as before', () => {
        assert.deepEqual(of({ ...accessLine, rir: { ...accessLine.rir, country: 'DE' } }), {
            id: 'nativeness', state: 'caution', effect: -6,
            label: 'trustip.signal.nativeness', detail: 'DE≠HR', matched: 'DE / HR',
        });
    });

    it('reports an origin that contradicts the carrying AS', () => {
        const r = assessTrust({
            ...hosting,
            rir: { ...hosting.rir, originAs: 'AS99999' },
        });
        const s = signal(r, 'nativeness');
        assert.equal(s.state, 'caution');
        assert.equal(s.detail, 'AS99999≠AS24940');
        assert.match(s.matched, /^origin AS99999 \/ carried AS24940$/);
        // The rung already existed, so the move is exactly the 6 it now charges
        // plus the 2 it stops awarding — and nothing else on the page shifts.
        assert.equal(r.score, assessTrust(hosting).score - 8);
    });

    it('says nothing when the registry agrees with the geolocation', () => {
        const r = assessTrust({ ...accessLine, rir: { ...accessLine.rir, originAs: '13096' } });
        assert.equal(signal(r, 'nativeness').detail, 'native');
        assert.equal(r.score, assessTrust(accessLine).score);
    });

    // `NOT-SET`, a bare `AS`, `AS0`, an out-of-range number and an empty string
    // are all "the registry did not name an origin". Treating one as a mismatch
    // would invent an accusation out of a missing field.
    it('will not read an unparseable origin as a contradiction', () => {
        for (const junk of ['NOT-SET', 'AS', 'as', '', 'ASx1', 0, 'AS0', 'AS4294967295', null, undefined]) {
            const s = of({ ...accessLine, rir: { ...accessLine.rir, originAs: junk } });
            assert.equal(s.detail, 'native', `originAs "${junk}" was read as an answer`);
            assert.equal(s.state, 'positive');
        }
    });

    // Anycast is exempt from this signal entirely, and a public resolver's block
    // names its own AS everywhere — comparing it to one point of presence would
    // be a permanent, meaningless mismatch.
    it('does not charge an anycast service', () => {
        const s = of({
            ip: '8.8.8.8',
            geo: { asn: 15169, country_code: 'US', isp: 'Google LLC', org: 'Google LLC' },
            asOrg: 'Google LLC',
            rir: { netName: 'GOGL', country: 'US', regDate: '2000-03-30', originAs: 'AS3561' },
            rdns: 'dns.google',
            announce: { v4Count: 1235, smallShare: 0.81, largest: 14 },
            rpki: 'valid',
            now: NOW,
        });
        assert.equal(s.state, 'unknown');
        assert.equal(s.effect, 0);
        assert.equal(s.detail, 'not-applicable');
    });

    it('leaves the ladder the same seven signals it was', () => {
        assert.equal(assessTrust(hosting).confidence.total, 7, 'a widened signal must not add a row');
    });
});
