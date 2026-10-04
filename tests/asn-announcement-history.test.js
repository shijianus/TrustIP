// Tests for the shared RIPEstat announcement rules the ASN-history route and
// the IP dossier both read.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    MIN_PEERS,
    summarizeOrigin,
    rankOrigins,
    attachOrgNames,
    buildAsnHistoryBlock,
} from '../common/asn-announcement-history.js';

// A timeline the way RIPEstat answers: one origin, one prefix, one span.
const entry = (origin, prefix, starttime, endtime, peers) => ({
    origin,
    prefixes: [{ prefix, timelines: [{ starttime, endtime, full_peers_seeing: peers }] }],
});

describe('asn-announcement-history — summarizeOrigin', () => {
    test('collapses several timelines into one span and keeps the peak peer count', () => {
        const row = summarizeOrigin({
            origin: 24940,
            prefixes: [{
                prefix: '65.21.201.0/24',
                timelines: [
                    { starttime: '2021-01-01T00:00:00Z', endtime: '2022-01-01T00:00:00Z', full_peers_seeing: 120 },
                    { starttime: '2020-06-01T00:00:00Z', endtime: '2024-03-03T00:00:00Z', full_peers_seeing: 379 },
                ],
            }],
        }, 24);
        assert.equal(row.firstSeen, '2020-06-01T00:00:00Z');
        assert.equal(row.lastSeen, '2024-03-03T00:00:00Z');
        assert.equal(row.peers, 379);
    });

    test('rejects an origin that only ever announced a shorter prefix', () => {
        // A /8 covering the queried block is not a claim on the block itself.
        assert.equal(summarizeOrigin(entry(3356, '65.0.0.0/8', '2020-01-01', '2021-01-01', 400), 24), null);
    });

    test('rejects an announcement too few routers saw', () => {
        assert.equal(summarizeOrigin(entry(64496, '65.21.201.0/24', '2020-01-01', '2020-02-01', MIN_PEERS - 1), 24), null);
        assert.ok(summarizeOrigin(entry(64496, '65.21.201.0/24', '2020-01-01', '2020-02-01', MIN_PEERS), 24));
    });

    test('rejects a prefix with no timelines rather than throwing', () => {
        assert.equal(summarizeOrigin({ origin: 1, prefixes: [{ prefix: '1.2.3.0/24', timelines: [] }] }, 24), null);
        assert.equal(summarizeOrigin({ origin: 1, prefixes: [] }, 24), null);
        assert.equal(summarizeOrigin({ origin: 1 }, 24), null);
    });

    test('rounds the fractional peer count RIPEstat reports', () => {
        const row = summarizeOrigin(entry(24940, '65.21.201.0/24', 'a', 'b', 379.36), 24);
        assert.equal(row.peers, 379);
    });
});

describe('asn-announcement-history — rankOrigins', () => {
    const payload = [
        entry(24940, '65.21.201.0/24', '2020-12-28', '2026-10-03', 380),
        entry(32858, '65.21.201.0/24', '2008-11-13', '2008-11-24', 85),
        entry(3356, '65.0.0.0/8', '2001-01-01', '2025-01-01', 400),
    ];

    test('keeps only the family’s BGP floor and orders newest first', () => {
        const rows = rankOrigins(payload, 'v4');
        // The /8 survives here: the route answers "who has carried this space",
        // aggregates included, and the dossier filters them for its own list.
        assert.deepEqual(rows.map((r) => Number(r.asn)), [24940, 3356, 32858]);
    });

    test('normalizes visibility against the most-propagated row, not the internet', () => {
        const rows = rankOrigins(payload, 'v4');
        assert.equal(rows[0].peersPct, 95); // 380 of the 400 peers that saw the /8
        assert.equal(rows.find((r) => r.asn === '32858').peersPct, 21);
    });

    test('survives a missing or malformed payload', () => {
        assert.deepEqual(rankOrigins(undefined, 'v4'), []);
        assert.deepEqual(rankOrigins([], 'v6'), []);
    });

    test('uses the IPv6 floor, where a /16 aggregate is sub-BGP noise', () => {
        const v6 = [{
            origin: 20001,
            prefixes: [
                { prefix: '2001:db8::/16', timelines: [{ starttime: 'a', endtime: 'b', full_peers_seeing: 40 }] },
                { prefix: '2001:db8::/48', timelines: [{ starttime: 'a', endtime: 'b', full_peers_seeing: 40 }] },
            ],
        }];
        const rows = rankOrigins(v6, 'v6');
        assert.deepEqual(rows[0].prefixes, ['2001:db8::/48']);
    });
});

