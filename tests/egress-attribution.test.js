// The contract for "which address is the visitor, and which ones are the leaks".
//
// Two rulers disagree on a real network all the time, and the whole point of the
// homepage's top block is that they must not be merged into one number: the address
// forty sites happened to see can be a rented proxy while the address two sites saw is
// the machine under the desk. These literals are the specification for that call —
// the China split-tunnel case, the full-tunnel case where there is nothing to report,
// and the dual-stack case where the second family never echoed at all.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { collectEgress, classifyEgress } from '../frontend/utils/egress-attribution.js';

const CN_V4 = '58.246.11.22';
const US_V4 = '104.16.51.11';
const US_V6 = '2606:4700::6810:330b';

// A mainland machine whose traffic mostly goes out overseas: the proxy exit answers
// 41 destinations, the direct one 7, and a STUN server repeats the mainland address
// back regardless of where the traffic goes.
const splitTunnel = {
    ownExits: [US_V4],
    leaks: [{ ip: CN_V4, country_code: 'CN', org: 'AS4134 CHINA169 Backbone' }],
    rows: [
        ...Array.from({ length: 41 }, (_, i) => ({ host: `proxy${i}.com`, name: `Proxy ${i}`, ip: US_V4, loc: 'US', state: 'ok', ms: 40, reachable: true })),
        ...Array.from({ length: 7 }, (_, i) => ({ host: `direct${i}.cn`, name: `Direct ${i}`, ip: CN_V4, loc: 'CN', state: 'ok', ms: 12, reachable: true })),
        { host: 'silent.example', name: 'Silent', ip: null, state: 'ok', measured: 'latency', ms: 300, reachable: true },
    ],
};

describe('classifyEgress — the primary address', () => {
    it('takes the leaked address as the visitor over the busier proxy exit', () => {
        const result = classifyEgress(splitTunnel);
        assert.equal(result.primary.ip, CN_V4);
        assert.equal(result.primary.basis, 'webrtc');
        assert.equal(result.primary.country_code, 'CN');
        // …and keeps the road where the traffic actually goes, as its own answer.
        assert.equal(result.defaultEgress.ip, US_V4);
        assert.equal(result.defaultEgress.seenBy, 41);
        assert.equal(result.conflict, true, 'two rulers, two addresses, said out loud');
    });

    it('counts the sites reached from the address the visitor actually is', () => {
        assert.equal(classifyEgress(splitTunnel).primary.seenBy, 7);
    });

    it('falls back to the busiest route when nothing leaked', () => {
        const { primary, defaultEgress, conflict } = classifyEgress({
            ownExits: [US_V4, CN_V4],
            leaks: [],
            rows: [
                { host: 'a.com', ip: US_V4, loc: 'US', state: 'ok' },
                { host: 'b.com', ip: CN_V4, loc: 'CN', state: 'ok' },
                { host: 'c.com', ip: US_V4, loc: 'US', state: 'ok' },
            ],
        });
        assert.equal(primary.basis, 'volume');
        assert.equal(primary.ip, US_V4);
        assert.equal(primary.seenBy, 2);
        assert.equal(defaultEgress.ip, US_V4);
        assert.equal(conflict, false, 'one ruler answered, so there is nothing to disagree about');
    });

    it('names the visitor\'s own IPv4 when nothing echoed at all', () => {
        // Every destination refused, blocked, or would not report an address. The
        // honest answer is still which address this is about — and it is IPv4 first,
        // because that is the family a split is usually about.
        const { primary, defaultEgress, conflict } = classifyEgress({
            ownExits: [US_V6, US_V4],
            leaks: [],
            rows: [{ host: 'x.com', ip: null, state: 'ok', measured: 'latency', reachable: false }],
        });
        assert.equal(primary.basis, 'source');
        assert.equal(primary.ip, US_V4);
        assert.equal(primary.seenBy, 0);
        assert.equal(defaultEgress, null);
        assert.equal(conflict, false);
    });

    it('reads a full tunnel as one address and reports no split', () => {
        // STUN went through the proxy too, so the leak and the exit are the same
        // string. A page that still showed a two-address story here would be
        // inventing a leak.
        const { primary, others, conflict, foreignRouted } = classifyEgress({
            ownExits: [US_V4],
            leaks: [{ ip: US_V4, country_code: 'US', org: 'AS-prox' }],
            rows: [
                { host: 'a.com', name: 'A', ip: US_V4, loc: 'US', state: 'ok' },
                { host: 'b.com', name: 'B', ip: US_V4, loc: 'US', state: 'ok' },
            ],
        });
        assert.equal(primary.basis, 'webrtc');
        assert.deepEqual(others, []);
        assert.deepEqual(foreignRouted, []);
        assert.equal(conflict, false);
    });

    it('refuses an address that cannot be anyone\'s public exit', () => {
        // A LAN candidate from a `host` line, a loopback from a misconfigured
        // proxy — none of them can name a place, so none of them belong on a page
        // about egress addresses.
        const { entries, primary } = classifyEgress({
            ownExits: ['192.168.1.10', '127.0.0.1'],
            leaks: [{ ip: '10.0.0.5', country_code: 'CN' }],
            rows: [{ host: 'a.com', ip: '::1', state: 'ok' }],
        });
        assert.deepEqual(entries, []);
        assert.equal(primary, null);
    });
});

