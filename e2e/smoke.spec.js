// E2E smoke over the built app on the offline stack (playwright.config.js).
//
// The browser never reaches the internet: every non-loopback request is aborted,
// except the visitor-IP endpoints a test chooses to answer with a fixed address.
// WebRTC is the one channel a route cannot see: an init script strips the public
// STUN servers from every RTCPeerConnection the page builds, so only the local
// STUN server (dist-stun's VITE_TEST_EXTRA_STUN) can answer. Neither the WebRTC
// verdict nor the homepage's quiet WebRTC pass then depends on whether the runner
// has outbound UDP.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const OUT = process.env.E2E_OUT_DIR || 'e2e/.out';
const STUN_PORT = Number(process.env.E2E_FRONTEND_STUN_PORT || 42967);
const STUN_ORIGIN = `http://127.0.0.1:${STUN_PORT}`;
const STUN_LOG = path.join(OUT, 'logs', 'stun-requests.jsonl');
const FIXED_IP = '8.8.8.8';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SETTLED = ['pass', 'fail', 'leak', 'no-leak', 'inconclusive', 'error', 'partial', 'warn'];

/** Test-side shim: keep only loopback STUN servers in every RTCPeerConnection. */
const localStunOnly = (context) => context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    if (!Native) return;
    const local = (url) => /^stuns?:(127\.0\.0\.1|\[::1\]|localhost)(:|$)/i.test(String(url));
    const filter = (config) => {
        if (!config || !Array.isArray(config.iceServers)) return config;
        const iceServers = config.iceServers
            .map((server) => {
                const urls = [].concat(server.urls ?? server.url ?? []).filter(local);
                return urls.length ? { ...server, urls } : null;
            })
            .filter(Boolean);
        return { ...config, iceServers };
    };
    function Shim(config, ...rest) {
        return new Native(filter(config), ...rest);
    }
    Shim.prototype = Native.prototype;
    Object.setPrototypeOf(Shim, Native);
    window.RTCPeerConnection = Shim;
});

/** Abort everything off-box; optionally answer the visitor-IP lookups with FIXED_IP. */
const isolate = async (context, { answerIp = false, delayMs = 0 } = {}) => {
    await localStunOnly(context);
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (LOOPBACK.has(url.hostname)) return route.continue();
        if (answerIp && delayMs) await new Promise((r) => setTimeout(r, delayMs));
        if (answerIp && url.pathname.endsWith('/cdn-cgi/trace')) {
            return route.fulfill({ status: 200, contentType: 'text/plain', body: `fl=e2e\nh=${url.host}\nip=${FIXED_IP}\nloc=US\ncolo=SJC\n` });
        }
        if (answerIp && /(^|\.)ipify\.org$|(^|\.)ipcheck\.ing$/.test(url.hostname) && url.pathname === '/') {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ip: FIXED_IP }) });
        }
        return route.abort('internetdisconnected');
    });
};

/** Uncaught page errors are a failure on every page. */
const watchErrors = (page) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.stack || error)));
    return errors;
};

// Full-page screenshot kept next to the test's trace (uploaded as a CI artifact)
// and attached to the HTML report.
const shot = async (page, testInfo, name) => {
    const file = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    await testInfo.attach(name, { path: file, contentType: 'image/png' });
};

test.describe('home', () => {
    test('own-IP card goes from skeleton to the visitor address', async ({ page, context }, testInfo) => {
        // The visitor-IP answer is held back long enough to see the skeleton first.
        await isolate(context, { answerIp: true, delayMs: 2500 });
        const errors = watchErrors(page);
        await page.goto('/');
        const card = page.locator('main#mainpart section').first();
        await expect(card.locator('h1')).toBeVisible();
        await expect(card.locator('.jn-skeleton').first()).toBeVisible();
        const ipLink = page.locator(`main#mainpart a[data-mask="ip"][href="/ip/${FIXED_IP}"]`).first();
        await expect(ipLink).toBeVisible();
        await expect(ipLink).toHaveText(FIXED_IP);
        await expect(card.locator('.jn-skeleton')).toHaveCount(0);
        await shot(page, testInfo, 'home-own-ip');
        expect(errors).toEqual([]);
    });

    test('with every IP source unreachable the page degrades without crashing', async ({ page, context }, testInfo) => {
        await isolate(context, { answerIp: false });
        const errors = watchErrors(page);
        await page.goto('/');
        const card = page.locator('main#mainpart section').first();
        await expect(card.locator('h1')).toBeVisible();
        // Either still waiting (skeleton) or showing whatever address WebRTC found —
        // never a blank or broken card.
        await expect(card.locator('.jn-skeleton, a[data-mask="ip"]').first()).toBeVisible();
        await page.waitForTimeout(3000);
        await shot(page, testInfo, 'home-offline');
        expect(errors).toEqual([]);
    });
});

