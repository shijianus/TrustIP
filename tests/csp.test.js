// The SPA's Content-Security-Policy (common/csp.js) and how frontend-server's
// app sends it (common/frontend-app.js): Report-Only by default, enforcing with
// CSP_ENFORCE=1, inline scripts allowed by hash only, and the configured docs /
// auth origins added only when they are real https origins.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
    buildCsp, cspHeaderName, httpsOriginOf, inlineScriptHashes, inlineScriptHashesOf,
} from '../common/csp.js';
import { createFrontendApp } from '../common/frontend-app.js';

const sha = (text) => `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
const directive = (policy, name) => policy.split('; ').find((part) => part.startsWith(`${name} `)) || '';

describe('csp.js httpsOriginOf', () => {
    it('reduces a URL or a bare host to its https origin', () => {
        assert.equal(httpsOriginOf('https://docs.example.com/path/'), 'https://docs.example.com');
        assert.equal(httpsOriginOf('trustip-demo.firebaseapp.com'), 'https://trustip-demo.firebaseapp.com');
    });

    it('drops empty, unparseable and non-https values', () => {
        for (const value of [undefined, null, '', '   ', 'http://docs.example.com', 'javascript:alert(1)', 'https://']) {
            assert.equal(httpsOriginOf(value), '', String(value));
        }
    });
});

describe('csp.js inlineScriptHashes', () => {
    it('hashes the exact text of each inline script and skips src scripts', () => {
        const a = "\n  window.a = 1;\n";
        const html = `<script>${a}</script><script type="module" crossorigin src="/assets/x.js"></script>`
            + '<script>b()</script><script>b()</script>';
        assert.deepEqual(inlineScriptHashes(html), [sha(a), sha('b()')]);
    });

    it('returns none for a missing index.html', () => {
        assert.deepEqual(inlineScriptHashesOf('/nonexistent/index.html'), []);
    });
});

describe('csp.js buildCsp', () => {
    it('is self-only by default, with the app\'s known third parties', () => {
        const policy = buildCsp({ scriptHashes: ["'sha256-abc'"] });
        assert.equal(directive(policy, 'default-src'), "default-src 'self'");
        assert.equal(directive(policy, 'script-src'),
            "script-src 'self' 'sha256-abc' https://www.googletagmanager.com https://apis.google.com https://proxydetectjs.ipcheck.ing");
        assert.equal(directive(policy, 'connect-src'), "connect-src 'self' https:");
        assert.equal(directive(policy, 'img-src'), "img-src 'self' data: blob: https:");
        assert.equal(directive(policy, 'frame-src'), "frame-src 'self'");
        assert.equal(directive(policy, 'object-src'), "object-src 'none'");
        assert.equal(directive(policy, 'frame-ancestors'), "frame-ancestors 'self'");
        assert.doesNotMatch(policy, /unsafe-eval/);
        assert.doesNotMatch(directive(policy, 'script-src'), /unsafe-inline/);
        assert.doesNotMatch(policy, /report-uri/);
    });

    it('adds the docs and Firebase auth origins when configured', () => {
        const policy = buildCsp({
            env: {
                VITE_DOCS_URL: 'https://docs.example.com/',
                VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
                CSP_REPORT_URI: 'https://reports.example.com/csp',
            },
        });
        assert.match(directive(policy, 'script-src'), / https:\/\/docs\.example\.com$/);
        assert.equal(directive(policy, 'frame-src'), "frame-src 'self' https://docs.example.com https://demo.firebaseapp.com");
        assert.equal(directive(policy, 'report-uri'), 'report-uri https://reports.example.com/csp');
    });

    it('a non-https docs URL adds nothing', () => {
        assert.equal(buildCsp({ env: { VITE_DOCS_URL: 'http://docs.example.com' } }), buildCsp());
    });
});

describe('csp.js cspHeaderName', () => {
    it('reports unless CSP_ENFORCE is 1 or true', () => {
        assert.equal(cspHeaderName({}), 'Content-Security-Policy-Report-Only');
        assert.equal(cspHeaderName({ CSP_ENFORCE: '' }), 'Content-Security-Policy-Report-Only');
        assert.equal(cspHeaderName({ CSP_ENFORCE: '0' }), 'Content-Security-Policy-Report-Only');
        assert.equal(cspHeaderName({ CSP_ENFORCE: '1' }), 'Content-Security-Policy');
        assert.equal(cspHeaderName({ CSP_ENFORCE: 'TRUE' }), 'Content-Security-Policy');
    });
});

describe('frontend app sends the policy', () => {
    const inline = "document.documentElement.setAttribute('data-booting', '');";
    let dist;
    const servers = [];
    const start = (env) => new Promise((resolve) => {
        const server = createFrontendApp({ distDir: dist, backEndPort: 1, env })
            .listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
        servers.push(server);
    });

    before(() => {
        dist = mkdtempSync(path.join(tmpdir(), 'trustip-csp-'));
        writeFileSync(path.join(dist, 'index.html'),
            `<!doctype html><script>${inline}</script><script type="module" src="/assets/i.js"></script>`);
    });
    after(() => {
        for (const server of servers) server.close();
        rmSync(dist, { recursive: true, force: true });
    });

    it('as Report-Only by default, with the built inline script hashed', async () => {
        const base = await start({});
        const res = await fetch(`${base}/tools/whois`, { headers: { accept: 'text/html' } });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('content-security-policy'), null);
        const policy = res.headers.get('content-security-policy-report-only');
        assert.ok(policy, 'Report-Only header present');
        assert.ok(directive(policy, 'script-src').includes(sha(inline)));
    });

    it('as an enforcing header with CSP_ENFORCE=1', async () => {
        const base = await start({ CSP_ENFORCE: '1' });
        const res = await fetch(`${base}/`);
        assert.equal(res.headers.get('content-security-policy-report-only'), null);
        assert.ok(res.headers.get('content-security-policy'));
    });
});
