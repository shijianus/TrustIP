// The dossier's pure pieces: how several geolocation answers collapse into a
// consensus and a spread, and the contract every section declares for itself.
//
// The network calls are not covered here — they are I/O, and their shapes are
// these functions' inputs.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';

import {
    buildGeo, buildNeighbours, haversineKm, geoFromEvidence, technicalSlot, SLOTS,
    BLOCKLIST_GAP_REASONS,
} from '../common/ip-dossier.js';

const source = (id, over = {}) => ({
    id, label: id.toUpperCase(),
    country: 'Germany', country_code: 'DE', region: 'Berlin', city: 'Berlin',
    lat: 52.52, lon: 13.405,
    ...over,
});

describe('haversineKm', () => {
    it('is zero for a point against itself', () => {
        assert.equal(haversineKm({ lat: 10, lon: 20 }, { lat: 10, lon: 20 }), 0);
    });

    // Berlin to Munich is ~504 km; the value is checked as a range because the
    // exact figure depends on which radius the formula uses.
    it('measures a known distance', () => {
        const berlin = { lat: 52.52, lon: 13.405 };
        const munich = { lat: 48.137, lon: 11.575 };
        const km = haversineKm(berlin, munich);
        assert.ok(km > 480 && km < 530, `expected ~504 km, got ${km}`);
    });
});

describe('geoFromEvidence', () => {
    // The canonical geo shape spells coordinates `latitude`/`longitude` and
    // puts the ISO code in `country`. Reading it wrong loses every coordinate
    // silently, and the spread that makes the section worth reading can never
    // be computed.
    it('maps the canonical API shape onto the dossier keys', () => {
        const g = geoFromEvidence({
            country: 'DE', country_name: 'Germany', region: 'Berlin', city: 'Berlin',
            latitude: 52.52, longitude: 13.405,
        });
        assert.equal(g.country_code, 'DE');
        assert.equal(g.country, 'Germany');
        assert.equal(g.lat, 52.52);
        assert.equal(g.lon, 13.405);
    });

    it('drops a private-sounding answer rather than passing it through', () => {
        assert.equal(geoFromEvidence({ country: 'Private', city: 'private' }).country, null);
    });
});

describe('buildGeo', () => {
    it('reports the largest disagreement between any two sources', () => {
        const geo = buildGeo([
            source('a', { lat: 52.52, lon: 13.405 }),
            source('b', { lat: 48.137, lon: 11.575 }),
            source('c', { lat: 50.11, lon: 8.68 }),
        ]);
        assert.ok(geo.maxOffsetKm > 500, `expected a Berlin-Munich spread, got ${geo.maxOffsetKm}`);
        assert.equal(geo.consensus.agreement, 'diverging');
    });

    it('calls nearby sources agreeing', () => {
        const geo = buildGeo([
            source('a', { lat: 52.52, lon: 13.405 }),
            source('b', { lat: 52.53, lon: 13.41 }),
        ]);
        assert.ok(geo.maxOffsetKm <= 100);
        assert.equal(geo.consensus.agreement, 'agreeing');
    });

    // One geolocated source among several textual ones is not a disagreement;
    // it is a gap. Claiming "diverging" here would invent a conflict.
    it('does not call a missing second coordinate a disagreement', () => {
        const geo = buildGeo([
            source('a'),
            source('b', { lat: null, lon: null }),
            source('c', { lat: null, lon: null }),
        ]);
        assert.equal(geo.maxOffsetKm, null);
        assert.equal(geo.consensus.agreement, 'single-fix');
    });

    it('ignores failed and unavailable sources everywhere but the gap list', () => {
        const geo = buildGeo([
            source('a'),
            { id: 'b', failed: true },
            { id: 'c', unavailable: 'no-database' },
        ]);
        assert.deepEqual(geo.sources.map((s) => s.id), ['a']);
        assert.deepEqual(geo.unavailable, ['c']);
        assert.equal(geo.sourceCount, 1);
        assert.equal(geo.consensus.agreement, 'single-source');
    });

    it('takes the majority answer, not the first one', () => {
        const geo = buildGeo([
            source('a', { country: 'Poland', country_code: 'PL', city: 'Warsaw' }),
            source('b', { country: 'Germany', country_code: 'DE', city: 'Berlin' }),
            source('c', { country: 'Germany', country_code: 'DE', city: 'Berlin' }),
        ]);
        assert.equal(geo.consensus.country_code, 'DE');
        assert.equal(geo.consensus.city, 'Berlin');
    });

    it('survives having nothing at all', () => {
        const geo = buildGeo([]);
        assert.deepEqual(geo.sources, []);
        assert.equal(geo.maxOffsetKm, null);
        assert.equal(geo.consensus.country_code, null);
    });
});

