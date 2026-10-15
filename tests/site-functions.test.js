// Specs for the Qoder Sites edge function (`functions/`). That directory is
// copied verbatim by the packager and cannot import from the rest of the repo,
// so some modules there are byte-for-byte mirrors of `common/`. These specs
// guard two things that need no network: the mirrors have not drifted from
// their source, and the router answers unknown paths, wrong methods, bad
// guards and bad bodies before any upstream would be called.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import handler, { routeNameOf } from '../functions/handler.ts';

// Modules `functions/shared/` carries unchanged from `common/`. A file that
// needs an edge-specific change leaves this list in the same commit.
const MIRRORED = [
    'ai-news.js',
    'ai-news-store.js',
    'bgp-prefix.js',
    'dns-record-types.js',
    'globalping-inventory.js',
    'service-status-providers.js',
    'service-status-transform.js',
    'site-packs.js',
    'split-profile.js',
    'timezone-countries.js',
    'valid-ip.js',
];

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const call = (path, init = {}) =>
    handler(new Request(`http://localhost/functions/v1/app/${path}`, init));

describe('functions/shared mirrors of common/', () => {
    for (const file of MIRRORED) {
        it(`${file} matches common/${file}`, () => {
            assert.equal(read(`functions/shared/${file}`), read(`common/${file}`));
        });
    }
});

describe('routeNameOf', () => {
    it('strips the platform prefix', () => {
        assert.equal(routeNameOf('/functions/v1/app/ipsb'), 'ipsb');
        assert.equal(routeNameOf('/functions/v1/app/service-status/detail'), 'service-status/detail');
    });

    it('resolves a bare local-harness path, including a two-segment route', () => {
        assert.equal(routeNameOf('/ipsb'), 'ipsb');
        assert.equal(routeNameOf('/app/service-status/detail'), 'service-status/detail');
    });
});

describe('edge handler', () => {
    it('answers 404 for an unknown route', async () => {
        const res = await call('nope');
        assert.equal(res.status, 404);
        assert.equal(res.headers.get('Cache-Control'), 'no-store');
    });

    it('answers 405 for the wrong method', async () => {
        const res = await call('split');
        assert.equal(res.status, 405);
    });

    it('routes /api/ai-news like the Express app (GET only)', async () => {
        const res = await call('ai-news', { method: 'POST', body: '{}' });
        assert.equal(res.status, 405);
    });

    it('runs the IP guard before the upstream', async () => {
        const missing = await call('ipsb');
        assert.equal(missing.status, 400);
        assert.deepEqual(await missing.json(), { error: 'No IP address provided' });

        const privateIp = await call('internetdb?ip=192.168.1.1');
        assert.equal(privateIp.status, 400);
        assert.deepEqual(await privateIp.json(), { error: 'Not a public IP address' });
    });

    it('rejects an unparseable POST body with 400', async () => {
        const res = await call('split', { method: 'POST', body: '{not json' });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: 'Invalid body' });
    });

    it('serves configs with every keyed feature off', async () => {
        const res = await call('configs');
        assert.equal(res.status, 200);
        const flags = await res.json();
        for (const key of ['ipInfo', 'maxmind', 'reportSharing', 'ipCard']) {
            assert.equal(flags[key], false, key);
        }
    });
});
