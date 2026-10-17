// Tests for common/peeringdb-api.js — the PeeringDB public-API fallback used
// when the local index is absent — plus its wiring into /api/asn-profile and
// the dossier's ASN block. fetch is injected: no network.

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import {
    recordFromApi, fetchPeeringdbNet, resolvePeeringdbNet, resetPeeringdbApiCache, PEERINGDB_API_BASE,
} from '../common/peeringdb-api.js';
import { peeringdbReadiness, peeringdbLookup } from '../api/asn-profile.js';
import { buildSectionLoaders, composeAsnProfile } from '../common/asn-profile.js';
import { peeringdbSummary, asnSlot, SLOTS } from '../common/ip-dossier.js';

const savedKey = process.env.PEERINGDB_API_KEY;
afterEach(() => {
    resetPeeringdbApiCache();
    if (savedKey === undefined) delete process.env.PEERINGDB_API_KEY;
    else process.env.PEERINGDB_API_KEY = savedKey;
});

// The depth=2 answer's shape, trimmed (real field names from www.peeringdb.com/api/net?asn=13335&depth=2).
const NET = {
    id: 4224, asn: 13335, name: 'Cloudflare', website: 'https://www.cloudflare.com',
    info_types: ['Content'], info_traffic: '', info_ratio: 'Mostly Outbound', info_scope: 'Global',
    policy_general: 'Open', irr_as_set: 'AS13335:AS-CLOUDFLARE', status: 'ok',
    poc_set: [{ email: 'noc@example.net' }],
    netixlan_set: [
        { ix_id: 255, name: 'Equinix Paris', speed: 100000, is_rs_peer: false, operational: true, status: 'ok' },
        { ix_id: 255, name: 'Equinix Paris', speed: 100000, is_rs_peer: true, operational: true, status: 'ok' },
        { ix_id: 9, name: 'Gone IX', speed: 10000, operational: false, status: 'ok' },
    ],
    netfac_set: [{ fac_id: 1, name: 'Equinix DC1', city: 'Ashburn', country: 'US', status: 'ok' }],
};

const response = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers });

describe('recordFromApi', () => {
    it('projects the API answer through the index builder: same fields as the local index', () => {
        const record = recordFromApi(NET);
        assert.deepEqual(record.types, ['Content']);
        assert.equal(record.traffic, null, 'an empty traffic band is not reported');
        assert.equal(record.scope, 'Global');
        assert.equal(record.ratio, 'Mostly Outbound');
        assert.equal(record.policy, 'Open');
        assert.equal(record.irrAsSet, 'AS13335:AS-CLOUDFLARE');
        assert.deepEqual(record.ixs, [{ name: 'Equinix Paris', city: null, country: null, speed: 200000, rsPeer: true }]);
        assert.deepEqual(record.facilities, [{ name: 'Equinix DC1', city: 'Ashburn', country: 'US' }]);
        assert.equal(JSON.stringify(record).includes('@'), false, 'contact data never read');
    });

    it('is null for no row, a row without an ASN, or a row with nothing to keep', () => {
        assert.equal(recordFromApi(null), null);
        assert.equal(recordFromApi({ id: 1 }), null);
        assert.equal(recordFromApi({ id: 1, asn: 64500, info_types: [], status: 'ok' }), null);
    });
});

describe('fetchPeeringdbNet', () => {
    it('asks depth=2 by ASN, anonymously unless PEERINGDB_API_KEY is set, and caches the record', async () => {
        delete process.env.PEERINGDB_API_KEY;
        const seen = [];
        const fetchImpl = async (url, init) => { seen.push({ url, init }); return response(200, { data: [NET] }); };
        const first = await fetchPeeringdbNet(13335, { fetchImpl });
        assert.equal(first.status, 'record');
        assert.equal(first.source, 'peeringdb-api');
        assert.equal(seen[0].url, `${PEERINGDB_API_BASE}?asn=13335&depth=2`);
        assert.equal(seen[0].init.headers, undefined);
        await fetchPeeringdbNet(13335, { fetchImpl });
        assert.equal(seen.length, 1, 'second lookup is served from the cache');

        process.env.PEERINGDB_API_KEY = 'pdb-key';
        await fetchPeeringdbNet(64500, { fetchImpl });
        assert.deepEqual(seen[1].init.headers, { Authorization: 'Api-Key pdb-key' });
    });

    it('an empty data array is no-record, a 5xx is an error', async () => {
        assert.equal((await fetchPeeringdbNet(64501, { fetchImpl: async () => response(200, { data: [] }) })).status, 'no-record');
        const failed = await fetchPeeringdbNet(64502, { fetchImpl: async () => response(502, {}) });
        assert.deepEqual(failed, { status: 'error', reason: 'http-502', source: 'peeringdb-api' });
        const threw = await fetchPeeringdbNet(64503, { fetchImpl: async () => { throw new Error('down'); } });
        assert.equal(threw.reason, 'request-failed');
    });

    it('a 429 pauses every lookup for Retry-After without asking again', async () => {
        let asked = 0;
        const fetchImpl = async () => { asked++; return response(429, {}, { 'Retry-After': '120' }); };
        const limited = await fetchPeeringdbNet(64510, { fetchImpl });
        assert.equal(limited.reason, 'rate-limited');
        assert.equal(limited.retryAfter, 120);
        const paused = await fetchPeeringdbNet(64511, { fetchImpl });
        assert.equal(paused.reason, 'rate-limited');
        assert.ok(paused.retryAfter > 100 && paused.retryAfter <= 120);
        assert.equal(asked, 1);
    });
});

