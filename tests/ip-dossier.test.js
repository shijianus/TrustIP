// The dossier's pure pieces: how several geolocation answers collapse into a
// consensus and a spread, and the contract every section declares for itself.
//
// The network calls are not covered here — they are I/O, and their shapes are
// these functions' inputs.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildGeo, haversineKm, geoFromEvidence, SLOTS } from '../common/ip-dossier.js';

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

    it('keeps the sections that carry real data honest about being partial', () => {
        assert.equal(SLOTS.topology.status, 'ready');
        assert.equal(SLOTS.topology.partial, true, 'topology has no path proportions and must say so');
        assert.ok(SLOTS.technical.partial.includes('openPorts'));
    });
});
