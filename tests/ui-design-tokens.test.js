// Guards for the design tokens in frontend/style/style.css: the colour pairs
// the app actually draws must keep WCAG AA contrast in BOTH themes, the
// keyboard focus indicator must stay visible, and the uikit.* strings the
// shared primitives (ui/empty-state, ui/tool-loading-skeleton) read must exist
// in every shipped locale. A token tweak that quietly drops a pair below
// 4.5:1 fails here instead of in front of a low-vision visitor.
//
// The colour maths is the CSS Color 4 OKLCH -> OKLab -> linear sRGB path plus
// `color-mix(in oklab, …)`, which is exactly how the -soft / -soft-fg pairs
// are declared. Rendering itself is out of scope for the Node runner.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import { FULL_LOCALE_CODES } from '../common/locale-registry.js';

const css = fs.readFileSync(new URL('../frontend/style/style.css', import.meta.url), 'utf8');

const blockOf = (selector) => {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `${selector} block present`);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
};
const varsOf = (block) => Object.fromEntries(
  [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]),
);
const LIGHT = varsOf(blockOf(':root'));
const DARK = { ...LIGHT, ...varsOf(blockOf('.dark')) };

const oklabToLinear = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};
const linearToOklab = ([r, g, b]) => {
  const cbrt = (x) => Math.sign(x) * Math.abs(x) ** (1 / 3);
  const l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

// Returns OKLab for a token value (alpha is ignored: every pair below is opaque).
const resolve = (value, theme) => {
  const v = value.trim();
  let m = v.match(/^var\(--([\w-]+)\)$/);
  if (m) return resolve(theme[m[1]], theme);
  m = v.match(/^oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (m) {
    const [L, C, h] = m.slice(1).map(Number);
    return [L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)];
  }
  m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const rgb = [0, 2, 4].map((i) => srgbToLinear(parseInt(m[1].slice(i, i + 2), 16) / 255));
    return linearToOklab(rgb);
  }
  m = v.match(/^color-mix\(in oklab,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/);
  if (m) {
    const p = Number(m[2]) / 100;
    const a = resolve(m[1], theme);
    const b = resolve(m[3], theme);
    return a.map((x, i) => x * p + b[i] * (1 - p));
  }
  throw new Error(`unparsed colour: ${v}`);
};
const luminance = (lab) => {
  const [r, g, b] = oklabToLinear(lab).map((x) => Math.min(1, Math.max(0, x)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (fg, bg, theme) => {
  const [hi, lo] = [luminance(resolve(theme[fg], theme)), luminance(resolve(theme[bg], theme))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// fg, bg, minimum. 4.5 = WCAG 1.4.3 body text; 3 = 1.4.11 non-text (focus ring).
const PAIRS = [
  ['foreground', 'page-bg', 4.5], ['foreground', 'card', 4.5],
  ['muted-foreground', 'card', 4.5], ['muted-foreground', 'page-bg', 4.5], ['muted-foreground', 'muted', 4.5],
  ['foreground-secondary', 'card', 4.5],
  ['primary-foreground', 'primary', 4.5], ['accent-foreground', 'accent', 4.5],
  ['destructive-foreground', 'destructive', 4.5], ['action-foreground', 'action', 4.5],
  ['success-foreground', 'success', 4.5], ['info-foreground', 'info', 4.5], ['warning-foreground', 'warning', 4.5],
  ['success', 'card', 4.5], ['warning', 'card', 4.5], ['info', 'card', 4.5], ['destructive', 'card', 4.5],
  ['success-soft-fg', 'success-soft', 4.5], ['warning-soft-fg', 'warning-soft', 4.5],
  ['info-soft-fg', 'info-soft', 4.5], ['destructive-soft-fg', 'destructive-soft', 4.5],
  ['action-soft-fg', 'action-soft', 4.5],
  ['focus-ring', 'card', 3], ['focus-ring', 'page-bg', 3],
  // Form-field outlines (WCAG 1.4.11 non-text contrast).
  ['input-border', 'card', 3], ['input-border', 'page-bg', 3], ['input-border', 'background', 3],
];

describe('design tokens — WCAG AA contrast', () => {
  for (const [name, theme] of [['light', LIGHT], ['dark', DARK]]) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${name}: --${fg} on --${bg} >= ${min}:1`, () => {
        const ratio = contrast(fg, bg, theme);
        assert.ok(ratio >= min, `${name} --${fg} on --${bg} is ${ratio.toFixed(2)}:1`);
      });
    }
  }
});

describe('design tokens — keyboard focus stays visible', () => {
  it('no blanket outline reset: pointer focus only is suppressed', () => {
    assert.doesNotMatch(css, /^\*:focus\s*\{\s*outline:\s*none/m);
    assert.match(css, /:focus:not\(:focus-visible\)\s*\{\s*outline:\s*none/);
  });
  it(':focus-visible draws a --focus-ring outline', () => {
    assert.match(css, /:focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\)/);
  });
  it('reduced motion collapses animations and transitions', () => {
    assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\*,/);
  });
});

describe('uikit strings — every shipped locale', () => {
  const KEYS = ['retry', 'loading', 'loadFailedTitle', 'loadFailedBody', 'emptyTitle'];
  for (const code of FULL_LOCALE_CODES) {
    it(`${code} carries uikit.*`, () => {
      const pack = JSON.parse(fs.readFileSync(new URL(`../frontend/locales/${code}.json`, import.meta.url), 'utf8'));
      for (const key of KEYS) {
        assert.equal(typeof pack.uikit?.[key], 'string', `${code}: uikit.${key}`);
        assert.ok(pack.uikit[key].length > 0, `${code}: uikit.${key} non-empty`);
      }
    });
  }
});

describe('form fields — outline uses --input-border', () => {
  const FIELDS = ['input/Input.vue', 'textarea/Textarea.vue', 'select/SelectTrigger.vue',
    'combobox/ComboboxTrigger.vue', 'checkbox/Checkbox.vue', 'input-otp/InputOTPSlot.vue'];
  for (const f of FIELDS) {
    it(`ui/${f} draws border-input-border, not the 1.35:1 border-input`, () => {
      const src = fs.readFileSync(new URL(`../frontend/components/ui/${f}`, import.meta.url), 'utf8');
      assert.match(src, /border-input-border/);
      assert.doesNotMatch(src, /(?<![\w-])border-input(?![\w-])/);
    });
  }
});

describe('components — status colours come from tokens', () => {
  // A fixed Tailwind palette class (bg-green-500, text-yellow-400 …) ignores the
  // theme, so a contrast fix to --success / --warning never reaches it.
  // Additional.vue's always-black curl terminal is the one deliberate exception.
  const ALLOW = new Set(['Additional.vue']);
  const PALETTE = /(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to)-(?:red|green|yellow|amber|emerald|orange|sky|blue|rose|lime|teal|indigo|violet|purple|pink|cyan|gray|slate|zinc|neutral|stone)-\d{2,3}\b/;
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = new URL(`${d.name}${d.isDirectory() ? '/' : ''}`, dir);
    if (d.isDirectory()) return d.name === 'ui' ? [] : walk(p);
    return d.name.endsWith('.vue') ? [p] : [];
  });
  for (const file of walk(new URL('../frontend/components/', import.meta.url))) {
    const name = file.pathname.split('/').pop();
    if (ALLOW.has(name)) continue;
    it(`${file.pathname.split('/components/')[1]} has no fixed palette colour`, () => {
      const hit = fs.readFileSync(file, 'utf8').match(PALETTE);
      assert.equal(hit, null, hit ? `found ${hit[0]}` : '');
    });
  }
  it('SecurityChecklist progress rings read --success / --info', () => {
    const src = fs.readFileSync(new URL('../frontend/components/advanced-tools/SecurityChecklist.vue', import.meta.url), 'utf8');
    assert.match(src, /filled: 'var\(--success\)'/);
    assert.match(src, /info: 'var\(--info\)'/);
  });
});
