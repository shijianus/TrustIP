// Tests for the flat route rail (frontend/data/rail.js) — the single list the
// header row, the router and App.vue's chrome switch all read. The value is in
// the registry agreeing with itself and with the tool / section registries it
// points at: a rail item that names a slug nobody registers, or a section page
// with no component, is a dead link you only find by clicking it.
//
// Rendering (labels, the breakpoint, the scroll strip) is out of scope for the
// Node runner — see frontend/AGENTS.md.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';

import {
  RAIL_ITEMS,
  RAIL_BY_PATH,
  RAIL_BY_TOOL,
  RAIL_PAGE_ITEMS,
  RAIL_SECTION_PAGES,
  SECTION_PAGE_BY_ID,
  STANDALONE_RAIL_NAMES,
  resolveRail,
  resolveRailTarget,
} from '../frontend/data/rail.js';
import { TOOL_BY_SLUG } from '../frontend/data/tools.js';
import { SECTION_IDS } from '../frontend/data/sections.js';
import { FULL_LOCALE_CODES } from '../common/locale-registry.js';

const localesDir = new URL('../frontend/locales/', import.meta.url);
const readPack = (code) => JSON.parse(fs.readFileSync(new URL(`${code}.json`, localesDir), 'utf8'));

describe('RAIL_ITEMS', () => {
  it('is the rail in order, one page per tool', () => {
    assert.deepEqual(RAIL_ITEMS.map((item) => item.path), [
      '/', '/ipinfo', '/ip', '/link', '/webrtc', '/dns', '/speedtest',
      '/ping', '/status', '/whois', '/tools',
    ]);
  });

  it('has unique ids, unique paths and a destination for every item', () => {
    const ids = RAIL_ITEMS.map((item) => item.id);
    const paths = RAIL_ITEMS.map((item) => item.path);
    assert.deepEqual(new Set(ids).size, ids.length, 'duplicate rail id');
    assert.deepEqual(new Set(paths).size, paths.length, 'duplicate rail path');
    for (const item of RAIL_ITEMS) {
      assert.ok(item.path.startsWith('/'), `${item.id}: rail paths are absolute`);
      // `ip` is the one destination this file links without owning: the dossier
      // page registers its own route.
      assert.ok(item.section || item.tool || item.id === 'ip' || item.path === '/',
        `${item.id}: a rail item is a section page, a tool alias, or documented as neither`);
    }
  });

  it('names only tools the registry has, and only ones with a standalone page', () => {
    for (const item of RAIL_ITEMS.filter((entry) => entry.tool)) {
      const tool = TOOL_BY_SLUG.get(item.tool);
      assert.ok(tool, `${item.id}: tool slug "${item.tool}" is not in data/tools.js`);
      assert.ok(!tool.noStandalone,
        `${item.id}: ${item.tool} is noStandalone, so /${item.path.replace('/', '')} would bounce home`);
    }
  });

  it('names only sections that have a page component, and no section on `/`', () => {
    assert.equal(RAIL_BY_PATH.get('/').section, undefined,
      'the homepage hosts no section now that each one has its own page');
    for (const item of RAIL_ITEMS.filter((entry) => entry.section)) {
      assert.ok(SECTION_IDS.includes(item.section),
        `${item.id}: ${item.section} is not a section any component renders`);
      assert.ok(SECTION_PAGE_BY_ID.has(item.section),
        `${item.id}: ${item.section} has no standalone page to route to`);
    }
  });
});

describe('RAIL_SECTION_PAGES', () => {
  it('covers every section the rail sends to its own page, and nothing else', () => {
    const routed = RAIL_ITEMS
      .filter((item) => item.section && item.path !== '/')
      .map((item) => item.section)
      .sort();
    assert.deepEqual(RAIL_SECTION_PAGES.map((page) => page.section).sort(), routed);
  });

  it('gives each page its head copy and a well-formed boot command', () => {
    for (const page of RAIL_SECTION_PAGES) {
      // The component lives in StandaloneSection.vue, not here: this module is
      // also read by the router, App.vue and this spec, none of which resolves
      // a `.vue` path.
      assert.equal(page.component, undefined, `${page.section}: no component in the registry`);
      assert.match(page.titleKey, /\.[A-Z]/, `${page.section}: titleKey is an i18n path`);
      assert.match(page.noteKey, /\.[A-Z]/, `${page.section}: noteKey is an i18n path`);
      if (page.boot) assert.match(page.boot.command, /^[a-z]+:[a-z]+$/, `${page.section}: boot names a command`);
    }
  });
});

