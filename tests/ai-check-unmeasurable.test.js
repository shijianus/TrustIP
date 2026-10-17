// A row of the AI check that ended without an address must say so with a
// "cannot be measured" chip, and a row still waiting must not: the chip is the
// line between "still checking" and "this exit could not be measured".
//
// The template is parsed with vue/compiler-sfc (no DOM, no new dependency) and
// the branch that renders when a row has no address is inspected directly.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parse } from 'vue/compiler-sfc';

import { FULL_LOCALE_CODES } from '../common/locale-registry.js';
import { EGRESS_STATE } from '../frontend/composables/use-ai-egress.js';

const source = readFileSync(
    new URL('../frontend/components/advanced-tools/AiCheck.vue', import.meta.url),
    'utf8',
);
const template = parse(source).descriptor.template.ast;

// Depth-first walk over element nodes (type 1).
const walk = (node, visit) => {
    if (node.type === 1) visit(node);
    for (const child of node.children ?? []) walk(child, visit);
};
const attr = (node, name) => node.props.find((p) =>
    (p.type === 6 && p.name === name) || (p.type === 7 && p.arg?.content === name));
const directive = (node, name) => node.props.find((p) => p.type === 7 && p.name === name && !p.arg);

const chips = [];
walk(template, (node) => {
    if (node.tag !== 'VerdictChip') return;
    const label = attr(node, 'label');
    if (label?.exp?.content?.includes('aiCheck.Unmeasurable')) chips.push(node);
});

describe('AiCheck "cannot be measured" chip', () => {
    it('is rendered exactly once, for rows without an address', () => {
        assert.equal(chips.length, 1);
    });

    it('is hidden while the row is still pending', () => {
        const guard = directive(chips[0], 'if');
        assert.ok(guard, 'the chip carries a v-if');
        assert.match(guard.exp.content, /row\.state\s*!==\s*EGRESS_STATE\.pending/);
        // The guard keys off the exported state names, so a rename breaks here.
        assert.equal(EGRESS_STATE.pending, 'pending');
    });

    it('uses the muted tone, never a pass or fail colour', () => {
        assert.equal(attr(chips[0], 'tone')?.value?.content, 'muted');
    });

    it('has a translation in every full locale', () => {
        for (const code of FULL_LOCALE_CODES) {
            const pack = JSON.parse(readFileSync(new URL(`../frontend/locales/${code}.json`, import.meta.url), 'utf8'));
            const value = pack?.aiCheck?.Unmeasurable;
            assert.equal(typeof value, 'string', `${code} aiCheck.Unmeasurable`);
            assert.ok(value.trim().length > 0, `${code} aiCheck.Unmeasurable is empty`);
        }
    });
});
