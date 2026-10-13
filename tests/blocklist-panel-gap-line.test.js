// The blocklist panel's two honest edges: which sentence a gap gets, and that a
// pass nobody answered about the address is never drawn as a clean sheet.
//
// The component's `<script setup>` runs here with its imports injected — the way
// tests/ip-calculator-query.test.js mounts its subject — so `t` returns the key it
// was handed and a wrong or missing key fails the run instead of reaching a reader.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { computed } from 'vue';
import { parse } from 'vue/compiler-sfc';

const script = parse(readFileSync(
    new URL('../frontend/components/dossier/BlocklistPanel.vue', import.meta.url),
    'utf8',
)).descriptor.scriptSetup.content.replace(/^import[\s\S]*?;$/gm, '');

const en = JSON.parse(readFileSync(new URL('../frontend/locales/en.json', import.meta.url), 'utf8'));
const dig = (path) => path.split('.').reduce((node, key) => node?.[key], en);

const mount = (blocklists, gapKey = '') => {
    const props = { blocklists, gapKey };
    const bindings = {
        computed,
        defineProps: () => props,
        useI18n: () => ({ t: (key) => key }),
    };
    const setup = new Function(...Object.keys(bindings),
        `${script}\nreturn { gapLine, headTone, headLabel, rows };`);
    return setup(...Object.values(bindings));
};

const zone = (id, status, extra = {}) => ({
    id, label: id, category: 'Spam', status, listed: status === 'listed',
    codes: status === 'listed' || status === 'policy' ? [{ address: '127.0.0.2' }] : [],
    ...extra,
});

describe('BlocklistPanel gap line', () => {
    it('says what a policy-only pass actually heard', () => {
        const panel = mount(null, 'policy-only');
        assert.equal(panel.gapLine.value, 'dossier.blocklists.rangePolicyNeeds');
    });

    // The generic line promises "a truthful recursor, and a zone that answers
    // about this family" — true of a blocked network, false of a pass whose zones
    // all answered about the range.
    it('leaves every other gap on the generic line', () => {
        for (const reason of ['', 'no-answer', 'no-ipv6-zone', 'no-trustworthy-resolver', 'unparseable']) {
            assert.equal(mount(null, reason).gapLine.value, 'dossier.blocklists.needs', `${reason}: grew its own sentence`);
        }
    });

    it('ships copy for both lines it can render', () => {
        for (const key of ['dossier.blocklists.needs', 'dossier.blocklists.rangePolicyNeeds']) {
            assert.ok(dig(key), `${key} has no copy in en`);
        }
        assert.match(dig('dossier.blocklists.rangePolicyNeeds'), /range/i);
        // …and the two must not be the same sentence, or the branch is decoration.
        assert.notEqual(dig('dossier.blocklists.rangePolicyNeeds'), dig('dossier.blocklists.needs'));
    });
});

describe('BlocklistPanel verdict', () => {
    // A policy-only summary looks, to the head chip, exactly like a pass nobody
    // answered — which is the point: the range's rules say nothing about this
    // address, in either direction.
    it('draws a policy-only pass as not measured, never as clean', () => {
        const panel = mount({ zones: 4, answered: 0, listed: 0, botnet: 0, policy: 4, results: [] });
        assert.equal(panel.headTone.value, 'muted');
        assert.equal(panel.headLabel.value, 'trustip.verdict.notMeasured');
    });

    it('keeps a cleared pass reading as cleared', () => {
        const panel = mount({ zones: 4, answered: 4, listed: 0, botnet: 0, policy: 0, results: [] });
        assert.equal(panel.headTone.value, 'ok');
        assert.equal(panel.headLabel.value, 'dossier.blocklists.clean');
    });

    it('labels each row by what its zone said, code included for the two that answered', () => {
        const panel = mount({
            zones: 4,
            answered: 2,
            listed: 1,
            botnet: 0,
            policy: 1,
            results: [
                zone('zen', 'listed'),
                zone('psbl', 'clean'),
                zone('policy-bl', 'policy'),
                zone('silent-bl', 'timeout'),
            ],
        });
        const byId = Object.fromEntries(panel.rows.value.map((row) => [row.id, row]));
        assert.equal(byId.zen.tone, 'bad');
        assert.equal(byId.zen.verdict, 'dossier.blocklists.listed');
        assert.equal(byId.zen.code, '127.0.0.2');
        assert.equal(byId.psbl.tone, 'ok');
        assert.equal(byId.psbl.code, null, 'a clean row invented a code');
        assert.equal(byId['policy-bl'].tone, 'info');
        assert.equal(byId['policy-bl'].verdict, 'dossier.blocklists.rangePolicy');
        assert.equal(byId['policy-bl'].code, '127.0.0.2', 'a policy row lost the code that makes it attributable');
        assert.equal(byId['silent-bl'].tone, 'muted');
        assert.equal(byId['silent-bl'].verdict, 'trustip.verdict.notMeasured');
    });
});