test('tools index lists the advanced tools', async ({ page, context }, testInfo) => {
    await isolate(context);
    const errors = watchErrors(page);
    await page.goto('/tools');
    await expect(page.locator('main h1, main h2').first()).toBeVisible();
    const tools = page.locator('main a[href^="/tools/"]');
    await expect.poll(() => tools.count()).toBeGreaterThanOrEqual(5);
    await shot(page, testInfo, 'tools-index');
    expect(errors).toEqual([]);
});

test('WebRTC page reaches a verdict against the local STUN server', async ({ page, context }, testInfo) => {
    test.skip(!fs.existsSync('dist-stun/index.html'), 'dist-stun/ not built (VITE_TEST_EXTRA_STUN build)');
    await isolate(context);
    const errors = watchErrors(page);
    const before = fs.existsSync(STUN_LOG) ? fs.readFileSync(STUN_LOG, 'utf8').split('\n').filter(Boolean).length : 0;

    await page.goto(`${STUN_ORIGIN}/webrtc`);
    const log = page.locator('[data-testlog="webrtc"]');
    await expect(log).toBeVisible();
    await expect(log).toHaveAttribute('data-testlog-verdict', new RegExp(`^(${SETTLED.join('|')})$`), { timeout: 60_000 });
    const verdict = await log.getAttribute('data-testlog-verdict');
    await shot(page, testInfo, `webrtc-verdict-${verdict}`);

    const lines = fs.readFileSync(STUN_LOG, 'utf8').split('\n').filter(Boolean).slice(before).map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.result === 'binding-success').length, 'binding requests answered by the local STUN server').toBeGreaterThan(0);
    // Only a loopback reflexive candidate exists, so the rule (webrtcVerdict) says
    // "private addresses only" — no leak.
    expect(verdict).toBe('no-leak');
    expect(errors).toEqual([]);
});

test('DNS leak page renders its test log', async ({ page, context }, testInfo) => {
    await isolate(context);
    const errors = watchErrors(page);
    await page.goto('/dns');
    const log = page.locator('[data-testlog="dnsleak"]');
    await expect(log).toBeVisible();
    // Offline, no resolver is ever observed: the verdict settles as inconclusive.
    await expect(log).toHaveAttribute('data-testlog-verdict', new RegExp(`^(${SETTLED.join('|')})$`), { timeout: 60_000 });
    await shot(page, testInfo, 'dns-leak-log');
    expect(errors).toEqual([]);
});

test('IP dossier route renders for an address', async ({ page, context }, testInfo) => {
    await isolate(context);
    const errors = watchErrors(page);
    const dossier = page.waitForResponse((r) => r.url().includes(`/api/dossier?ip=${FIXED_IP}`));
    await page.goto(`/ip/${FIXED_IP}`);
    expect((await dossier).status()).toBe(200);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.locator('main')).toContainText(FIXED_IP);
    await shot(page, testInfo, 'dossier');
    expect(errors).toEqual([]);
});

test.describe('not found', () => {
    test('an unknown page falls back to the homepage', async ({ page, context }, testInfo) => {
        await isolate(context);
        const errors = watchErrors(page);
        const res = await page.goto('/no-such-page-e2e');
        expect(res.status()).toBe(200);
        expect(res.headers()['cache-control']).toContain('no-store');
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator('main#mainpart h1').first()).toBeVisible();
        await shot(page, testInfo, 'unknown-route');
        expect(errors).toEqual([]);
    });

    test('a missing asset is a plain uncached 404, not the SPA shell', async ({ request }) => {
        const res = await request.get('/assets/no-such-chunk-e2e.js', { headers: { Accept: 'text/html' } });
        expect(res.status()).toBe(404);
        expect(res.headers()['cache-control']).toBe('no-store');
        expect(res.headers()['content-type']).toMatch(/^text\/plain/);
        expect(await res.text()).not.toContain('<html');
    });

    test('an unknown API path is a JSON 404', async ({ request }) => {
        const res = await request.get('/api/no-such-route-e2e', { headers: { Referer: 'http://localhost/' } });
        expect(res.status()).toBe(404);
        expect(res.headers()['cache-control']).toContain('no-store');
        expect(res.headers()['content-type']).toMatch(/json/);
    });
});