describe('resolveRail()', () => {
  it('lights the home item on the dashboard, whatever the path is asked alone', () => {
    assert.equal(resolveRail('/').path, '/');
  });

  it('lights the item whose route is current', () => {
    assert.equal(resolveRail('/ipinfo').id, 'ipinfo');
    assert.equal(resolveRail('/link').id, 'link');
    assert.equal(resolveRail('/webrtc').id, 'webrtc');
    assert.equal(resolveRail('/dns').id, 'dns');
    assert.equal(resolveRail('/speedtest').id, 'speedtest');
    assert.equal(resolveRail('/tools').id, 'tools');
    assert.equal(resolveRail('/whois').id, 'whois');
  });

  it('treats a tool alias and the canonical /tools/:slug as one destination', () => {
    assert.equal(resolveRail('/ping').id, 'ping');
    assert.equal(resolveRail('/tools/pingtest').id, 'ping');
    assert.equal(resolveRail('/status').id, 'status');
    assert.equal(resolveRail('/tools/servicestatus').id, 'status');
  });

  it('keeps a parameterised page under its rail root', () => {
    assert.equal(resolveRail('/ip/203.0.113.7').id, 'ip');
    assert.equal(resolveRail('/ip').id, 'ip');
  });

  it('returns nothing for a page the rail does not carry', () => {
    assert.equal(resolveRail('/privacy'), null);
    assert.equal(resolveRail('/r/abcdefghijklmnopqrstuv'), null);
    assert.equal(resolveRail('/tools/nosuchtool'), null);
  });
});

describe('resolveRailTarget()', () => {
  it('links every item to its own page, on every route', () => {
    for (const item of RAIL_ITEMS) {
      assert.deepEqual(resolveRailTarget(item), { path: item.path },
        `${item.id}: the rail is navigation, not a scroll list`);
      assert.equal(resolveRailTarget(item).hash, undefined,
        `${item.id}: no fragment — sections are pages now, not anchors on /`);
    }
  });
});

describe('STANDALONE_RAIL_NAMES', () => {
  it('lists every rail destination that renders its own header', () => {
    assert.deepEqual(STANDALONE_RAIL_NAMES, RAIL_PAGE_ITEMS.map((item) => item.id));
    assert.ok(!STANDALONE_RAIL_NAMES.includes('home'), 'the dashboard keeps the fixed Nav');
    assert.ok(!STANDALONE_RAIL_NAMES.includes('ip'), 'until its route lands, /ip is the dashboard');
    assert.deepEqual(RAIL_PAGE_ITEMS.map((item) => item.id), [
      'ipinfo', 'link', 'webrtc', 'dns', 'speedtest', 'ping', 'status', 'whois', 'tools',
    ]);
  });
});

describe('rail lookups', () => {
  it('index every backed item without dropping one', () => {
    assert.equal(RAIL_BY_PATH.size, RAIL_ITEMS.length);
    assert.equal(RAIL_BY_TOOL.size, RAIL_ITEMS.filter((item) => item.tool).length);
  });
});

describe('rail labels', () => {
  it('every rail id has a full and a short label in every full locale', () => {
    for (const code of FULL_LOCALE_CODES) {
      const pack = readPack(code);
      assert.ok(pack.rail, `${code}.json has no rail namespace`);
      for (const item of RAIL_ITEMS) {
        for (const variant of ['full', 'short']) {
          const value = pack.rail[variant]?.[item.id];
          assert.equal(typeof value, 'string', `${code}.json: rail.${variant}.${item.id} missing`);
          assert.ok(value.trim().length > 0, `${code}.json: rail.${variant}.${item.id} is empty`);
        }
      }
    }
  });

  it('only two label variants, so the packs cannot grow a third silently', () => {
    const pack = readPack('en');
    assert.deepEqual(Object.keys(pack.rail).sort(), ['full', 'short']);
    for (const variant of ['full', 'short']) {
      assert.deepEqual(Object.keys(pack.rail[variant]), RAIL_ITEMS.map((item) => item.id),
        `rail.${variant} keys must follow the rail order`);
    }
  });
});
