// Icons never leave the bundle: every Iconify prefix the frontend names is
// answered by frontend/utils/iconify-offline.js, every ri / simple-icons / bxl
// glyph is present in the vendored subset, and the CSP names no Iconify API host.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { pickIcons, OFFLINE_PREFIXES } from '../frontend/utils/iconify-offline.js';

const root = new URL('../', import.meta.url).pathname;
const walk = (dir) => fs.readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return fs.statSync(p).isDirectory() ? walk(p) : /\.(vue|js)$/.test(f) ? [p] : [];
});
const sources = [...walk(path.join(root, 'frontend/components')), ...walk(path.join(root, 'frontend/composables')),
  path.join(root, 'frontend/store.js')];
const subset = JSON.parse(fs.readFileSync(path.join(root, 'frontend/data/iconify-subset.json'), 'utf8'));

describe('iconify offline', () => {
  it('every literal prefix:name icon in components is a bundled prefix', () => {
    const seen = new Set();
    for (const file of sources) {
      const src = fs.readFileSync(file, 'utf8');
      if (!/@iconify\/vue|icon:\s*'/.test(src)) continue;
      for (const m of src.matchAll(/(?:icon=|icon:\s*)["'`]([a-z0-9-]+):([a-z0-9-]+)["'`]/g)) seen.add(m[1]);
    }
    for (const p of seen) assert.ok(OFFLINE_PREFIXES.includes(p), `prefix ${p} not bundled`);
  });
  it('every ri / simple-icons / bxl glyph named in source is in the subset', () => {
    for (const file of [...sources]) {
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/["'`](ri|simple-icons|bxl):([a-z0-9-]+)["'`]/g)) {
        const set = subset.find((s) => s.prefix === m[1]);
        assert.ok(set && (set.icons[m[2]] || set.aliases?.[m[2]]), `${m[1]}:${m[2]} missing (${path.basename(file)})`);
      }
    }
  });
  it('pickIcons returns only requested icons, resolving aliases', () => {
    const set = { prefix: 'x', width: 24, icons: { a: { body: '<a/>' }, b: { body: '<b/>' } }, aliases: { c: { parent: 'a' } } };
    const out = pickIcons(set, ['b', 'c', 'zz']);
    assert.deepEqual(Object.keys(out.icons).sort(), ['a', 'b']);
    assert.deepEqual(out.aliases, { c: { parent: 'a' } });
    assert.equal(out.width, 24);
    assert.equal(pickIcons(null, ['a']), null);
  });
  it('CSP does not allow the Iconify API hosts', async () => {
    const src = fs.readFileSync(path.join(root, 'common/csp.js'), 'utf8');
    assert.doesNotMatch(src, /api\.iconify\.design|api\.simplesvg\.com|api\.unisvg\.com/);
  });
});
