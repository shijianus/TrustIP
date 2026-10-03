// The trust score's classification and arithmetic, tested with no network at
// all: `assessTrust` takes evidence and returns a verdict, so every branch is
// reachable with a literal input object. The gatherer is not covered here —
// it is I/O, and its contract with the scorer is these input shapes.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessTrust, CLASSES, GAPS } from '../common/trust-score.js';

// Fixed clock so allocation-age expectations do not drift with the calendar.
const NOW = Date.parse('2026-10-03T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const signal = (result, id) => result.signals.find((s) => s.id === id);

const hosting = {
    ip: '65.21.201.224',
    geo: { asn: 24940, country_code: 'FI', isp: 'Hetzner Online', org: 'Hetzner Online' },
    asOrg: 'Hetzner Online GmbH',
    rir: { netName: 'DE-HETZNER', country: 'FI', regDate: '2020-06-24T14:02:28Z' },
    rdns: 'static.224.201.21.65.clients.your-server.de',
    announce: { v4Count: 91, smallShare: 0.25, largest: 15 },
    rpki: 'valid',
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
        assert.ok(GAPS.includes('blocklists'));
        assert.ok(GAPS.includes('anonymityNetworks'));
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
