#!/usr/bin/env node
// Security probes: black-box checks against the real servers, run offline.
//
//   pnpm run test:security        (node scripts/security-probes.mjs)
//
// Boots backend-server.js (fake keys, every upstream mocked by
// e2e/support/offline-fetch.mjs), the frontend app over dist/ (or a throwaway
// dist when none is built) and the edge-function harness, then asserts the
// behaviour the audits pinned down: per-client limiters answer 429 and stop
// upstream spend, the Referer gate, security headers and CSP, TRACE, the
// canonical map URL, whois misses as 404 + no-store, no-store on every error,
// client-address spoofing, upstream header hygiene, the edge limiter's IPv6
// grouping, the loopback-only default bind and a bad cron at boot.
//
// Ported from the audit-6 repro set (A6-01..08) and the 15-check regression of
// 2026-10-15; each test name carries its origin. Only behaviour present on the
// branch this file landed on (dev @ cc50a8e) is asserted strictly — checks that
// other in-flight branches tighten (405 for TRACE, smaller body caps) accept
// both the current and the tightened answer and say so in a TODO.
//
// Output: node:test report on stdout; a JSON summary of every probe request in
// e2e/.out/security-probes/ (E2E_OUT_DIR) for the CI artifact.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
    ROOT, PORTS, IPCHECKING_ENDPOINT, startBackend, startEdge, startFrontend, waitFor,
} from '../e2e/support/stack.mjs';

const OUT = path.resolve(ROOT, process.env.E2E_OUT_DIR || 'e2e/.out', 'security-probes');
fs.mkdirSync(OUT, { recursive: true });
const FETCH_LOG = path.join(OUT, 'backend-fetch.jsonl');
const EDGE_FETCH_LOG = path.join(OUT, 'edge-fetch.jsonl');
fs.writeFileSync(FETCH_LOG, '');
fs.writeFileSync(EDGE_FETCH_LOG, '');

const MAP_KEY = 'E2E_FAKE_MAPKEY_DO_NOT_LEAK';
const IPCHECKING_KEY = 'e2e-fake-ipchecking-key';
const B = `http://127.0.0.1:${PORTS.backend}`;
const F = `http://127.0.0.1:${PORTS.frontend}`;
const E = `http://127.0.0.1:${PORTS.edge}`;
const REF = { Referer: 'http://localhost/' };

// Every probe request, for the artifact.
const journal = [];

/** fetch without following redirects; returns { status, headers, text, ms }. */
const hit = async (url, init = {}) => {
    const started = performance.now();
    const res = await fetch(url, { redirect: 'manual', ...init });
    const text = await res.text();
    const out = { status: res.status, headers: res.headers, text, ms: Math.round(performance.now() - started) };
    journal.push({ method: init.method || 'GET', url, status: res.status, cacheControl: res.headers.get('cache-control'), ms: out.ms });
    return out;
};

/** Raw HTTP/1.1 request (fetch refuses TRACE / TRACK). */
const raw = (port, request) => new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () => socket.destroy(new Error('raw request timed out')));
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => {
        const [head, ...body] = data.split('\r\n\r\n');
        const status = Number(head.split(' ')[1]);
        journal.push({ method: request.split(' ')[0], url: `raw:${port}${request.split(' ')[1]}`, status });
        resolve({ status, head: head.toLowerCase(), body: body.join('\r\n\r\n') });
    });
    socket.on('error', reject);
    socket.write(request);
});

