// Data-integrity gate for common/dnsbl-zones.js — the file an operator edits to
// change what the blocklist signal asks. A malformed entry would otherwise only
// show up as a silently wrong accusation on the live /api/dnsbl endpoint, which
// is the worst place to discover that.
//
// The last rule is a policy pin, not a shape check: the header of the data file
// records why Spamhaus is deliberately absent. Someone re-adding it must be
// told, not left to find a permanently "unmeasured" signal.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DNSBL_ZONES, DIAGNOSTICS } from '../common/dnsbl-zones.js';

const CATEGORIES = ['Spam', 'Botnet', 'Reputation', 'Phishing'];
// A blocklist zone is a public second-level name or deeper: `bl.spamcop.net`.
const ZONE_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/;

describe('DNSBL_ZONES data integrity', () => {
    it('is a non-empty array', () => {
        assert.ok(Array.isArray(DNSBL_ZONES));
        assert.ok(DNSBL_ZONES.length > 0);
    });

    it('ids are unique lowercase slugs', () => {
        const ids = DNSBL_ZONES.map((z) => z.id);
        assert.equal(new Set(ids).size, ids.length, 'duplicate id');
        for (const id of ids) {
            assert.match(id, /^[a-z0-9-]+$/, `id "${id}" must be a lowercase slug`);
        }
    });

    it('zones are unique well-formed public hostnames', () => {
        const zones = DNSBL_ZONES.map((z) => z.zone);
        assert.equal(new Set(zones).size, zones.length, 'duplicate zone');
        for (const zone of zones) {
            assert.match(zone, ZONE_SHAPE, `zone "${zone}" is not a queryable public name`);
            assert.ok(!zone.startsWith('.') && !zone.endsWith('.'), `zone "${zone}" has stray dots`);
        }
    });

    it('labels and categories are present, categories from the known set', () => {
        for (const z of DNSBL_ZONES) {
            assert.ok(typeof z.label === 'string' && z.label.trim(), `${z.id}: missing label`);
            assert.ok(CATEGORIES.includes(z.category), `${z.id}: category "${z.category}" is unknown`);
        }
    });

    // The scorer's extra botnet charge keys off this exact word, so a category
    // renamed to `Malware` would quietly stop charging for it.
    it('names exactly one zone per category as the heavier case', () => {
        assert.ok(DNSBL_ZONES.some((z) => z.category === 'Botnet'), 'no Botnet zone to charge extra for');
    });

    it('declares every listing code as an answer inside the blocklist range', () => {
        for (const z of DNSBL_ZONES) {
            const listings = z.listings || {};
            assert.ok(Object.keys(listings).length, `${z.id}: no listing codes documented`);
            for (const [code, meaning] of Object.entries(listings)) {
                assert.match(code, /^127\./, `${z.id}: listing code "${code}" is outside 127.0.0.0/8`);
                assert.ok(!DIAGNOSTICS[code], `${z.id}: "${code}" is both a listing and a diagnostic`);
                assert.ok(typeof meaning === 'string' && meaning, `${z.id}: ${code} has no meaning`);
            }
        }
    });

    // A policy code accuses the range, so the same code accusing the address
    // would make `common/dnsbl.js`'s fourth state mean two things at once — and
    // an operator adding a multi-list zone is exactly how that happens.
    it('declares policy codes as range answers that no listing also claims', () => {
        for (const z of DNSBL_ZONES) {
            if (z.policy === undefined) continue;
            assert.ok(Object.keys(z.policy).length, `${z.id}: an empty policy map says nothing about the zone`);
            for (const [code, meaning] of Object.entries(z.policy)) {
                assert.match(code, /^127\./, `${z.id}: policy code "${code}" is outside 127.0.0.0/8`);
                assert.ok(!DIAGNOSTICS[code], `${z.id}: "${code}" is both a policy code and a diagnostic`);
                assert.ok(!(z.listings || {})[code], `${z.id}: "${code}" is declared as both a listing and a policy`);
                assert.ok(typeof meaning === 'string' && meaning, `${z.id}: policy code ${code} has no meaning`);
            }
        }
    });

    it('declares IPv6 support only as a plain yes', () => {
        for (const z of DNSBL_ZONES) {
            if (z.v6 === undefined) continue;
            assert.equal(z.v6, true, `${z.id}: v6 must be true or absent, never a maybe`);
        }
    });

    it('does not re-add a zone the data file documents as excluded', () => {
        for (const z of DNSBL_ZONES) {
            assert.ok(!z.zone.endsWith('spamhaus.org'),
                `${z.id}: Spamhaus refuses queries relayed by open resolvers — see the header of common/dnsbl-zones.js`);
        }
    });
});

describe('DIAGNOSTICS', () => {
    it('covers the query-refusal family inside 127.255.255.0/24', () => {
        for (const code of Object.keys(DIAGNOSTICS)) {
            assert.match(code, /^127\.255\.255\.\d+$/, `"${code}" is not a diagnostic address`);
        }
        assert.ok(DIAGNOSTICS['127.255.255.254'], 'the open-resolver refusal must be recognised');
    });

    it('never leaves a diagnostic unexplained', () => {
        for (const [code, meaning] of Object.entries(DIAGNOSTICS)) {
            assert.ok(typeof meaning === 'string' && meaning.length > 2, `${code}: no meaning`);
        }
    });
});
