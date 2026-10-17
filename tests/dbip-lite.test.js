// Tests for the DB-IP Lite stand-in behind /api/maxmind: which database pair
// the service opens (GeoLite2 first), the `dbip` dataset row (gated off by
// MaxMind credentials, monthly release lookup with previous-month fallback,
// MMDB validation), and the attribution flag /api/configs exposes. fetch is
// stubbed and the row is re-pointed at a temp dir: no network, nothing
// written into the repo's dataset directories.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, afterEach, describe, it } from 'node:test';

import {
    pickGeoDbPaths, GEO_SOURCE, DBIP_DB_DIR, DBIP_CITY_DB, DBIP_ASN_DB, MAXMIND_DB_DIR, DBIP_ATTRIBUTION,
} from '../common/maxmind-service.js';
import { datasets, dbipUrl, findDbipRelease, isDbipEnabled } from '../common/datasets.js';
import { updateDataset, isRowEnabled } from '../common/dataset-updater.js';
import configsHandler from '../api/configs.js';

const realFetch = globalThis.fetch;
const ENV = ['MAXMIND_ACCOUNT_ID', 'MAXMIND_LICENSE_KEY', 'DBIP_LITE'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
    globalThis.fetch = realFetch;
    for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trustip-dbip-test-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const row = datasets.find((r) => r.id === 'dbip');

describe('pickGeoDbPaths', () => {
    it('GeoLite2 wins whenever both of its files exist', () => {
        const picked = pickGeoDbPaths(() => true);
        assert.equal(picked.source, GEO_SOURCE.geolite2);
        assert.equal(picked.dbDir, MAXMIND_DB_DIR);
    });

    it('falls back to DB-IP Lite only when both DB-IP files exist', () => {
        const dbipOnly = (p) => p.startsWith(DBIP_DB_DIR);
        const picked = pickGeoDbPaths(dbipOnly);
        assert.equal(picked.source, GEO_SOURCE.dbip);
        assert.equal(picked.cityDbPath, path.join(DBIP_DB_DIR, DBIP_CITY_DB));
        assert.equal(picked.asnDbPath, path.join(DBIP_DB_DIR, DBIP_ASN_DB));
        const halfDbip = (p) => p.endsWith(DBIP_CITY_DB);
        assert.equal(pickGeoDbPaths(halfDbip).source, GEO_SOURCE.geolite2, 'half a pair is no pair');
    });

    it('names the CC BY 4.0 attribution DB-IP asks for', () => {
        assert.equal(DBIP_ATTRIBUTION.text, 'IP Geolocation by DB-IP');
        assert.equal(DBIP_ATTRIBUTION.url, 'https://db-ip.com');
        assert.equal(DBIP_ATTRIBUTION.license, 'CC BY 4.0');
    });
});

describe('dbip row', () => {
    it('runs only without MaxMind credentials, and DBIP_LITE=false turns it off', () => {
        delete process.env.MAXMIND_ACCOUNT_ID;
        delete process.env.MAXMIND_LICENSE_KEY;
        delete process.env.DBIP_LITE;
        assert.equal(isDbipEnabled(), true);
        assert.equal(isRowEnabled(row), true);
        process.env.DBIP_LITE = 'false';
        assert.equal(isRowEnabled(row), false);
        delete process.env.DBIP_LITE;
        process.env.MAXMIND_ACCOUNT_ID = '1';
        process.env.MAXMIND_LICENSE_KEY = 'k';
        assert.equal(isRowEnabled(row), false, 'keyed GeoLite2 is preferred');
    });

    it('takes the current UTC month, the previous one before the release lands', async () => {
        const asked = [];
        globalThis.fetch = async (url, init) => {
            asked.push(`${init.method} ${url}`);
            return new Response(null, { status: String(url).includes('2026-11') ? 404 : 200 });
        };
        const release = await findDbipRelease({ now: new Date('2026-11-01T03:00:00Z') });
        assert.equal(release.identifier, 'dbip-lite-2026-10');
        assert.deepEqual(release.urls.map((u) => u.url), [dbipUrl('city', '2026-10'), dbipUrl('asn', '2026-10')]);
        assert.equal(asked[0], `HEAD ${dbipUrl('city', '2026-11')}`);
    });

    it('fails on a server error and when neither month exists', async () => {
        globalThis.fetch = async () => new Response(null, { status: 503 });
        await assert.rejects(findDbipRelease({ now: new Date('2026-10-17T00:00:00Z') }), /HTTP 503/);
        globalThis.fetch = async () => new Response(null, { status: 404 });
        await assert.rejects(findDbipRelease({ now: new Date('2026-10-17T00:00:00Z') }), /No DB-IP Lite release/);
    });

    it('decompresses both files and refuses to publish anything that is not an MMDB', async () => {
        const gz = zlib.gzipSync(Buffer.from('not an mmdb'));
        globalThis.fetch = async (url, init) => new Response(init?.method === 'HEAD' ? null : gz, { status: 200 });
        const reloads = [];
        const dataset = { ...row, dir: fs.mkdtempSync(path.join(root, 'dbip-')), reload: (r) => reloads.push(r) };
        await assert.rejects(updateDataset(dataset));
        assert.deepEqual(reloads, []);
        assert.equal(fs.existsSync(path.join(dataset.dir, DBIP_CITY_DB)), false);
    });
});

describe('/api/configs', () => {
    it('reports dbipLite as a boolean (false while no DB-IP reader serves)', () => {
        let body;
        const res = { setHeader() {}, status() { return this; }, json(b) { body = b; } };
        configsHandler({ method: 'GET', headers: {} }, res);
        assert.equal(typeof body.dbipLite, 'boolean');
    });
});
