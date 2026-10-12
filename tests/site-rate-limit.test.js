// The edge function's per-client rate ceiling (functions/shared/rate-limit.js).
//
// Two things are being proved here. The first is the arithmetic: a window counts,
// a window expires, and a configured number is read as its author meant it. The
// second is the two failure modes that would make the limit worse than nothing —
// putting every unidentified client in one bucket, and letting the counter grow
// without bound on a long-lived isolate.
//
// The clock is injected rather than stubbed, because the interesting behaviour is
// what happens at `now + windowMs`, and waiting for it is not a test.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    clientIpOf, createRateLimiter, rateLimitConfig, RATE_LIMIT_DEFAULTS,
} from '../functions/shared/rate-limit.js';

// `clientIpOf` only ever calls `.get()`, which is what a real Headers gives it.
const headersOf = (entries) => ({
    get: (name) => entries[name.toLowerCase()] ?? null,
});

describe('rate-limit.js clientIpOf', () => {
    it('takes the proxy-written header over a client-writable one', () => {
        assert.equal(clientIpOf(headersOf({
            'cf-connecting-ip': '203.0.113.7',
            'x-forwarded-for': '198.51.100.1',
        })), '203.0.113.7');
        assert.equal(clientIpOf(headersOf({
            'x-real-ip': '203.0.113.9',
            'x-forwarded-for': '198.51.100.1',
        })), '203.0.113.9');
    });

    it('reads only the first hop of a forwarded chain', () => {
        // Everything after the first entry was written by a proxy this function
        // does not control, so it proves nothing about who connected.
        assert.equal(
            clientIpOf(headersOf({ 'x-forwarded-for': '198.51.100.4, 70.41.3.18, 150.172.238.28' })),
            '198.51.100.4',
        );
    });

    it('returns null when no header names a client', () => {
        assert.equal(clientIpOf(headersOf({})), null);
        assert.equal(clientIpOf(headersOf({ 'x-forwarded-for': '   , 10.0.0.1' })), null);
    });
});

describe('rate-limit.js createRateLimiter', () => {
    const WINDOW = 60_000;

    it('allows up to the limit in one window and refuses past it', () => {
        let now = 1_000;
        const limiter = createRateLimiter({ limit: 3, windowMs: WINDOW, now: () => now });

        for (let i = 0; i < 3; i += 1) {
            assert.equal(limiter.check('203.0.113.1').allowed, true, `request ${i + 1}`);
        }
        const blocked = limiter.check('203.0.113.1');
        assert.equal(blocked.allowed, false);
        assert.ok(blocked.retryAfterSeconds > 0);
    });

    it('counts each client separately', () => {
        const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW, now: () => 1_000 });
        assert.equal(limiter.check('203.0.113.1').allowed, true);
        assert.equal(limiter.check('203.0.113.1').allowed, false);
        assert.equal(limiter.check('203.0.113.2').allowed, true);
    });

    it('opens a fresh window when the old one expires', () => {
        let now = 0;
        const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW, now: () => now });
        limiter.check('203.0.113.1');
        limiter.check('203.0.113.1');
        assert.equal(limiter.check('203.0.113.1').allowed, false);

        now = WINDOW + 1;
        assert.equal(limiter.check('203.0.113.1').allowed, true, 'the window rolled over');
        assert.equal(limiter.check('203.0.113.1').allowed, true);
        assert.equal(limiter.check('203.0.113.1').allowed, false);
    });

    it('names a retry window that is whole seconds and never zero', () => {
        let now = 0;
        const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW, now: () => now });
        limiter.check('203.0.113.1');
        now = WINDOW - 1_500;
        const blocked = limiter.check('203.0.113.1');
        assert.equal(blocked.allowed, false);
        // 1.5s left → a client told to wait 1s would come back and be refused again.
        assert.equal(blocked.retryAfterSeconds, 2);

        now = WINDOW - 1;
        assert.equal(limiter.check('203.0.113.1').retryAfterSeconds, 1, 'never rounds to 0');
    });

    it('disables itself when the limit is zero or negative', () => {
        const limiter = createRateLimiter({ limit: 0, windowMs: WINDOW, now: () => 0 });
        for (let i = 0; i < 10; i += 1) assert.equal(limiter.check('203.0.113.1').allowed, true);
        assert.equal(limiter.size(), 0, 'a disabled limiter keeps no state at all');
    });

    it('fails open for a client it cannot identify', () => {
        // Sharing one anonymous bucket would make every unidentified visitor pay
        // for one abuser's traffic — the opposite of what the ceiling is for.
        const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW, now: () => 0 });
        for (let i = 0; i < 10; i += 1) assert.equal(limiter.check(null).allowed, true);
        assert.equal(limiter.size(), 0);
    });

    it('drops expired buckets instead of growing without bound', () => {
        let now = 0;
        const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW, now: () => now });
        for (let i = 0; i < 3000; i += 1) limiter.check(`203.0.113.${i % 250}.${Math.floor(i / 250)}`);
        const grown = limiter.size();
        assert.ok(grown >= 2048, `sweep should have been triggered by ${grown}`);

        now = WINDOW * 2;
        limiter.check('198.51.100.1');
        assert.ok(limiter.size() < grown, 'expired entries are reclaimed on the next sweep');
    });
});

describe('rate-limit.js rateLimitConfig', () => {
    it('falls back to the default when nothing is set', () => {
        assert.deepEqual(rateLimitConfig({}), RATE_LIMIT_DEFAULTS);
        assert.deepEqual(rateLimitConfig({ SITE_RATE_LIMIT: '' }), RATE_LIMIT_DEFAULTS);
        assert.deepEqual(rateLimitConfig({ SITE_RATE_LIMIT: '   ' }), RATE_LIMIT_DEFAULTS);
    });

    it('treats a non-number as the default, not as zero', () => {
        // An operator who typos the value should keep the protection, not silently
        // lose it — the same reasoning that keeps a mistyped TRUST_PROVIDER_DAILY_MAX
        // from becoming a budget of one.
        assert.equal(rateLimitConfig({ SITE_RATE_LIMIT: 'many' }).limit, RATE_LIMIT_DEFAULTS.limit);
        assert.equal(rateLimitConfig({ SITE_RATE_LIMIT: 'NaN' }).limit, RATE_LIMIT_DEFAULTS.limit);
    });

    it('honours an explicit zero as "off"', () => {
        assert.equal(rateLimitConfig({ SITE_RATE_LIMIT: '0' }).limit, 0);
        assert.equal(rateLimitConfig({ SITE_RATE_LIMIT: '-5' }).limit, 0);
    });

    it('reads a stated ceiling as a whole number', () => {
        assert.equal(rateLimitConfig({ SITE_RATE_LIMIT: '120' }).limit, 120);
        assert.equal(rateLimitConfig({ SITE_RATE_LIMIT: '120.9' }).limit, 120);
        assert.equal(rateLimitConfig({ SITE_RATE_LIMIT: '120' }).windowMs, RATE_LIMIT_DEFAULTS.windowMs);
    });
});
