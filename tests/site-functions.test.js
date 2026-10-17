// Specs for the Qoder Sites edge function (`functions/`). That directory is
// copied verbatim by the packager and cannot import from the rest of the repo,
// so some modules there are byte-for-byte mirrors of `common/`. These specs
// guard two things that need no network: the mirrors have not drifted from
// their source, and the router answers unknown paths, wrong methods, bad
// guards and bad bodies before any upstream would be called.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import handler, { routeNameOf, readBodyCapped, MAX_BODY_BYTES } from '../functions/handler.ts';

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

    it('answers 405 for the wrong method, naming the route\'s method in Allow', async () => {
        const res = await call('split');
        assert.equal(res.status, 405);
        assert.equal(res.headers.get('Allow'), 'POST');
    });

    it('refuses TRACE (and any method no route answers) with 405 + Allow, unknown paths included', async () => {
        // `new Request()` throws on TRACE, so the platform-side shape is a plain
        // object — the handler reads only these four fields.
        for (const method of ['TRACE', 'TRACK']) {
            for (const path of ['ipsb?ip=8.8.8.8', 'nope']) {
                const res = await handler({
                    url: `http://localhost/functions/v1/app/${path}`, method, headers: new Headers(), body: null,
                });
                assert.equal(res.status, 405, `${method} ${path}`);
                assert.equal(res.headers.get('Allow'), 'GET, POST');
                assert.equal(res.headers.get('Cache-Control'), 'no-store');
            }
        }
        for (const method of ['PUT', 'DELETE', 'PROPFIND', 'OPTIONS']) {
            const res = await call('configs', { method });
            assert.equal(res.status, 405, method);
            assert.equal(res.headers.get('Allow'), 'GET, POST');
        }
    });

    it('caps a POST body at 64 KB: declared length, and a chunked stream counted as it arrives', async () => {
        assert.equal(MAX_BODY_BYTES, 64 * 1024);
        const declared = await call('split', {
            method: 'POST', body: 'x', headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
        });
        assert.equal(declared.status, 413);
        assert.deepEqual(await declared.json(), { error: 'Request body too large' });

        let pulled = 0;
        const chunk = new Uint8Array(16 * 1024).fill(32);
        const stream = new ReadableStream({
            pull(controller) {
                if (pulled >= 64) return controller.close();
                pulled += 1;
                controller.enqueue(chunk);
            },
        });
        const chunked = await call('split', { method: 'POST', body: stream, duplex: 'half' });
        assert.equal(chunked.status, 413);
        assert.ok(pulled < 64, `stream should be abandoned early (pulled ${pulled} chunks)`);
    });

    it('readBodyCapped reads a body exactly at the limit and refuses one byte more', async () => {
        const at = await readBodyCapped(new Request('http://x/', { method: 'POST', body: 'a'.repeat(32) }), 32);
        assert.equal(at.text.length, 32);
        const over = await readBodyCapped(new Request('http://x/', { method: 'POST', body: 'a'.repeat(33) }), 32);
        assert.equal(over.tooLarge, true);
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
