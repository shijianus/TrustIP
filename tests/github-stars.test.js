// Tests for /api/github-stars' key-ready wiring and last-good cache:
// GITHUB_TOKEN sent as a Bearer token, the last real count served (stale) when
// GitHub fails, persisted across a restart, and a body without a numeric
// stargazers_count never read as zero. fetch stubbed, cache file in a temp dir.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import handler, { resetGithubStarsCache, useLastGoodFile } from '../api/github-stars.js';

const realFetch = globalThis.fetch;
const savedToken = process.env.GITHUB_TOKEN;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trustip-stars-'));
const file = path.join(dir, 'last-good.json');
after(() => fs.rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
    fs.rmSync(file, { force: true });
    useLastGoodFile(file);
    resetGithubStarsCache({ lastGood: true });
});
afterEach(() => {
    globalThis.fetch = realFetch;
    if (savedToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedToken;
});

const call = async () => {
    const out = { statusCode: 200, body: null };
    await handler({ method: 'GET', query: {} }, {
        status(code) { out.statusCode = code; return this; },
        json(body) { out.body = body; return this; },
    });
    return out;
};

describe('github-stars', () => {
    it('sends GITHUB_TOKEN as Bearer when set, nothing otherwise', async () => {
        const seen = [];
        globalThis.fetch = async (url, init) => { seen.push(init.headers); return new Response(JSON.stringify({ stargazers_count: 7 })); };
        delete process.env.GITHUB_TOKEN;
        await call();
        assert.equal(seen[0].Authorization, undefined);
        resetGithubStarsCache();
        process.env.GITHUB_TOKEN = 'ghp_test';
        await call();
        assert.equal(seen[1].Authorization, 'Bearer ghp_test');
    });

    it('a real count is stored; a later failure serves it as stale rather than a 500 or a 0', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({ stargazers_count: 12 }));
        assert.deepEqual((await call()).body, { stars: 12 });
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).stars, 12);

        resetGithubStarsCache();
        globalThis.fetch = async () => new Response('{}', { status: 403 });
        const stale = await call();
        assert.equal(stale.statusCode, 200);
        assert.equal(stale.body.stars, 12);
        assert.equal(stale.body.stale, true);
        assert.ok(stale.body.asOf);
    });

    it('the stored count survives a restart (re-read from disk)', async () => {
        fs.writeFileSync(file, JSON.stringify({ stars: 5, at: '2026-10-17T00:00:00.000Z' }));
        useLastGoodFile(file);
        globalThis.fetch = async () => { throw new Error('offline'); };
        assert.deepEqual((await call()).body, { stars: 5, stale: true, asOf: '2026-10-17T00:00:00.000Z' });
    });

    it('a body without a numeric stargazers_count is a failure, not zero', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({ message: 'API rate limit exceeded' }));
        const out = await call();
        assert.equal(out.statusCode, 500);
        assert.equal(fs.existsSync(file), false);
    });

    it('a genuine zero is reported as zero', async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({ stargazers_count: 0 }));
        assert.deepEqual((await call()).body, { stars: 0 });
    });
});
