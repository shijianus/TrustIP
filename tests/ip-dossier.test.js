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
    BLOCKLIST_GAP_REASONS, blocklistSlot, neighboursSlot, rdapBlockOf, registeredBlockOf,
} from '../common/ip-dossier.js';
import { blocklistSummary, rirRecordFrom } from '../common/trust-signals.js';
import { blockContaining } from '../common/ip-math.js';

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

    // RIPE-family `inetnum` is a range, not a CIDR.
    it('reads a RIPE inetnum range as the block', () => {
        const n = buildNeighbours('193.0.6.139', '193.0.0.0 - 193.0.7.255');
        assert.equal(n.cidr, '193.0.0.0 - 193.0.7.255');
        assert.deepEqual(n.entries.map((e) => e.ip), ['193.0.6.138', '193.0.6.140', '193.0.0.0', '193.0.7.255']);
    });

    // ARIN lists several CIDRs; the one holding the address is the block.
    it('picks the CIDR of an ARIN list that contains the address', () => {
        const n = buildNeighbours('104.26.10.5', '104.16.0.0/13, 104.24.0.0/14');
        assert.equal(n.cidr, '104.24.0.0/14');
        assert.deepEqual(n.entries.map((e) => e.ip), ['104.26.10.4', '104.26.10.6', '104.24.0.0', '104.27.255.255']);
        assert.equal(buildNeighbours('104.17.0.1', '104.16.0.0/13, 104.24.0.0/14').cidr, '104.16.0.0/13');
    });

    // A block the address is not inside is somebody else's block.
    it('refuses a block that does not contain the address', () => {
        assert.equal(buildNeighbours('8.8.8.8', '1.1.1.0/24'), null);
        assert.equal(buildNeighbours('8.8.8.8', '1.0.0.0 - 1.255.255.255'), null);
        assert.equal(buildNeighbours('8.8.8.8', '1.1.1.0/24, 9.9.9.0/24'), null);
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

// A pass that heard only range policy keeps its rows for the panel, but scores
// as nothing answered: the slot is a gap named `policy-only`, and the summary the
// scorer reads has `answered: 0`.
describe('a policy-only blocklist pass in the dossier', () => {
    const policyPass = {
        ip: '198.51.100.9',
        supported: true,
        resolver: '8.8.8.8',
        reason: 'policy-only',
        results: [
            { id: 'zen', label: 'ZEN', status: 'policy', listed: false, codes: [{ address: '127.0.0.10', kind: 'policy', meaning: 'pbl' }] },
            { id: 'other', label: 'Other', status: 'query-refused', listed: false, codes: [] },
        ],
        tally: { zones: 2, answered: 0, listed: 0, botnet: 0, policy: 1 },
    };

    it('keeps the policy rows instead of dropping the pass', () => {
        const summary = blocklistSummary(policyPass);
        assert.equal(summary.answered, 0);
        assert.equal(summary.policy, 1);
        assert.equal(summary.resolver, '8.8.8.8');
        assert.equal(summary.results[0].codes[0].address, '127.0.0.10');
        assert.deepEqual(summary.labels, []);
    });

    it('still drops a pass that heard nothing at all', () => {
        assert.equal(blocklistSummary({ ...policyPass, tally: { ...policyPass.tally, policy: 0 } }), null);
        assert.equal(blocklistSummary(null), null);
    });

    it('declares the slot a gap with the policy-only key, not a ready section', () => {
        const slot = blocklistSlot({ blocklists: blocklistSummary(policyPass), blocklistsReason: 'policy-only' });
        assert.equal(slot.status, 'placeholder');
        assert.equal(slot.gapKey, 'policy-only');
        assert.equal(slot.needs, BLOCKLIST_GAP_REASONS['policy-only']);
    });

    it('reports a scoreable pass as ready with its count and recursor', () => {
        const slot = blocklistSlot({ blocklists: { zones: 4, answered: 3, resolver: '1.1.1.1' } });
        assert.deepEqual(slot, { status: 'ready', note: '3 of 4 zones answered through 1.1.1.1' });
    });
});

describe('blockContaining', () => {
    it('reads each registry shape and labels the part it used', () => {
        assert.deepEqual(blockContaining('8.8.8.8', '8.8.8.0/24'), { family: 4, start: 134744064n, end: 134744319n, label: '8.8.8.0/24' });
        assert.equal(blockContaining('2001:67c:2e8::2', '2001:67c:2e8::/48').label, '2001:67c:2e8::/48');
        assert.equal(blockContaining('193.0.0.1', '193.0.0.0-193.0.7.255').label, '193.0.0.0-193.0.7.255');
    });

    it('answers null for a reversed range, junk, and another family', () => {
        assert.equal(blockContaining('193.0.0.1', '193.0.7.255 - 193.0.0.0'), null);
        assert.equal(blockContaining('193.0.0.1', 'not a block'), null);
        assert.equal(blockContaining('193.0.0.1', '2001:db8::/32'), null);
        assert.equal(blockContaining('193.0.0.1', null), null);
    });
});

// The RIR record is the source of `network.cidr`; RIPE-family IPv6 objects are
// `inet6num`, and reading only `inetnum` left every one of them blockless.
describe('rirRecordFrom', () => {
    const rows = (pairs) => ({ records: [pairs.map(([key, value]) => ({ key, value }))] });

    it('reads a RIPE inet6num as the block', () => {
        const rec = rirRecordFrom(rows([['inet6num', '2001:67c:2e8::/48'], ['netname', 'RIPE-NCC'], ['country', 'NL']]));
        assert.equal(rec.cidr, '2001:67c:2e8::/48');
        assert.equal(rec.netName, 'RIPE-NCC');
    });

    it('keeps ARIN CIDR and RIPE inetnum as they were', () => {
        assert.equal(rirRecordFrom(rows([['CIDR', '104.16.0.0/13, 104.24.0.0/14']])).cidr, '104.16.0.0/13, 104.24.0.0/14');
        assert.equal(rirRecordFrom(rows([['inetnum', '193.0.0.0 - 193.0.7.255']])).cidr, '193.0.0.0 - 193.0.7.255');
    });

    it('feeds the neighbours an IPv6 block end to end', () => {
        const rec = rirRecordFrom(rows([['inet6num', '2001:67c:2e8::/48']]));
        const n = buildNeighbours('2001:67c:2e8:22::c100:68b', rec.cidr);
        assert.equal(n.cidr, '2001:67c:2e8::/48');
        assert.deepEqual(n.entries.map((e) => e.ip), [
            '2001:67c:2e8:22::c100:68a',
            '2001:67c:2e8:22::c100:68c',
            '2001:67c:2e8::',
            '2001:67c:2e8:ffff:ffff:ffff:ffff:ffff',
        ]);
    });
});

// With no block holding the address the section has no real half, so the slot
// must not say `partial` beside a null neighbours value.
describe('neighboursSlot', () => {
    it('is the declared partial section when a block was found', () => {
        assert.equal(neighboursSlot({ cidr: '8.8.8.0/24', entries: [] }), SLOTS.neighbours);
        assert.equal(neighboursSlot({ cidr: '8.8.8.0/24', entries: [] }).status, 'partial');
    });

    it('is a placeholder naming the missing block when there is none', () => {
        const slot = neighboursSlot(null);
        assert.equal(slot.status, 'placeholder');
        assert.deepEqual(slot.missing, []);
        assert.match(slot.needs, /registered block that contains this address/);
    });
});

describe('rdapBlockOf', () => {
    it('reads the cidr0 prefixes, else the start - end range', () => {
        assert.equal(rdapBlockOf({ cidr0_cidrs: [{ v6prefix: '2606:4700::', length: 32 }] }), '2606:4700::/32');
        assert.equal(rdapBlockOf({ cidr0_cidrs: [{ v4prefix: '104.16.0.0', length: 13 }, { v4prefix: '104.24.0.0', length: 14 }] }),
            '104.16.0.0/13, 104.24.0.0/14');
        assert.equal(rdapBlockOf({ startAddress: '2606:4700::', endAddress: '2606:4700:ffff:ffff:ffff:ffff:ffff:ffff' }),
            '2606:4700:: - 2606:4700:ffff:ffff:ffff:ffff:ffff:ffff');
        assert.equal(rdapBlockOf({}), null);
        assert.equal(rdapBlockOf(null), null);
    });
});

describe('registeredBlockOf', () => {
    const arinV6 = async () => ({ cidr0_cidrs: [{ v6prefix: '2606:4700::', length: 32 }] });

    it('keeps the RIR record\'s block when it contains the address, without asking RDAP', async () => {
        let asked = false;
        const block = await registeredBlockOf('8.8.8.8', '8.8.8.0/24', { lookup: async () => { asked = true; return {}; } });
        assert.equal(block, '8.8.8.0/24');
        assert.equal(asked, false);
    });

    it('asks RDAP when the RIR record named no block (ARIN IPv6), and neighbours follow', async () => {
        const block = await registeredBlockOf('2606:4700:4700::1111', null, { lookup: arinV6 });
        assert.equal(block, '2606:4700::/32');
        const neighbours = buildNeighbours('2606:4700:4700::1111', block);
        assert.equal(neighbours.cidr, '2606:4700::/32');
        assert.ok(neighbours.entries.length > 0);
    });

    it('ignores an RDAP block that does not contain the address, and a failed lookup', async () => {
        assert.equal(await registeredBlockOf('2606:4700:4700::1111', null, { lookup: async () => ({ cidr0_cidrs: [{ v6prefix: '2001:db8::', length: 32 }] }) }), null);
        assert.equal(await registeredBlockOf('2606:4700:4700::1111', null, { lookup: async () => { throw new Error('timeout'); } }), null);
    });
});
