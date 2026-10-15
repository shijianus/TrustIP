// Specs for frontend/data/cf-destinations.js — the Cloudflare check's edge table.
// A row only measures something if its host echoes `/cdn-cgi/trace` to a browser;
// these pin the hosts that were verified to (and the two that were verified not to).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { CF_DESTINATIONS, CF_PRIMARY_HOST } from '../frontend/data/cf-destinations.js';

const en = JSON.parse(readFileSync(new URL('../frontend/locales/en.json', import.meta.url), 'utf8'));
const lookup = (key) => key.split('.').reduce((node, k) => node?.[k], en);

describe('CF_DESTINATIONS', () => {
    it('has unique hosts and includes the primary host', () => {
        const hosts = CF_DESTINATIONS.map((d) => d.host);
        assert.equal(new Set(hosts).size, hosts.length);
        assert.ok(hosts.includes(CF_PRIMARY_HOST));
    });

    it('never lists a host that refuses or lacks the trace', () => {
        const hosts = CF_DESTINATIONS.map((d) => d.host);
        assert.ok(!hosts.includes('discord.com'), 'discord.com answers 403 to /cdn-cgi/trace');
        assert.ok(!hosts.includes('github.com'), 'github.com is not on Cloudflare');
        assert.ok(hosts.includes('gateway.discord.gg'));
    });

    it('covers the reference comparison: WARP/DNS, CDN and Workers networks', () => {
        const hosts = CF_DESTINATIONS.map((d) => d.host);
        for (const h of ['1.1.1.1', 'cdnjs.cloudflare.com', 'workers.cloudflare.com', 'speed.cloudflare.com']) assert.ok(hosts.includes(h), h);
    });

    it('labels every row with a key the en pack carries', () => {
        for (const d of CF_DESTINATIONS) assert.equal(typeof lookup(d.labelKey), 'string', d.labelKey);
    });
});
