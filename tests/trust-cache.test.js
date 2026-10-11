// The shared trust cache (`common/trust-cache.js`) and the list clock that decides
// how long a keyed answer is held.
//
// The property worth pinning is that this is a cost optimisation and never a data
// path: every KV malfunction has to arrive as a cache miss, because a deployment
// whose Cloudflare credentials broke must still answer `/api/trustscore` with the
// evidence it would have produced with no cache at all. The second property is the
// freshness claim: an entry is judged by the expiry it carries, so a value restored
// from a copied namespace cannot be read as today's answer.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
    readEntry, writeEntry, sharedCacheBackend, resetTrustCache,
} from '../common/trust-cache.js';
import { listTtlMs } from '../common/trust-signals.js';
import { dailyMax, outOfBudget, recordAsk, spentToday, resetQuota } from '../common/providers/quota.js';

const ENV_KEYS = ['CLOUDFLARE_API_KEY', 'CLOUDFLARE_API', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_KV_NAMESPACE_ID', 'TRUST_PROVIDER_DAILY_MAX'];

const originalFetch = globalThis.fetch;
let envBackup = {};

const configureKv = () => {
    process.env.CLOUDFLARE_API_KEY = 'kv-test-key';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'kv-test-account';
    process.env.CLOUDFLARE_KV_NAMESPACE_ID = 'kv-test-namespace';
};

beforeEach(() => {
    envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    resetTrustCache();
    resetQuota();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(envBackup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

// Records every call so a test can say "and nothing else left the process".
const stubKv = (respond) => {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        const result = await respond(String(url), init);
        if (result instanceof Error) throw result;
        return result;
    };
    return calls;
};

const kvResponse = (value, ttlSeconds = 3600) => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ expires: Date.now() + ttlSeconds * 1000, value }),
});

describe('trust-cache: which store is in use', () => {
    it('is memory without the trio and KV with it', () => {
        assert.equal(sharedCacheBackend(), 'memory');
        configureKv();
        assert.equal(sharedCacheBackend(), 'kv');
        // A half-configured deployment is not a shared cache, and must not try to
        // be: two of three variables would put a doomed request in front of a lookup.
        delete process.env.CLOUDFLARE_KV_NAMESPACE_ID;
        assert.equal(sharedCacheBackend(), 'memory');
    });

    it('answers from memory and asks nobody when KV is not configured', async () => {
        const calls = stubKv(() => ({ ok: true, status: 200, text: async () => 'nope' }));
        writeEntry('geo:203.0.113.1', { asn: 6450 }, 60);
        assert.deepEqual(await readEntry('geo:203.0.113.1'), { asn: 6450 });
        assert.equal(calls.length, 0, 'a memory-only deployment must not reach for Cloudflare');
    });

    it('expires a memory entry on its own clock', async () => {
        writeEntry('geo:203.0.113.2', { asn: 1 }, 0.001);
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        assert.equal(await readEntry('geo:203.0.113.2'), undefined);
    });
});

describe('trust-cache: the KV half', () => {
    it('reads a stored value and asks again only once', async () => {
        configureKv();
        const calls = stubKv(() => kvResponse({ country: 'DE' }));

        assert.deepEqual(await readEntry('rs:prefix:203.0.113.0/24'), { country: 'DE' });
        assert.deepEqual(await readEntry('rs:prefix:203.0.113.0/24'), { country: 'DE' });

        assert.equal(calls.length, 1, 'a KV hit is promoted, so the second read is free');
        assert.match(calls[0].url, /storage\/kv\/namespaces\/kv-test-namespace\/values\/trust%3Av1%3Ars%3Aprefix/,
            'the key is namespaced and URL-safe — a v6 address has colons in it');
        assert.equal(calls[0].init.method, 'GET');
        assert.equal(calls[0].init.headers.Authorization, 'Bearer kv-test-key');
    });

    it('writes the shared value with the ttl it was given', async () => {
        configureKv();
        const calls = stubKv(() => ({ ok: true, status: 200, text: async () => '' }));
        writeEntry('prov:203.0.113.3', [{ source: 'proxycheck.io' }], 86400);

        // The write is deliberately not awaited; give the microtask queue one turn.
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        const put = calls.find((c) => c.init.method === 'PUT');
        assert.ok(put, 'no write reached KV');
        assert.match(put.url, /expiration_ttl=86400/);
        assert.ok(put.init.body instanceof FormData, 'the KV write endpoint takes multipart, not a raw body');
        assert.equal(JSON.parse(put.init.body.get('value')).value[0].source, 'proxycheck.io');
    });

    // Every one of these is a cache miss. None of them is a failed lookup, and
    // none of them may throw: the caller has no error path for the cache.
    it('treats every KV malfunction as a miss', async () => {
        configureKv();
        const broken = [
            ['404', () => ({ ok: false, status: 404, text: async () => 'Not Found' })],
            ['500', () => ({ ok: false, status: 500, text: async () => 'boom' })],
            ['an html error page', () => ({ ok: true, status: 200, text: async () => '<html>login</html>' })],
            ['a value with no expiry', () => ({ ok: true, status: 200, text: async () => '{"value":1}' })],
            ['a throw', () => Object.assign(new Error('socket hang up'), { name: 'Error' })],
        ];
        for (const [label, respond] of broken) {
            resetTrustCache();
            stubKv(respond);
            assert.equal(await readEntry(`geo:203.0.113.${label.length}`), undefined, label);
        }
    });

    it('refuses a stored entry whose own expiry has passed', async () => {
        configureKv();
        stubKv(() => ({
            ok: true, status: 200,
            text: async () => JSON.stringify({ expires: Date.now() - 1000, value: { asn: 6450 } }),
        }));
        assert.equal(await readEntry('geo:203.0.113.9'), undefined,
            'a value from a copied namespace is not today\'s answer');
    });

    it('keeps a memory hit off the network entirely', async () => {
        configureKv();
        const calls = stubKv(() => kvResponse({ from: 'kv' }));
        writeEntry('geo:203.0.113.10', { from: 'memory' }, 600);
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        calls.length = 0;

        assert.deepEqual(await readEntry('geo:203.0.113.10'), { from: 'memory' });
        assert.equal(calls.length, 0);
    });

    // A value that big is a bug upstream of here, and paying for it in every read
    // would be the second bug.
    it('skips a shared write that is far too large', async () => {
        configureKv();
        const calls = stubKv(() => ({ ok: true, status: 200, text: async () => '' }));
        writeEntry('geo:203.0.113.11', 'x'.repeat(70 * 1024), 600);
        await new Promise((resolve) => { setTimeout(resolve, 0); });

        assert.equal(calls.filter((c) => c.init.method === 'PUT').length, 0);
        assert.equal(await readEntry('geo:203.0.113.11'), 'x'.repeat(70 * 1024), 'memory still holds it');
    });
});

