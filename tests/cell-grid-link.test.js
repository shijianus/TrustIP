// CellGrid decides, per cell, whether it is a route in this app, a URL outside
// it, or plain text. An address in this app rendered as a bare `<a>` tears down
// the running page — with its measurements — to reach a route the router already
// holds, so that choice is pinned here, along with the collapse this widget has
// always done past six cells.
//
// The component's `<script setup>` is executed with its imports injected, the way
// tests/ip-calculator-query.test.js mounts its subject: no DOM, no new dependency.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { computed, ref } from 'vue';
import { parse } from 'vue/compiler-sfc';

const script = parse(readFileSync(
    new URL('../frontend/components/widgets/CellGrid.vue', import.meta.url),
    'utf8',
)).descriptor.scriptSetup.content.replace(/^import[\s\S]*?;$/gm, '');

// A sentinel standing in for the component `vue-router` exports: identity is the
// whole point — a route cell must be *this*, never the string 'a'.
const ROUTER_LINK = Symbol('RouterLink');

const mount = (items) => {
    const props = { items, empty: '' };
    const bindings = {
        ref,
        computed,
        defineProps: () => props,
        useI18n: () => ({ t: (key) => key }),
        RouterLink: ROUTER_LINK,
    };
    const setup = new Function(...Object.keys(bindings),
        `${script}\nreturn { cells, visible, open };`);
    return setup(...Object.values(bindings));
};

describe('CellGrid cell links', () => {
    it('routes an internal target through RouterLink, not an anchor', () => {
        const { cells } = mount([{ main: '203.0.113.49', sub: 'previous', to: '/ip/203.0.113.49' }]);
        assert.equal(cells.value[0].link.is, ROUTER_LINK);
        assert.deepEqual(cells.value[0].link.props, { to: '/ip/203.0.113.49' });
        assert.equal('href' in cells.value[0].link.props, false, 'a route cell grew an href');
    });

    it('keeps a URL outside this app a plain anchor', () => {
        const { cells } = mount([{ main: 'example.com', href: 'https://example.com' }]);
        assert.equal(cells.value[0].link.is, 'a');
        assert.deepEqual(cells.value[0].link.props, { href: 'https://example.com' });
    });

    it('leaves a value with no link as text', () => {
        const { cells } = mount([{ main: 'AS15169', sub: 'Google LLC' }]);
        assert.equal(cells.value[0].link.is, 'div');
        assert.deepEqual(cells.value[0].link.props, {});
    });

    // A caller that sets both has contradicted itself; the in-app reading is the
    // one that cannot reload the document.
    it('prefers the route when a cell carries both a route and a URL', () => {
        const { cells } = mount([{ main: 'x', to: '/ip/x', href: 'https://elsewhere.test/x' }]);
        assert.equal(cells.value[0].link.is, ROUTER_LINK);
    });

    it('still collapses past six cells and reveals the rest on the toggle', () => {
        const items = Array.from({ length: 8 }, (_, i) => ({ main: `198.51.100.${i}`, to: `/ip/198.51.100.${i}` }));
        const { cells, visible, open } = mount(items);
        // `visible` is the collapsed list and `cells` decorates it, so the two
        // must agree — the seventh cell is hidden behind the toggle, not gone.
        assert.equal(visible.value.length, 6, 'the first screen grew');
        assert.equal(cells.value.length, visible.value.length, 'cells and the list they wrap disagree');
        assert.ok(cells.value.every((cell) => cell.link.is === ROUTER_LINK), 'a collapsed route lost its link');
        open.value = true;
        assert.equal(visible.value.length, 8, 'the toggle revealed nothing');
        assert.equal(cells.value.length, 8, 'the hidden cells never arrived');
    });

    it('keeps the cell contents it was always handed', () => {
        const { cells } = mount([{ main: '192.0.2.7', sub: 'Block first', to: '/ip/192.0.2.7' }]);
        assert.equal(cells.value[0].main, '192.0.2.7');
        assert.equal(cells.value[0].sub, 'Block first');
    });
});
