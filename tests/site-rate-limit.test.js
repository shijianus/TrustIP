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
    clientIpOf, createRateLimiter, rateLimitConfig, RATE_LIMIT_DEFAULTS, UNKNOWN_CLIENT,
} from '../functions/shared/rate-limit.js';

// `clientIpOf` only ever calls `.get()`, which is what a real Headers gives it.
const headersOf = (entries) => ({
    get: (name) => entries[name.toLowerCase()] ?? null,
});

describe('rate-limit.js clientIpOf', () => {
    it('keys on the platform-written CF-Connecting-IP', () => {
        assert.equal(clientIpOf(headersOf({
            'cf-connecting-ip': ' 203.0.113.7 ',
            'x-forwarded-for': '198.51.100.1',
            'x-real-ip': '198.51.100.2',
        })), '203.0.113.7');
    });

    it('never reads a client-writable header', () => {
        // A script that rotates X-Forwarded-For or X-Real-IP must not get a fresh
        // bucket per request: both collapse onto the shared unknown key.
        assert.equal(clientIpOf(headersOf({ 'x-forwarded-for': '9.9.9.9, 1.2.3.4' })), UNKNOWN_CLIENT);
        assert.equal(clientIpOf(headersOf({ 'x-real-ip': '7.7.7.7' })), UNKNOWN_CLIENT);
    });

    it('names the shared unknown bucket when the platform header is missing or blank', () => {
        assert.equal(clientIpOf(headersOf({})), UNKNOWN_CLIENT);
        assert.equal(clientIpOf(headersOf({ 'cf-connecting-ip': '   ' })), UNKNOWN_CLIENT);
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

    it('puts unidentified clients in one shared bucket instead of failing open', () => {
        const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW, now: () => 0 });
        assert.equal(limiter.check(null).allowed, true);
        assert.equal(limiter.check('').allowed, true);
        assert.equal(limiter.check(undefined).allowed, false, 'null, empty and undefined share one bucket');
        assert.equal(limiter.check(UNKNOWN_CLIENT).allowed, false);
        assert.equal(limiter.size(), 1);
    });

    it('a rotating X-Forwarded-For without the platform header stays limited', () => {
        const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW, now: () => 0 });
        const verdicts = [1, 2, 3, 4].map((i) => limiter.check(clientIpOf(headersOf({
            'x-forwarded-for': `198.51.100.${i}`,
        }))).allowed);
        assert.deepEqual(verdicts, [true, true, false, false]);
    });

    it('drops expired buckets on the next sweep', () => {
        let now = 0;
        const limiter = createRateLimiter({ limit: 1, windowMs: WINDOW, now: () => now });
        for (let i = 0; i < 3000; i += 1) limiter.check(`203.0.113.${i % 250}.${Math.floor(i / 250)}`);
        assert.equal(limiter.size(), 3000);

        now = WINDOW * 2;
        limiter.check('198.51.100.1');
        assert.equal(limiter.size(), 1, 'expired entries are reclaimed');
    });

    it('sweeps at most once per interval, not on every request', () => {
        let now = 0;
        const limiter = createRateLimiter({ limit: 1, windowMs: 10, sweepIntervalMs: 1_000, now: () => now });
        for (let i = 0; i < 100; i += 1) limiter.check(`a${i}`);
        // Every bucket has expired, but the sweep that ran at t=0 is not repeated
        // until a full interval has passed.
        now = 500;
        limiter.check('b');
        assert.equal(limiter.size(), 101);
        now = 1_000;
        limiter.check('c');
        assert.equal(limiter.size(), 1);
    });

    it('never holds more than maxKeys, evicting the least recently used client', () => {
        const limiter = createRateLimiter({ limit: 2, windowMs: WINDOW, maxKeys: 3, now: () => 0 });
        limiter.check('a');
        limiter.check('b');
        limiter.check('c');
        limiter.check('a'); // a is now the most recent; b is the oldest
        limiter.check('d');
        assert.equal(limiter.size(), 3);
        // a kept its count (2 of 2 used), so its next request is refused.
        assert.equal(limiter.check('a').allowed, false, 'the active client was not evicted');
        // b was evicted and starts over.
        assert.equal(limiter.check('b').allowed, true);
        assert.equal(limiter.size(), 3);
    });

    it('stays at the default cap under a flood of distinct keys', () => {
        const limiter = createRateLimiter({ limit: 5, windowMs: WINDOW, now: () => 0 });
        for (let i = 0; i < 25_000; i += 1) limiter.check(`k${i}`);
        assert.equal(limiter.size(), 10_000);
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
