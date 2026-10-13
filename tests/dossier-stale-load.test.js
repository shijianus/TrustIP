// The dossier page writes server evidence under whichever address is on screen.
// A neighbour link can move the page while the previous lookup is still running,
// and an `/api/dossier` call can take tens of seconds — so the older answer must
// not be allowed to land on the newer page, in either direction (result or error).
//
// The component's own `<script setup>` is executed with its imports injected, the
// way tests/ip-calculator-query.test.js mounts IpCalculator: the guard is tested
// where it lives, not in a copy of it.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { computed, ref } from 'vue';
import { parse } from 'vue/compiler-sfc';

const script = parse(readFileSync(
    new URL('../frontend/components/dossier/IpDossier.vue', import.meta.url),
    'utf8',
)).descriptor.scriptSetup.content.replace(/^import[\s\S]*?;$/gm, '');

// Only the address the evidence is about matters here; a real payload is huge.
const payload = (ip) => ({ ip, network: {}, slots: {} });

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const mountDossier = (fetchWithTimeout) => {
    const bindings = {
        ref,
        computed,
        watch: () => {},
        onMounted: () => {},
        useRoute: () => ({ params: {}, query: {} }),
        useRouter: () => ({ push: () => {} }),
        useI18n: () => ({ t: (key) => key, locale: { value: 'en' } }),
        useMainStore: () => ({ configs: { dossier: true } }),
        fetchWithTimeout,
        isValidIP: () => true,
        formatIsoDate: (v) => v,
    };
    const setup = new Function(...Object.keys(bindings),
        `${script}\nreturn { load, target, dossier, error, served };`);
    return setup(...Object.values(bindings));
};

// A fetch nobody can finish until the test says so, in whatever order it likes —
// which is the whole point: arrival order is not request order.
const held = () => {
    const calls = [];
    const fetchWithTimeout = (url) => new Promise((resolve, reject) => {
        calls.push({ url, resolve, reject });
    });
    return { calls, fetchWithTimeout };
};

describe('IpDossier load superseded by navigation', () => {
    it('writes the answer for the address the page is on', async () => {
        const { calls, fetchWithTimeout } = held();
        const page = mountDossier(fetchWithTimeout);
        page.target.value = '8.8.8.8';
        page.load('8.8.8.8');
        assert.match(calls[0].url, /ip=8\.8\.8\.8$/);
        calls[0].resolve({ ok: true, json: async () => payload('8.8.8.8') });
        await flush();
        assert.equal(page.dossier.value?.ip, '8.8.8.8', 'a normal load stopped writing');
        assert.equal(page.error.value, '');
    });

    // The regression: newest request resolves first (it is the one the neighbour
    // page needs, and the cache is warm for its block), then the stale request
    // finishes and used to claim the page.
    it('drops a dossier that arrives after the page moved on', async () => {
        const { calls, fetchWithTimeout } = held();
        const page = mountDossier(fetchWithTimeout);
        page.load('8.8.8.8');
        page.target.value = '8.8.8.9';
        page.load('8.8.8.9');
        assert.equal(calls.length, 2, 'the second address was never asked about');

        calls[1].resolve({ ok: true, json: async () => payload('8.8.8.9') });
        await flush();
        assert.equal(page.dossier.value?.ip, '8.8.8.9');

        calls[0].resolve({ ok: true, json: async () => payload('8.8.8.8') });
        await flush();
        assert.equal(page.dossier.value?.ip, '8.8.8.9', 'the superseded load overwrote the page');
        assert.equal(page.error.value, '', 'a discarded answer wrote an error anyway');
    });

    // A failed request that no longer belongs to the page is not this page's
    // failure, and must not paint its error banner.
    it('keeps a superseded failure off the new page', async () => {
        const { calls, fetchWithTimeout } = held();
        const page = mountDossier(fetchWithTimeout);
        page.load('8.8.8.8');
        page.target.value = '8.8.8.9';
        page.load('8.8.8.9');

        calls[0].reject(new Error('timeout'));
        await flush();
        assert.equal(page.error.value, '', 'a stale failure spoke on the new page');
        assert.equal(page.dossier.value, null);

        calls[1].resolve({ ok: true, json: async () => payload('8.8.8.9') });
        await flush();
        assert.equal(page.dossier.value?.ip, '8.8.8.9');
    });

    // The other side of the same coin: a failure on the address still displayed
    // is reported, not swallowed by the guard.
    it('still reports a failure for the address on screen', async () => {
        const { calls, fetchWithTimeout } = held();
        const page = mountDossier(fetchWithTimeout);
        page.target.value = '8.8.8.8';
        page.load('8.8.8.8');
        calls[0].reject(new Error('unavailable'));
        await flush();
        assert.equal(page.error.value, 'dossier.failed');
    });
});