describe('SLOTS', () => {
    const KNOWN = ['ready', 'partial', 'placeholder'];

    it('gives every section a status this build can honour', () => {
        for (const [name, slot] of Object.entries(SLOTS)) {
            assert.ok(KNOWN.includes(slot.status), `${name}: unknown status ${slot.status}`);
        }
    });

    // The point of declaring a gap: it has to say what would close it, or the
    // next contributor inherits a mystery instead of a task.
    it('explains every gap it declares', () => {
        for (const [name, slot] of Object.entries(SLOTS)) {
            if (slot.status === 'placeholder') {
                assert.ok(slot.needs && slot.needs.length > 10, `${name}: placeholder without a need`);
            }
            if (slot.status === 'partial') {
                assert.ok(Array.isArray(slot.missing) && slot.missing.length, `${name}: partial without missing rows`);
            }
        }
    });

    // A gap has to name the *class of source* that would close it, not the
    // capability it lacks: "not supported here" is a mystery handed to the next
    // contributor, while "a VPN exit directory" is a thing one can go and find.
    const GAP_SOURCE = {
        threat: /abuse-intelligence feed|IPAPIIS_API_KEY|ABUSEIPDB_API_KEY/,
        deepRisk: /anonymiser-list feed|TRUST_PROVIDERS/,
        vpnTrace: /VPN exit/,
        heat: /observation store/,
        relatedDomains: /reverse DNS/,
        locationHistory: /observation history/,
        neighbours: /observation/,
        companyHistory: /registration-history/,
        coLocated: /datacenter/,
    };

    it('names the class of source behind every declared gap', () => {
        for (const [name, slot] of Object.entries(SLOTS)) {
            if (!slot.needs) continue;
            assert.ok(GAP_SOURCE[name], `${name}: a gap was declared with no source pinned to it`);
            assert.match(slot.needs, GAP_SOURCE[name], `${name}: needs must name the source, not the absence`);
        }
    });

    // The page renders the pack's sentence and the response carries its own, so
    // the same gap is written down twice in two places. That pair drifted once —
    // `vpnTrace` asked the reader for routing visibility while the response
    // talked about a VPN exit directory — and nothing but this check notices.
    it('describes one gap the same way in the pack and in the response', () => {
        const en = JSON.parse(fs.readFileSync(new URL('../frontend/locales/en.json', import.meta.url), 'utf8'));
        const dig = (path) => path.split('.').reduce((o, key) => o?.[key], en);
        const pairs = [
            ['vpnTrace', 'dossier.slot.vpntraceNeeds', /vpn exit/i],
            ['companyHistory', 'dossier.slot.companyHistoryNeeds', /registration-history|rdap/i],
        ];
        for (const [slot, path, subject] of pairs) {
            assert.match(SLOTS[slot].needs, subject, `${slot}: the response stopped naming its source`);
            assert.match(dig(path) || '', subject, `${slot}: pack and response no longer describe one gap`);
        }
    });

    it('keeps the sections that carry real data honest about being partial', () => {
        assert.equal(SLOTS.topology.status, 'ready');
        assert.equal(SLOTS.topology.partial, true, 'topology has no path proportions and must say so');
        assert.ok(SLOTS.technical.partial.includes('openPorts'));
        // The block names this address's neighbours; whether any of them is in
        // use is a second question, and the slot has to keep them apart.
        assert.equal(SLOTS.neighbours.status, 'partial');
        assert.ok(SLOTS.neighbours.missing.includes('sameBlockActivity'));
    });

    // A gap row is named by a machine key on the server and translated on the
    // page, so a key without copy renders as its own path — a reader sees
    // `dossier.neighbours.gap.…` where the pack comparison sees nothing wrong.
    it('names every gap row with a key the reference pack carries', () => {
        const en = JSON.parse(fs.readFileSync(new URL('../frontend/locales/en.json', import.meta.url), 'utf8'));
        const gaps = en.dossier?.neighbours?.gap || {};
        for (const key of SLOTS.neighbours.missing) {
            assert.ok(gaps[key], `neighbours: no copy for gap "${key}"`);
        }
    });
});