describe('classifyEgress — the other addresses', () => {
    it('leads with the address the fewest destinations would use', () => {
        // The finding is the minority route: forty sites on one address is a road,
        // two sites on another is something leaking through.
        const { others } = classifyEgress({
            ownExits: [],
            leaks: [],
            rows: [
                { host: 'a', ip: US_V4, state: 'ok' },
                { host: 'b', ip: US_V4, state: 'ok' },
                { host: 'c', ip: US_V4, state: 'ok' },
                { host: 'd', ip: CN_V4, state: 'ok' },
                { host: 'e', ip: '119.28.44.1', state: 'ok' },
                { host: 'f', ip: '119.28.44.1', state: 'ok' },
            ],
        });
        assert.deepEqual(others.map((e) => [e.ip, e.seenBy]), [[CN_V4, 1], ['119.28.44.1', 2]]);
    });

    it('keeps an address no destination ever echoed, because the sources saw it', () => {
        // The dual-stack case: Cloudflare answers these rows over IPv4, so a table
        // built only from echoes would conclude one exit for a network with two.
        const { entries, others } = classifyEgress({
            ownExits: [US_V4, US_V6],
            leaks: [],
            rows: [{ host: 'a', ip: US_V4, state: 'ok' }],
        });
        assert.equal(entries.length, 2);
        assert.deepEqual(others.map((e) => e.ip), [US_V6]);
        assert.equal(others[0].seenBy, 0);
    });

    it('lists every site reached from an address that is not the primary', () => {
        const { foreignRouted } = classifyEgress(splitTunnel);
        assert.equal(foreignRouted.length, 41);
        assert.equal(foreignRouted[0].ip, US_V4);
        assert.equal(foreignRouted[0].country_code, 'US');
        // The row that named no address is about the destination, not the routing.
        assert.ok(!foreignRouted.some((r) => r.host === 'silent.example'));
    });

    it('counts the rows that answered without naming an address', () => {
        const result = classifyEgress(splitTunnel);
        assert.equal(result.unattributed, 1);
        // The denominator the page reads its counts against: 48 destinations named
        // somebody, and the 49th answered a timed request without saying whose
        // address it saw. "18 of 48" beside "1 of 48" would leave 29 unaccounted.
        assert.equal(result.attributed, 48);
        assert.equal(result.entries.reduce((n, e) => n + e.seenBy, 0), result.attributed);
    });
});

describe('collectEgress — one record per address', () => {
    it('merges a leak with the rows that saw the same address', () => {
        const rows = [{ host: 'a', ip: CN_V4, loc: 'US', state: 'ok' }];
        const [only] = collectEgress({
            ownExits: [CN_V4],
            leaks: [{ ip: CN_V4, country_code: 'CN', org: 'AS4134' }],
            rows,
        });
        assert.equal(only.seenBy, 1);
        assert.equal(only.leak, true);
        assert.equal(only.ownExit, true);
        // The leak's answer wins over the echo's: one address, one country, and the
        // registry lookup is the one that names the organisation too.
        assert.equal(only.country_code, 'CN');
        assert.equal(only.org, 'AS4134');
    });

    it('keeps the fastest round trip per address', () => {
        const [only] = collectEgress({
            rows: [{ host: 'a', ip: US_V4, ms: 90 }, { host: 'b', ip: US_V4, ms: 31 }],
        });
        assert.equal(only.ms, 31);
    });

    it('takes the echo country when nothing else has named the address', () => {
        const [only] = collectEgress({ rows: [{ host: 'a', ip: US_V4, loc: 'us', state: 'ok' }] });
        assert.equal(only.country_code, '', 'a lowercase echo is not a valid alpha-2');
        const [upper] = collectEgress({ rows: [{ host: 'a', ip: US_V4, loc: 'US', state: 'ok' }] });
        assert.equal(upper.country_code, 'US');
    });

    it('sorts IPv4 ahead of IPv6 so the page has one address first', () => {
        const entries = collectEgress({ ownExits: [US_V6, US_V4] });
        assert.equal(entries[0].ip, US_V4);
        assert.equal(entries[1].ip, US_V6);
    });

    it('answers an empty table without inventing a primary', () => {
        assert.deepEqual(collectEgress({}), []);
        const { primary, entries } = classifyEgress({});
        assert.equal(primary, null);
        assert.deepEqual(entries, []);
    });
});