describe('resolvePeeringdbNet', () => {
    it('prefers the local index; falls back to the API; disabled when neither', async () => {
        const local = await resolvePeeringdbNet(13335, { loaded: () => true, lookup: () => ({ types: ['NSP'] }) });
        assert.deepEqual(local, { status: 'record', record: { types: ['NSP'] }, source: 'peeringdb-index' });
        let apiCalls = 0;
        const fetchNet = async () => { apiCalls++; return { status: 'no-record', source: 'peeringdb-api' }; };
        assert.equal((await resolvePeeringdbNet(13335, { loaded: () => false, apiEnabled: () => true, fetchNet })).status, 'no-record');
        assert.equal(apiCalls, 1);
        assert.equal((await resolvePeeringdbNet(13335, { loaded: () => false, apiEnabled: () => false, fetchNet })).status, 'disabled');
        assert.equal(apiCalls, 1);
    });
});

describe('ASN profile wiring', () => {
    it('readiness: loaded or API-backed is on; neither and unconfigured is disabled; configured without either is an error', () => {
        assert.equal(peeringdbReadiness({ configured: () => false, loaded: () => false, apiFallback: () => true })(), true);
        assert.equal(peeringdbReadiness({ configured: () => false, loaded: () => false, apiFallback: () => false })(), false);
        assert.throws(() => peeringdbReadiness({ configured: () => true, loaded: () => false, apiFallback: () => false })(), /not loaded/);
    });

    it('an API failure is a section error (not cached for a week); a record is ok', async () => {
        const failing = peeringdbLookup(async () => ({ status: 'error', reason: 'rate-limited' }));
        await assert.rejects(failing(13335), /rate-limited/);
        const base = {
            hasRadarKey: () => false, getConnectivity: async () => null, rdapAutnum: async () => ({}), isAutnumMissing: () => false,
            queryAsRank: async () => null, requestReputation: async () => null, isPeeringdbLoaded: () => true,
        };
        const failed = await composeAsnProfile(13335, buildSectionLoaders({ ...base, lookupPeeringdb: failing }));
        assert.equal(failed.status.peeringdb, 'error');
        const ok = await composeAsnProfile(13335, buildSectionLoaders({
            ...base, lookupPeeringdb: peeringdbLookup(async () => ({ status: 'record', record: recordFromApi(NET) })),
        }));
        assert.equal(ok.status.peeringdb, 'ok');
        assert.equal(ok.peeringdb.policy, 'Open');
    });
});

describe('dossier ASN block', () => {
    it('summarises type and traffic, and the slot drops only the halves PeeringDB named', () => {
        const summary = peeringdbSummary({ status: 'record', record: recordFromApi(NET), source: 'peeringdb-api' });
        assert.deepEqual(summary.types, ['Content']);
        assert.equal(summary.traffic, null);
        assert.deepEqual(asnSlot(summary).partial, ['bandwidth']);
        const full = peeringdbSummary({ status: 'record', record: { types: ['NSP'], traffic: '1-5Tbps' } });
        assert.equal(asnSlot(full).partial, undefined);
        assert.equal(asnSlot(peeringdbSummary({ status: 'no-record' })), SLOTS.asn);
        assert.equal(peeringdbSummary({ status: 'disabled' }), null);
        assert.equal(peeringdbSummary({ status: 'error', reason: 'rate-limited', retryAfter: 60 }).retryAfter, 60);
    });
});