describe('asn-announcement-history — attachOrgNames', () => {
    test('fills every row from one lookup per distinct ASN', async () => {
        const asked = [];
        const rows = [{ asn: '1' }, { asn: '2' }, { asn: '1' }];
        await attachOrgNames(rows, (asn) => { asked.push(asn); return `Org ${asn}`; });
        assert.deepEqual(asked, ['1', '2']);
        assert.deepEqual(rows.map((r) => r.org), ['Org 1', 'Org 2', 'Org 1']);
    });

    test('leaves rows untouched and reports once when the resolver throws', async () => {
        let reported = 0;
        // Rows arrive from summarizeOrigin with `org: null` already in place.
        const rows = [{ asn: '1', org: null }];
        await attachOrgNames(rows, () => { throw new Error('upstream down'); }, { onError: () => { reported++; } });
        assert.equal(rows[0].org, null);
        assert.equal(reported, 1);
    });
});

// RIPEstat answers with the aggregates a network advertised, never the /24
// inside them — Hetzner announces 65.21.0.0/16 and has no record for
// 65.21.201.0/24. These are the two behaviours that depend on that fact.
describe('asn-announcement-history — buildAsnHistoryBlock', () => {
    const realFetch = globalThis.fetch;
    const stubFetch = (byOrigin) => {
        globalThis.fetch = async () => new Response(JSON.stringify({ data: { by_origin: byOrigin } }), {
            status: 200, headers: { 'Content-Type': 'application/json' },
        });
    };

    test('resolves immediately with no prefix rather than calling upstream', async () => {
        globalThis.fetch = () => { throw new Error('must not be reached'); };
        assert.deepEqual(await buildAsnHistoryBlock(null), {
            prefix: null, entries: [], failed: true, source: 'RIPEstat routing-history',
        });
    });

    test('keeps aggregate announcements and puts the closest one first', async () => {
        stubFetch([
            entry(3356, '65.0.0.0/8', '2001-01-01T00:00:00', '2025-01-01T00:00:00', 400),
            entry(24940, '65.21.0.0/16', '2020-12-28T00:00:00', '2026-10-03T00:00:00', 380),
        ]);
        const block = await buildAsnHistoryBlock('65.21.201.0/24');
        assert.equal(block.failed, undefined);
        assert.deepEqual(block.entries.map((e) => Number(e.asn)), [24940, 3356]);
        assert.equal(block.entries[0].prefix, '65.21.0.0/16');
        assert.equal(block.prefix, '65.21.201.0/24');
    });

    test('breaks a specificity tie by recency', async () => {
        stubFetch([
            entry(1111, '65.21.0.0/16', '2001-01-01T00:00:00', '2005-01-01T00:00:00', 380),
            entry(24940, '65.21.0.0/16', '2020-12-28T00:00:00', '2026-10-03T00:00:00', 380),
        ]);
        const block = await buildAsnHistoryBlock('65.21.201.0/24');
        assert.deepEqual(block.entries.map((e) => Number(e.asn)), [24940, 1111]);
    });

    test('degrades to an empty failed block when the upstream answers badly', async () => {
        globalThis.fetch = async () => new Response('nope', { status: 500 });
        const block = await buildAsnHistoryBlock('65.21.201.0/24');
        assert.equal(block.failed, true);
        assert.deepEqual(block.entries, []);
    });

    test('swallows a timeout so the other eleven sections still land', async () => {
        globalThis.fetch = async () => { throw new Error('abort'); };
        const block = await buildAsnHistoryBlock('65.21.201.0/24');
        assert.equal(block.failed, true);
    });

    test('caps the list and says it was capped', async () => {
        stubFetch(Array.from({ length: 12 }, (_, i) => entry(1000 + i, '65.21.201.0/24', '2000-01-01', `202${i % 10}-01-01`, 40 + i)));
        const block = await buildAsnHistoryBlock('65.21.201.0/24', { cap: 4 });
        assert.equal(block.entries.length, 4);
        assert.equal(block.truncated, true);
    });

    test.afterEach(() => { globalThis.fetch = realFetch; });
});
