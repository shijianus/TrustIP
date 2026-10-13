// The badge a declared capability gap shows, and the rule that a state this
// widget has never heard of must not reach the reader as a locale key path.
//
// The component's `<script setup>` is executed here with its imports injected —
// the way tests/ip-calculator-query.test.js does it — so there is no DOM and no
// new dependency. `t` returns the key it was handed, which is what makes a leaked
// key path show up as a failing assertion instead of a string on the page.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { computed } from 'vue';
import { parse } from 'vue/compiler-sfc';

import { capabilityBadge } from '../frontend/composables/use-status-tone.js';

const slotSource = readFileSync(
    new URL('../frontend/components/widgets/CapabilitySlot.vue', import.meta.url),
    'utf8',
);
const script = parse(slotSource).descriptor.scriptSetup.content.replace(/^import[\s\S]*?;$/gm, '');

const en = JSON.parse(readFileSync(new URL('../frontend/locales/en.json', import.meta.url), 'utf8'));
const dig = (path) => path.split('.').reduce((node, key) => node?.[key], en);

// `state` is the only prop these assertions read; `rows` says whether the caller
// handed the section real rows to render.
const mount = (state, { rows = 0 } = {}) => {
    const props = { title: 'Section', state, note: 'a note', needs: '', to: null, cta: '', missing: [] };
    const bindings = {
        computed,
        defineProps: () => props,
        useSlots: () => ({ default: rows ? () => new Array(rows).fill({}) : undefined }),
        useI18n: () => ({ t: (key) => key }),
        capabilityBadge,
    };
    const setup = new Function(...Object.keys(bindings),
        `${script}\nreturn { badgeTone, badgeLabel, hasRows };`);
    return setup(...Object.values(bindings));
};

describe('capabilityBadge()', () => {
    it('keeps the three declared states on their own claim', () => {
        assert.deepEqual(capabilityBadge('delegated'), { tone: 'info', labelKey: 'dossier.slot.badge.delegated' });
        assert.deepEqual(capabilityBadge('partial'), { tone: 'warn', labelKey: 'dossier.slot.badge.partial' });
        assert.deepEqual(capabilityBadge('placeholder'), { tone: 'muted', labelKey: 'dossier.slot.badge.placeholder' });
    });

    // `ready` is the realistic unknown: a later build that promotes a slot to
    // measured would otherwise dress an unwired section up as a measured one.
    it('reads every state outside the three as the conservative gap claim', () => {
        const fallback = capabilityBadge('placeholder');
        for (const state of ['ready', 'measured', '', ' ', 'Delegated', null, undefined]) {
            assert.deepEqual(capabilityBadge(state), fallback, `${String(state)}: not the conservative badge`);
        }
    });
});

describe('CapabilitySlot badge', () => {
    it('labels the three states with keys the reference pack carries', () => {
        const expected = [
            ['delegated', 'dossier.slot.badge.delegated', 'info'],
            ['partial', 'dossier.slot.badge.partial', 'warn'],
            ['placeholder', 'dossier.slot.badge.placeholder', 'muted'],
        ];
        for (const [state, key, tone] of expected) {
            const slot = mount(state);
            assert.equal(slot.badgeLabel.value, key, `${state}: wrong badge key`);
            assert.equal(slot.badgeTone.value, tone, `${state}: wrong badge tone`);
            assert.ok(dig(key), `${key} has no copy in en — it would render as its own path`);
        }
    });

    // The bug this pins: a section whose server-declared state the widget does
    // not know printed `dossier.slot.badge.ready` where the reader should have
    // seen "Not measured".
    it('never prints a key path for a state it does not know', () => {
        for (const state of ['ready', 'measured', '', null, undefined]) {
            const slot = mount(state);
            assert.equal(slot.badgeLabel.value, 'dossier.slot.badge.placeholder',
                `${String(state)}: the unknown state leaked its own name into the label`);
            assert.equal(slot.badgeTone.value, 'muted');
        }
    });

    // A badge fallback must not cost the reader data: rows handed to a section
    // that arrived with an unrecognised state still render.
    it('keeps the caller rows that a fallback would otherwise swallow', () => {
        assert.equal(mount('ready', { rows: 3 }).hasRows.value, true);
        assert.equal(mount('partial', { rows: 2 }).hasRows.value, true);
        // Every existing caller passes no rows at all, so nothing changes for them.
        for (const state of ['placeholder', 'delegated', 'ready']) {
            assert.equal(mount(state).hasRows.value, false, `${state}: a caller-less gap grew rows`);
        }
    });
});