// The neighbour list is arithmetic on the registered block, so what is worth
// pinning is where the arithmetic must stop: at the two ends of the block, and
// at the point where a block stops being a range at all.
describe('buildNeighbours', () => {
    const roles = (ip, cidr) => (buildNeighbours(ip, cidr)?.entries || []).map((e) => e.role);
    const ips = (ip, cidr) => (buildNeighbours(ip, cidr)?.entries || []).map((e) => e.ip);

    it('names the two neighbours and both edges of the block', () => {
        assert.deepEqual(roles('203.0.113.50', '203.0.113.0/24'), ['previous', 'next', 'blockFirst', 'blockLast']);
        assert.deepEqual(
            ips('203.0.113.50', '203.0.113.0/24'),
            ['203.0.113.49', '203.0.113.51', '203.0.113.0', '203.0.113.255'],
        );
    });

    // Stepping off either end would name an address somebody else holds, so the
    // walk stops at the edge — and the edge it stopped at is shown once, as an
    // edge, not a second time as a neighbour.
    it('never steps outside the block and never repeats an address', () => {
        assert.deepEqual(ips('203.0.113.0', '203.0.113.0/24'), ['203.0.113.1', '203.0.113.255']);
        assert.deepEqual(ips('203.0.113.1', '203.0.113.0/24'), ['203.0.113.2', '203.0.113.0', '203.0.113.255']);
        assert.deepEqual(ips('203.0.113.255', '203.0.113.0/24'), ['203.0.113.254', '203.0.113.0']);
        assert.deepEqual(roles('203.0.113.1', '203.0.113.0/24'), ['next', 'blockFirst', 'blockLast']);
    });

    it('keeps a block of one address an answer rather than a missing block', () => {
        const one = buildNeighbours('203.0.113.50', '203.0.113.50/32');
        assert.deepEqual(one.entries, []);
        assert.equal(one.cidr, '203.0.113.50/32');
    });

    it('says nothing when the registry named no block', () => {
        assert.equal(buildNeighbours('203.0.113.50', null), null);
        assert.equal(buildNeighbours('203.0.113.50', 'not-a-prefix'), null);
    });

    // A block that cannot contain the address is a bug upstream of here;
    // inventing neighbours from a range this address is not inside is worse.
    it('refuses a block of the other family', () => {
        assert.equal(buildNeighbours('203.0.113.50', '2001:db8::/32'), null);
    });

    it('writes IPv6 neighbours in the form the page already uses', () => {
        assert.deepEqual(ips('2001:db8:1234::5', '2001:db8:1200::/28'), [
            '2001:db8:1234::4',
            '2001:db8:1234::6',
            '2001:db0::',
            '2001:dbf:ffff:ffff:ffff:ffff:ffff:ffff',
        ]);
    });
});

// The open-ports row is the one place the dossier reports a third party's scan
// history, and the four ways it can come back read the same on screen if the
// mapping collapses them: an address nobody looked at is not an address with
// nothing open, and neither of those is a build that never asked.
describe('technicalSlot', () => {
    it('declares the gap this instance never claimed', () => {
        assert.equal(technicalSlot(null), SLOTS.technical);
        assert.deepEqual(technicalSlot(undefined).partial, ['openPorts']);
    });

    it('reports a record as measured', () => {
        assert.deepEqual(technicalSlot({ status: 'record', ports: [22] }), { status: 'ready' });
    });

    // Asked, answered, and the answer was "nobody has scanned this" — still a
    // measurement, so the row says what it found rather than the not-measured chip.
    it('keeps no-record apart from never-asked', () => {
        const slot = technicalSlot({ status: 'no-record' });
        assert.equal(slot.status, 'ready');
        assert.match(slot.note, /no observation/);
        assert.ok(slot.note !== undefined, 'a ready slot with no note reads as an empty scan');
    });

    it('names the failure of this lookup as a gap with a need', () => {
        const slot = technicalSlot({ status: 'failed' });
        assert.equal(slot.status, 'placeholder');
        assert.match(slot.needs, /did not answer/);
    });
});

// Which sentence a blocklist pass with nothing to score earns. The pass names
// its own reason — `common/dnsbl.js` owns that reading — and the dossier only
// turns the name into a gap line, so this table is where a wrong reading shows up.
describe('BLOCKLIST_GAP_REASONS', () => {
    it('has a reason for every gap the pass can report', () => {
        const reported = ['no-ipv6-zone', 'no-trustworthy-resolver', 'no-zones', 'unparseable', 'no-answer', 'policy-only'];
        for (const reason of reported) {
            assert.ok(BLOCKLIST_GAP_REASONS[reason], `no reason text for "${reason}"`);
        }
    });

    // The bug this pins: a policy-only pass falling through to `no-answer`, which
    // tells the reader nobody replied when every zone replied in fact — about the
    // block. Neither may it imply the whole list answered about the address.
    it('describes a policy-only pass as an answer about the range, not about nobody', () => {
        const text = BLOCKLIST_GAP_REASONS['policy-only'];
        assert.doesNotMatch(text, /none of the zones replied/i, 'policy-only borrowed the silent pass\'s words');
        assert.match(text, /polic/, 'policy-only stopped naming what it did hear');
        assert.match(text, /address itself/i, 'policy-only stopped saying what is still missing');
    });
});
