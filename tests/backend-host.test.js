// common/backend-host.js — where the API listens and where the proxy finds it.
//
// The default must keep the API on loopback (a direct client would skip the
// proxy that writes X-Forwarded-For), and the proxy must target the same
// literal address rather than `localhost`, which can resolve to ::1 first.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';

import { backendHost, hostPort, DEFAULT_BACKEND_HOST } from '../common/backend-host.js';
import { apiProxyOptions } from '../common/frontend-proxy.js';

describe('backendHost', () => {
    it('defaults to 127.0.0.1 when BACKEND_HOST is unset or blank', () => {
        assert.equal(DEFAULT_BACKEND_HOST, '127.0.0.1');
        assert.equal(backendHost(undefined), '127.0.0.1');
        assert.equal(backendHost(''), '127.0.0.1');
        assert.equal(backendHost('   '), '127.0.0.1');
    });

    it('takes an explicit address, trimmed', () => {
        assert.equal(backendHost('0.0.0.0'), '0.0.0.0');
        assert.equal(backendHost(' ::  '), '::');
        assert.equal(backendHost('10.0.0.5'), '10.0.0.5');
    });
});

describe('hostPort', () => {
    it('brackets an IPv6 literal', () => {
        assert.equal(hostPort('127.0.0.1', 11966), '127.0.0.1:11966');
        assert.equal(hostPort('::1', 11966), '[::1]:11966');
    });
});

describe('wiring', () => {
    it('the frontend proxy targets 127.0.0.1, not localhost', () => {
        assert.equal(apiProxyOptions(11966).target, 'http://127.0.0.1:11966/api');
    });

    it('backend-server.js listens on BACKEND_HOST', () => {
        const src = fs.readFileSync(new URL('../backend-server.js', import.meta.url), 'utf8');
        assert.match(src, /backendHost\(process\.env\.BACKEND_HOST\)/);
        assert.match(src, /app\.listen\(backEndPort, backEndHost,/);
    });

    it('the Vite dev proxy targets 127.0.0.1', () => {
        const src = fs.readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
        assert.match(src, /'\/api': `http:\/\/127\.0\.0\.1:\$\{backEndPort\}`/);
    });
});