describe('trust-cache: the memory cap', () => {
    it('evicts the least recently read entry, not the first written one', async () => {
        // 2000 is the cap; filling it exactly then touching the oldest key proves
        // the eviction reads recency rather than insertion order.
        for (let i = 0; i < 2000; i++) writeEntry(`k${i}`, i, 3600);
        assert.deepEqual(await readEntry('k0'), 0, 'touching it makes it recent');
        writeEntry('extra', 'new', 3600);

        assert.deepEqual(await readEntry('k0'), 0, 'a recently read entry survived the cap');
        assert.equal(await readEntry('k1'), undefined, 'and the one next in line did not');
        assert.deepEqual(await readEntry('extra'), 'new');
    });
});

// --- the list clock -----------------------------------------------------------

describe('TRUST_CACHE_TTL_SECONDS', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('defaults to a day, which is the vendors\' own re-evaluation cycle', () => {
        assert.equal(listTtlMs(), DAY);
        for (const unset of ['', undefined, 'not-a-number', '0', '-3600', '3600abc', '86400.5']) {
            process.env.TRUST_CACHE_TTL_SECONDS = unset;
            assert.equal(listTtlMs(), DAY, `unset/invalid is the default, not a guess (${unset})`);
        }
    });

    // Both ends clamped: a five-second cache spends the quota on every visitor and
    // a decade-long one holds an accusation past the evidence that produced it.
    it('clamps what a deployment asked for', () => {
        process.env.TRUST_CACHE_TTL_SECONDS = '5';
        assert.equal(listTtlMs(), 60 * 1000);
        process.env.TRUST_CACHE_TTL_SECONDS = '999999999';
        assert.equal(listTtlMs(), 7 * DAY);
        process.env.TRUST_CACHE_TTL_SECONDS = '3600';
        assert.equal(listTtlMs(), 3600 * 1000);
    });

    afterEach(() => { delete process.env.TRUST_CACHE_TTL_SECONDS; });
});

// --- the per-vendor budget ----------------------------------------------------

describe('provider quota', () => {
    it('is uncapped until a deployment states a ceiling', () => {
        assert.equal(dailyMax(), 0);
        assert.equal(outOfBudget('proxycheck.io'), false);
        recordAsk('proxycheck.io');
        recordAsk('proxycheck.io');
        assert.equal(spentToday('proxycheck.io'), 2);
        assert.equal(outOfBudget('proxycheck.io'), false);
    });

    it('reads a typo as no cap rather than as a budget of one', () => {
        for (const bad of ['abc', '', '-5', '0', '1.9x']) {
            process.env.TRUST_PROVIDER_DAILY_MAX = bad;
            assert.equal(dailyMax(), 0, bad);
            assert.equal(outOfBudget('proxycheck.io'), false, bad);
        }
    });

    it('counts each vendor separately and stops at the ceiling', () => {
        process.env.TRUST_PROVIDER_DAILY_MAX = '2';
        assert.equal(outOfBudget('proxycheck.io'), false);
        recordAsk('proxycheck.io');
        recordAsk('abuseipdb.com');
        recordAsk('proxycheck.io');
        assert.equal(outOfBudget('proxycheck.io'), true);
        assert.equal(spentToday('proxycheck.io'), 2);
        assert.equal(outOfBudget('abuseipdb.com'), false);
        assert.equal(spentToday('internetdb.shodan.io'), 0);
    });

    it('stops charging at the ceiling rather than running away from it', () => {
        process.env.TRUST_PROVIDER_DAILY_MAX = '1';
        recordAsk('proxycheck.io');
        while (outOfBudget('proxycheck.io')) break;
        assert.equal(spentToday('proxycheck.io'), 1, 'a skipped vendor spends nothing');
    });
});