const fetchLog = (file = FETCH_LOG) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const countUpstream = (predicate, file) => fetchLog(file).filter(predicate).length;
const tally = (statuses) => statuses.reduce((acc, s) => ({ ...acc, [s]: (acc[s] || 0) + 1 }), {});
const randomAlnum = (n) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 62)]).join('');
const randomHex = (n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
// One distinct client per probe: the backend trusts X-Forwarded-For from
// loopback (TRUST_PROXY default), which is exactly how frontend-server.js names
// the visitor, so a direct request can pose as any client.
let clientSeq = 0;
const client = () => {
    clientSeq += 1;
    return `198.51.100.${clientSeq % 250 + 1}`;
};

let backend;
let edge;
let frontend;
let distDir;
let realDist = false;

before(async () => {
    realDist = fs.existsSync(path.join(ROOT, 'dist/index.html'));
    distDir = realDist ? path.join(ROOT, 'dist') : fs.mkdtempSync(path.join(os.tmpdir(), 'trustip-probe-dist-'));
    if (!realDist) {
        fs.writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><head><script>window.__probe=1</script></head><body>probe</body></html>');
    }
    backend = startBackend({
        logDir: OUT,
        env: {
            E2E_FETCH_LOG: FETCH_LOG,
            IPCHECKING_API_KEY: IPCHECKING_KEY,
            IPCHECKING_API_ENDPOINT: IPCHECKING_ENDPOINT,
            GOOGLE_MAP_API_KEY: MAP_KEY,
            // SP-15: an invalid pattern must not take the server down.
            DATASET_AUTO_UPDATE: 'true',
            DATASET_UPDATE_CRON: 'not-a-cron',
        },
    });
    edge = startEdge({ logDir: OUT, env: { E2E_FETCH_LOG: EDGE_FETCH_LOG, SITE_RATE_LIMIT: '20' } });
    frontend = await startFrontend({ distDir, port: PORTS.frontend });
    await waitFor(`${B}/api/configs`, { headers: REF, ok: (s) => s === 200 });
    await waitFor(`${E}/functions/v1/app/configs`, { headers: { 'CF-Connecting-IP': '192.0.2.250' }, ok: (s) => s === 200 });
});

after(async () => {
    await Promise.allSettled([backend?.stop(), edge?.stop(), frontend?.stop()]);
    if (!realDist && distDir) fs.rmSync(distDir, { recursive: true, force: true });
    fs.writeFileSync(path.join(OUT, 'requests.json'), JSON.stringify(journal, null, 1));
});

describe('SP-01 keyed IPCheck.ing proxies: per-client budget stops upstream spend (A6-01)', () => {
    const routes = [
        { name: 'invisibility', url: () => `${B}/api/invisibility?id=${randomAlnum(28)}`, upstream: /getpdresult/ },
        { name: 'dnsleaktest session', url: () => `${B}/api/dnsleaktest/session/${randomHex(32)}`, upstream: /dnsleaktest/ },
        { name: 'getuserinfo', url: () => `${B}/api/getuserinfo`, upstream: /userinfo/i, headers: { Authorization: 'Bearer x' } },
        {
            name: 'updateuserachievement', url: () => `${B}/api/updateuserachievement`, upstream: /achievement/i, method: 'PUT',
            headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' }, body: '{"achievement":"x"}',
        },
    ];
    for (const route of routes) {
        test(`${route.name}: 25 requests from one client → 20 reach the upstream, then 429 no-store`, async () => {
            const ip = client();
            const before = countUpstream((e) => e.host === new URL(IPCHECKING_ENDPOINT).host && route.upstream.test(e.url));
            const statuses = [];
            let last;
            for (let i = 0; i < 25; i += 1) {
                last = await hit(route.url(), {
                    method: route.method || 'GET',
                    headers: { ...REF, 'X-Forwarded-For': ip, ...route.headers },
                    body: route.body,
                });
                statuses.push(last.status);
            }
            const upstream = countUpstream((e) => e.host === new URL(IPCHECKING_ENDPOINT).host && route.upstream.test(e.url)) - before;
            assert.equal(statuses.filter((s) => s === 429).length, 5, `statuses ${JSON.stringify(tally(statuses))}`);
            assert.ok(statuses.slice(0, 20).every((s) => s !== 429), 'the first 20 are within budget');
            assert.equal(last.headers.get('cache-control'), 'no-store');
            assert.ok(upstream <= 20, `upstream hits ${upstream} must not exceed the 20/min budget`);
        });
    }
});

test('SP-02 github-stars: cache-busting queries do not multiply GitHub calls (A6-05)', async () => {
    const before = countUpstream((e) => e.host === 'api.github.com');
    const statuses = [];
    for (let i = 1; i <= 15; i += 1) statuses.push((await hit(`${B}/api/github-stars?n=${i}`, { headers: { ...REF, 'X-Forwarded-For': client() } })).status);
    assert.deepEqual(tally(statuses), { 200: 15 });
    assert.ok(countUpstream((e) => e.host === 'api.github.com') - before <= 1, 'at most one outbound call to api.github.com');
});

describe('SP-03 /api/map: one URL per place, the key never leaves (A6-03)', () => {
    const mapCalls = () => countUpstream((e) => e.host === 'maps.googleapis.com');
    const q = (query, ip = client()) => hit(`${B}/api/map?${query}`, { headers: { ...REF, 'X-Forwarded-For': ip } });

    test('the frontend shape is served (one billed call, long cache)', async () => {
        const before = mapCalls();
        const res = await q('latitude=35.7&longitude=139.7&language=en');
        assert.equal(res.status, 200);
        assert.match(res.headers.get('content-type') || '', /^image\//);
        assert.match(res.headers.get('cache-control') || '', /max-age=31536000/);
        assert.equal(mapCalls() - before, 1);
        const call = fetchLog().filter((e) => e.host === 'maps.googleapis.com').at(-1);
        assert.ok(!JSON.stringify(call).includes(MAP_KEY), 'fetch log redacts the key');
    });

    test('every other spelling is a 301 to the canonical URL with no upstream call', async () => {
        const cases = [
            ['latitude=35.689487&longitude=139.691711&language=en', 'latitude=35.7&longitude=139.7&language=en'],
            ['latitude=35.70000000&longitude=139.7&language=en', 'latitude=35.7&longitude=139.7&language=en'],
            ['latitude=35.7&longitude=139.7&language=en&CanvasMode=x1', 'latitude=35.7&longitude=139.7&language=en'],
            ['latitude=35.7&longitude=139.7&language=en&cb=1', 'latitude=35.7&longitude=139.7&language=en'],
            ['latitude=35.7&longitude=139.7&language=en&CanvasMode=Dark&cb=2', 'latitude=35.7&longitude=139.7&language=en&CanvasMode=Dark'],
        ];
        const before = mapCalls();
        for (const [query, canonical] of cases) {
            const res = await q(query);
            assert.equal(res.status, 301, query);
            assert.equal(res.headers.get('location'), `/api/map?${canonical}`, query);
            assert.ok(!res.text.includes(MAP_KEY) && !(res.headers.get('location') || '').includes(MAP_KEY));
        }
        assert.equal(mapCalls() - before, 0);
    });

    test('out-of-range coordinates are 400 no-store with no upstream call', async () => {
        const before = mapCalls();
        for (const query of ['latitude=999&longitude=139.7&language=en', 'latitude=35.7&longitude=-5000&language=en', 'latitude=x&longitude=1&language=en']) {
            const res = await q(query);
            assert.equal(res.status, 400, query);
            assert.equal(res.headers.get('cache-control'), 'no-store', query);
        }
        assert.equal(mapCalls() - before, 0);
    });

    test('20 cache-busting coordinates from one client cost zero billed calls', async () => {
        const ip = client();
        const before = mapCalls();
        const statuses = [];
        for (let i = 10; i < 30; i += 1) statuses.push((await q(`latitude=35.6894${i}&longitude=139.7&language=en`, ip)).status);
        assert.deepEqual(tally(statuses), { 301: 20 });
        assert.equal(mapCalls() - before, 0);
    });
});

describe('SP-04 Referer gate through the frontend proxy (A6-04)', () => {
    const allowed = [`http://localhost:${PORTS.frontend}/`, `http://127.0.0.1:${PORTS.frontend}/`, `http://[::1]:${PORTS.frontend}/`];
    const denied = [`http://127.0.0.2:${PORTS.frontend}/`, 'http://evil.example/', 'http://localhost.evil.example/', 'http://127.0.0.1.nip.io/', 'not a url', 'file:///etc/passwd'];
    for (const referer of allowed) {
        test(`allowed: ${referer}`, async () => {
            assert.equal((await hit(`${F}/api/configs`, { headers: { Referer: referer } })).status, 200);
        });
    }
    for (const referer of denied) {
        test(`denied: ${referer}`, async () => {
            const res = await hit(`${F}/api/configs`, { headers: { Referer: referer } });
            assert.equal(res.status, 403);
            assert.equal(res.headers.get('cache-control'), 'no-store');
        });
    }
    test('denied: no Referer at all', async () => {
        assert.equal((await hit(`${F}/api/configs`)).status, 403);
    });
});

describe('SP-05 /api/whois: a miss is 404 + no-store, never a cached 200 (A6-06, R-07)', () => {
    const w = (q) => hit(`${B}/api/whois?q=${encodeURIComponent(q)}`, { headers: { ...REF, 'X-Forwarded-For': client() } });
    for (const name of ['zz-probe-unregistered-7f3k9q.com', 'zz-probe-unregistered-7f3k9q.jp', 'zz-probe-unregistered-7f3k9q.de']) {
        test(`unregistered domain ${name} → 404 no-store`, async () => {
            const res = await w(name);
            assert.equal(res.status, 404, res.text);
            assert.equal(res.headers.get('cache-control'), 'no-store');
        });
    }
    test('unregistered AS → 404 no-store', async () => {
        const res = await w('AS4199999999');
        assert.equal(res.status, 404, res.text);
        assert.equal(res.headers.get('cache-control'), 'no-store');
    });
    test('invalid / private input → 400 no-store, without an upstream call', async () => {
        const before = fetchLog().length;
        for (const q of ['not a domain', '10.0.0.1', '']) {
            const res = await w(q);
            assert.equal(res.status, 400, q);
            assert.equal(res.headers.get('cache-control'), 'no-store', q);
        }
        assert.equal(fetchLog().length, before);
    });
    test('pathological input is rejected fast (ReDoS guard)', async () => {
        // ~6 KB keeps under Node's 16 KB header limit, so the handler's own guard answers.
        const res = await w(`${'a-'.repeat(3000)}!`);
        assert.equal(res.status, 400);
        assert.ok(res.ms < 1500, `answered in ${res.ms}ms`);
        // The R-07 shape: thousands of spaces ('+') before an ASN-looking tail.
        const spaces = await hit(`${B}/api/whois?q=${'+'.repeat(8000)}x`, { headers: { ...REF, 'X-Forwarded-For': client() } });
        assert.equal(spaces.status, 400);
        assert.ok(spaces.ms < 1500, `answered in ${spaces.ms}ms`);
    });
});

describe('SP-06 security headers and CSP on both servers (A6-08, R-10)', () => {
    const baseline = (res, label) => {
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff', label);
        assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', label);
        assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', label);
        assert.equal(res.headers.get('x-powered-by'), null, label);
    };
    const csp = (res) => res.headers.get('content-security-policy') || res.headers.get('content-security-policy-report-only');

    test('frontend page: baseline headers + a CSP with frame-ancestors and object-src none', async () => {
        const res = await hit(`${F}/`);
        assert.equal(res.status, 200);
        baseline(res, 'frontend /');
        const policy = csp(res);
        assert.ok(policy, 'a CSP header (enforced or Report-Only)');
        assert.match(policy, /frame-ancestors 'self'/);
        assert.match(policy, /object-src 'none'/);
        assert.match(policy, /script-src[^;]*'sha256-/, 'inline scripts allowed by hash, not unsafe-inline');
        assert.doesNotMatch(policy.match(/script-src[^;]*/)[0], /'unsafe-inline'/);
    });
    test('frontend /api answer: baseline headers', async () => {
        baseline(await hit(`${F}/api/configs`, { headers: REF }), 'frontend /api/configs');
    });
    test('backend /api answer: baseline headers', async () => {
        baseline(await hit(`${B}/api/configs`, { headers: REF }), 'backend /api/configs');
    });
    test('backend static page carries the same CSP as the frontend (needs dist/)', { skip: !fs.existsSync(path.join(ROOT, 'dist/index.html')) && 'dist/ not built' }, async () => {
        const res = await hit(`${B}/`);
        assert.equal(res.status, 200);
        baseline(res, 'backend /');
        assert.ok(csp(res), 'backend-served dist/ has a CSP too');
    });
});

describe('SP-07 TRACE / TRACK never echo the request', () => {
    // TODO(405-trace): a branch in flight answers TRACE/TRACK with 405 on both
    // servers. Once it is on dev, tighten `notEcho` to `status === 405`.
    const SENTINEL = `probe-${randomHex(12)}`;
    for (const [label, port] of [['frontend', () => PORTS.frontend], ['backend', () => PORTS.backend]]) {
        for (const method of ['TRACE', 'TRACK']) {
            for (const target of ['/', '/api/configs']) {
                test(`${label} ${method} ${target}`, async () => {
                    const res = await raw(port(), `${method} ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nReferer: http://localhost/\r\nCookie: session=${SENTINEL}\r\nX-Probe-Echo: ${SENTINEL}\r\nConnection: close\r\n\r\n`);
                    assert.ok(res.status >= 400 && res.status < 500, `4xx expected, got ${res.status}`);
                    assert.ok(!res.body.includes(SENTINEL) && !res.head.includes(SENTINEL), 'request headers must not be reflected');
                    assert.doesNotMatch(res.head, /content-type: message\/http/);
                });
            }
        }
    }
});

describe('SP-08 client-address spoofing through the frontend (R-03)', () => {
    test('rotating X-Forwarded-For / CF-Connecting-IP / X-Real-IP does not reset the per-client budget', async () => {
        const statuses = [];
        for (let i = 1; i <= 25; i += 1) {
            statuses.push((await hit(`${F}/api/invisibility?id=${randomAlnum(28)}`, {
                headers: { ...REF, 'X-Forwarded-For': `203.0.113.${i}`, 'CF-Connecting-IP': `192.0.2.${i}`, 'X-Real-IP': `198.18.0.${i}` },
            })).status);
        }
        assert.equal(statuses.filter((s) => s === 429).length, 5, JSON.stringify(tally(statuses)));
    });
    test('the upstream is told the socket peer, not the spoofed address', async () => {
        const seen = fetchLog().filter((e) => e.host === new URL(IPCHECKING_ENDPOINT).host && /getpdresult/.test(e.url)).at(-1);
        assert.ok(seen, 'an upstream call was recorded');
        assert.equal(seen.headers['x-forwarded-for'], '127.0.0.1');
    });
});

test('SP-09 upstream header hygiene: visitor cookies and made-up headers stay home (R-05)', async () => {
    const before = fetchLog().length;
    const res = await hit(`${B}/api/invisibility?id=${randomAlnum(28)}`, {
        headers: {
            ...REF, 'X-Forwarded-For': client(), Cookie: 'session=VICTIMCOOKIE', 'X-Evil': 'injected', 'CF-Connecting-IP': '7.7.7.7', Authorization: 'Bearer FIREBASE',
        },
    });
    assert.equal(res.status, 200);
    const calls = fetchLog().slice(before).filter((e) => e.host === new URL(IPCHECKING_ENDPOINT).host);
    assert.equal(calls.length, 1);
    const sent = Object.fromEntries(Object.entries(calls[0].headers).map(([k, v]) => [k.toLowerCase(), v]));
    for (const forbidden of ['cookie', 'x-evil', 'cf-connecting-ip']) assert.equal(sent[forbidden], undefined, `${forbidden} must not be forwarded`);
    // The visitor's own Firebase token is what the upstream authenticates with (by design).
    assert.equal(sent.authorization, 'Bearer FIREBASE');
    assert.ok(!calls[0].url.includes(IPCHECKING_KEY), 'the key is redacted from the log');
});

describe('SP-10 every error answer is no-store (R-09)', () => {
    const cases = [
        ['backend 400 ipinfo', () => `${B}/api/ipinfo?ip=bad`],
        ['backend 400 dossier', () => `${B}/api/dossier?ip=10.0.0.1`],
        ['backend 400 asn-profile', () => `${B}/api/asn-profile?asn=x`],
        ['backend 400 dnsresolver', () => `${B}/api/dnsresolver?hostname=..&type=A`],
        ['backend 404 unknown /api', () => `${B}/api/no-such-route`],
        ['frontend 404 unknown /api', () => `${F}/api/no-such-route`],
        ['frontend 403 no referer', () => `${F}/api/configs`, {}],
    ];
    for (const [label, url, headers] of cases) {
        test(label, async () => {
            const res = await hit(url(), { headers: headers ?? { ...REF, 'X-Forwarded-For': client() } });
            assert.ok(res.status >= 400 && res.status < 500, `${res.status}`);
            assert.equal(res.headers.get('cache-control'), 'no-store');
        });
    }
    test('frontend: a missing hashed asset is a 404 no-store text, not the SPA shell', async () => {
        const res = await hit(`${F}/assets/no-such-chunk.js`, { headers: { Accept: 'text/html' } });
        assert.equal(res.status, 404);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.ok(!res.text.includes('<html'));
    });
    test('frontend: a client route is the SPA shell, uncached', async () => {
        const res = await hit(`${F}/ip/8.8.8.8`, { headers: { Accept: 'text/html' } });
        assert.equal(res.status, 200);
        assert.match(res.headers.get('cache-control') || '', /no-store/);
    });
});

describe('SP-11 request body caps', () => {
    // TODO(body-caps): a branch in flight lowers per-route JSON caps. Today the
    // global express.json limit is 500kb; anything over it must be a 413, never a
    // 5xx or a 2xx. When the tighter caps land, add their per-route sizes here.
    test('a 600 KB JSON body is refused with 413 no-store', async () => {
        const body = JSON.stringify({ pad: 'x'.repeat(600 * 1024) });
        const res = await hit(`${B}/api/persona/evaluate`, {
            method: 'POST', headers: { ...REF, 'X-Forwarded-For': client(), 'Content-Type': 'application/json' }, body,
        });
        assert.equal(res.status, 413);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.ok(!/at .*\.js:\d+/.test(res.text), 'no stack trace in the body');
    });
    test('malformed JSON is a 400 without a stack trace', async () => {
        const res = await hit(`${B}/api/persona/evaluate`, {
            method: 'POST', headers: { ...REF, 'X-Forwarded-For': client(), 'Content-Type': 'application/json' }, body: '{"a":',
        });
        assert.equal(res.status, 400);
        assert.ok(!/at .*\.js:\d+/.test(res.text), 'no stack trace in the body');
    });
});

describe('SP-12 edge function limiter keys IPv6 clients by /56 (A6-02, R-08)', () => {
    const U = `${E}/functions/v1/app/configs`;
    const run = async (addresses, extra = {}) => {
        const statuses = [];
        for (const ip of addresses) statuses.push((await hit(U, { headers: { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...extra } })).status);
        return statuses;
    };
    const range = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

    test('one address: limited after 20', async () => {
        const s = await run(range(30, () => '2001:db8:a:1::1'));
        assert.equal(s.filter((x) => x === 429).length, 10, JSON.stringify(tally(s)));
    });
    test('30 addresses inside one /64: limited after 20', async () => {
        const s = await run(range(30, (i) => `2001:db8:b:1::${i.toString(16)}`));
        assert.equal(s.filter((x) => x === 429).length, 10, JSON.stringify(tally(s)));
    });
    test('30 /64s inside one /56: limited after 20', async () => {
        const s = await run(range(30, (i) => `2001:db8:c:1${i.toString(16).padStart(2, '0')}::1`));
        assert.equal(s.filter((x) => x === 429).length, 10, JSON.stringify(tally(s)));
    });
    test('30 distinct IPv4 clients: never limited', async () => {
        const s = await run(range(30, (i) => `198.51.100.${i + 100}`));
        assert.deepEqual(tally(s), { 200: 30 });
    });
    test('30 distinct /56s: never limited', async () => {
        const s = await run(range(30, (i) => `2001:db8:${(i + 256).toString(16)}:100::1`));
        assert.deepEqual(tally(s), { 200: 30 });
    });
    test('no CF-Connecting-IP: rotating X-Forwarded-For shares one bucket', async () => {
        const s = [];
        for (let i = 1; i <= 25; i += 1) s.push((await hit(U, { headers: { 'X-Forwarded-For': `203.0.113.${i}`, 'X-Real-IP': `203.0.113.${i}` } })).status);
        assert.ok(s.filter((x) => x === 429).length >= 5, JSON.stringify(tally(s)));
    });
    test('edge 429 / 4xx: no-store and security headers', async () => {
        const limited = await hit(U, { headers: { 'CF-Connecting-IP': '2001:db8:a:1::1' } });
        assert.equal(limited.status, 429);
        assert.equal(limited.headers.get('cache-control'), 'no-store');
        const bad = await hit(`${E}/functions/v1/app/ipsb?ip=bad`, { headers: { 'CF-Connecting-IP': '192.0.2.77' } });
        assert.equal(bad.status, 400);
        assert.equal(bad.headers.get('cache-control'), 'no-store');
        for (const res of [limited, bad]) {
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
            assert.ok(res.headers.get('x-frame-options'), 'x-frame-options present');
        }
    });
});

describe('SP-13 per-client limiters on metered routes (R-11)', () => {
    const burst = async (url, n) => {
        const ip = client();
        const s = [];
        for (let i = 0; i < n; i += 1) s.push((await hit(url, { headers: { ...REF, 'X-Forwarded-For': ip } })).status);
        return s;
    };
    for (const [route, url, max] of [
        ['whois (20/min)', `${B}/api/whois?q=AS4199999998`, 20],
        ['dossier (10/min)', `${B}/api/dossier?ip=8.8.4.4`, 10],
        ['trustscore (12/min)', `${B}/api/trustscore?ip=8.8.4.4`, 12],
    ]) {
        test(`${route}: request ${max + 1} is 429 no-store`, async () => {
            const s = await burst(url, max + 2);
            assert.ok(s.slice(0, max).every((x) => x !== 429), JSON.stringify(tally(s)));
            assert.deepEqual(s.slice(max), [429, 429]);
        });
    }
});

test('SP-14 backend binds loopback by default (R-12)', async () => {
    const { backendHost, DEFAULT_BACKEND_HOST } = await import('../common/backend-host.js');
    assert.equal(backendHost(''), DEFAULT_BACKEND_HOST);
    assert.equal(backendHost(undefined), '127.0.0.1');
    const external = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (!external) return;
    // The running backend must not answer on a non-loopback address.
    await assert.rejects(fetch(`http://${external.address}:${PORTS.backend}/api/configs`, { headers: REF, signal: AbortSignal.timeout(3000) }));
});

test('SP-15 an invalid DATASET_UPDATE_CRON does not take the server down (R-13)', async () => {
    // The backend under test booted with DATASET_UPDATE_CRON=not-a-cron.
    await new Promise((r) => setTimeout(r, 1000));
    assert.equal(backend.child.exitCode, null, 'backend still running');
    assert.equal((await hit(`${B}/api/configs`, { headers: REF })).status, 200);
    const log = fs.readFileSync(path.join(OUT, 'backend.log'), 'utf8');
    assert.match(log, /DATASET_UPDATE_CRON/, 'the bad pattern is reported in the log');
});
