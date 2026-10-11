// The shareable IP card: what may be drawn, what may never be drawn, and the two
// ways the route says "this host cannot make one".
//
// The card is the only trust artifact in the build that is *made to leave* — it gets
// posted to forums and pasted into chats, where nobody can inspect the source or see
// what was left out. So the content assertions here are the point: the address and
// the score yes, the registrant's contact details, a vendor's raw payload and the
// weight table no.
//
// Rendering is real in the 200 case: satori and resvg are pure CPU work over a font
// the host already has, and a test that stubbed them would prove the wiring and not
// the picture. The registries are stubbed, so nothing leaves the process.

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Resolver } from 'node:dns/promises';

import {
    buildCardTree, cardFont, cardLabel, drawableLang, isCardConfigured, renderCard, resetCardFont,
} from '../common/ip-card.js';
import ipCardHandler from '../api/ip-card.js';

const ENV_KEYS = ['IP_CARD_FONT_PATH'];
const originalFetch = globalThis.fetch;
const originalResolve = Resolver.prototype.resolve4;
let envBackup = {};
let fontFile = null;

// The faces this build's own probe prefers. A test that grabbed the first `.ttf`
// in /usr/share/fonts would find `DejaVuMathTeXGyre` and fail inside fontkit for a
// reason that has nothing to do with the card, so the candidates are the ones the
// module itself would pick.
const FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
];

const hostFont = () => FONT_CANDIDATES.find((file) => fs.existsSync(file)) || null;

// Whether *this* host can draw a card at all, by the module's own discovery — the
// render tests skip rather than fail on a machine with no font installed.
const canRender = () => {
    delete process.env.IP_CARD_FONT_PATH;
    resetCardFont();
    return isCardConfigured();
};

beforeEach(() => {
    envBackup = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    resetCardFont();
    fontFile = hostFont();
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    Resolver.prototype.resolve4 = originalResolve;
    for (const [k, v] of Object.entries(envBackup)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
});

const collect = () => {
    const headers = {};
    const body = {};
    const out = {
        statusCode: 200,
        res: {
            json: (payload) => { Object.assign(body, payload); return body; },
            status: (code) => { out.statusCode = code; return out.res; },
            set: (key, value) => { headers[key] = value; return out.res; },
            send: (buffer) => { out.buffer = buffer; return out.res; },
        },
        body,
        headers,
        get status() { return out.statusCode; },
    };
    return out;
};

// Every registry unreachable, so the evidence is sparse and the response is still a
// card: a half-known address is drawn with em-dashes, not refused.
const stubRegistries = () => {
    Resolver.prototype.resolve4 = () => Promise.reject(
        Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }),
    );
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });
};

const SPEC = {
    ip: '203.0.113.77',
    country: 'DE',
    asn: 205041,
    org: 'Hetzner Online GmbH',
    clsLabel: 'datacenter',
    score: 38,
    band: 2,
    generatedAt: '2026-10-11T08:12:00.000Z',
    lang: 'en',
};

const textOf = (node) => {
    if (typeof node === 'string') return node;
    if (!node || typeof node !== 'object') return '';
    return (node.props?.children || []).map(textOf).join(' ');
};

describe('ip-card: the layout', () => {
    it('draws the facts a card exists to carry', () => {
        const text = textOf(buildCardTree(SPEC));
        for (const fact of ['203.0.113.77', 'DE', 'Germany', 'AS205041', 'Hetzner Online GmbH', 'datacenter', '38', '2026-10-11 08:12 UTC']) {
            assert.ok(text.includes(fact), `missing from the card: ${fact}`);
        }
    });

    it('draws an em-dash rather than a zero or a guess where nothing is known', () => {
        const text = textOf(buildCardTree({
            ip: '1.2.3.4', country: null, asn: null, org: null, clsLabel: null,
            score: null, band: null, generatedAt: '2026-10-11T08:12:00.000Z', lang: 'en',
        }));
        assert.ok(text.includes('1.2.3.4'));
        assert.ok(text.includes('—'), 'an unknown has to read as unknown');
        assert.ok(!/\b0\b/.test(text.replace(/20\d\d/, '')), 'a missing score must not become a zero');
    });

    // The line every other module in this group holds, applied to a medium where
    // nobody can inspect the source of the picture.
    it('carries nothing it should not', () => {
        const text = textOf(buildCardTree({
            ...SPEC,
            // Deliberately present in the caller's world and absent on the card.
            generatedAt: '2026-10-11T08:12:00.000Z',
        }));
        assert.ok(!/abuse|@|net-abuse|Jo Bloggs|api\.key|key=/i.test(text), text);
        assert.ok(!/effect|weights|proxycheck|abuseipdb|internetdb/i.test(text),
            'vendor names and the weight table are not the card’s business');
    });

    it('shrinks a long address instead of overflowing the canvas', () => {
        const v6 = buildCardTree({ ...SPEC, ip: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' });
        const v4 = buildCardTree(SPEC);
        const headline = (tree) => parseFloat(tree.props.children[1].props.style.fontSize);
        assert.ok(headline(v6) < headline(v4), `${headline(v6)} vs ${headline(v4)}`);
    });
});

describe('ip-card: labels', () => {
    it('reads the same packs the site renders', () => {
        assert.equal(cardLabel('en', 'ipCard.score'), 'Trust score');
        assert.notEqual(cardLabel('fr', 'ipCard.score'), 'Trust score');
        assert.notEqual(cardLabel('zh', 'trustip.value.datacenter'), cardLabel('en', 'trustip.value.datacenter'));
    });

    // `?lang` is never validated in a handler, so an unknown tag has to land on the
    // fallback rather than throw on a missing file.
    it('falls back for a language this build does not ship', () => {
        assert.equal(cardLabel('klingon', 'ipCard.score'), 'Trust score');
        assert.equal(cardLabel(undefined, 'ipCard.score'), 'Trust score');
        assert.equal(cardLabel('en', 'no.such.key'), 'no.such.key');
    });
});

// A Han label drawn by a Latin face comes out as a row of empty boxes, which is a
// worse artifact on a Chinese page than an English word — so the language is chosen
// by what the host's font can draw, not only by what the visitor asked for.
describe('ip-card: what the chosen font can draw', () => {
    it('keeps a script the Latin default covers', (t) => {
        if (!fontFile) return t.skip('no TrueType font on this host');
        process.env.IP_CARD_FONT_PATH = fontFile;
        assert.equal(drawableLang('fr'), 'fr');
        assert.equal(drawableLang('ru'), 'ru');
        assert.equal(drawableLang('en'), 'en');
        assert.equal(drawableLang(undefined), 'en');
    });

    it('drops to the fallback language rather than drawing tofu', (t) => {
        if (!fontFile) return t.skip('no TrueType font on this host');
        process.env.IP_CARD_FONT_PATH = fontFile;
        assert.equal(drawableLang('zh'), 'en');
        assert.equal(drawableLang('zh-TW'), 'en');
        const text = textOf(buildCardTree({ ...SPEC, lang: 'zh' }));
        assert.ok(text.includes('Trust score'), `the label fell through untranslated: ${text}`);
        assert.ok(!/[\u4e00-\u9fff]/.test(text), 'a Han label cannot be drawn by this face');
    });
});

describe('ip-card: the font gate', () => {
    it('reads an explicit file', (t) => {
        if (!fontFile) return t.skip('no TrueType font on this host');
        process.env.IP_CARD_FONT_PATH = fontFile;
        const font = cardFont();
        assert.ok(Buffer.isBuffer(font.data));
        assert.equal(font.name, 'TrustIP Card');
        assert.equal(isCardConfigured(), true);
    });

    it('answers null for a path that names no font, rather than throwing', () => {
        process.env.IP_CARD_FONT_PATH = path.join(os.tmpdir(), 'definitely-not-a-font.ttf');
        assert.equal(cardFont(), null);
        assert.equal(isCardConfigured(), false);
        process.env.IP_CARD_FONT_PATH = path.join(os.tmpdir());
        assert.equal(cardFont(), null, 'a directory with no faces in it is still no font');
    });
});

describe('ip-card: rendering', () => {
    it('produces a PNG', async (t) => {
        if (!canRender()) return t.skip('no usable font on this host');
        const png = await renderCard(SPEC);
        assert.ok(Buffer.isBuffer(png));
        assert.equal(png.subarray(1, 4).toString(), 'PNG');
        assert.ok(png.length > 2000, 'a card smaller than this is an empty canvas');
    });

    it('answers null when there is nothing to draw with', async () => {
        process.env.IP_CARD_FONT_PATH = path.join(os.tmpdir(), 'definitely-not-a-font.ttf');
        assert.equal(await renderCard(SPEC), null);
    });
});

describe('GET /api/ip-card', () => {
    it('refuses before asking any registry when no font is configured', async () => {
        process.env.IP_CARD_FONT_PATH = path.join(os.tmpdir(), 'definitely-not-a-font.ttf');
        let asked = 0;
        globalThis.fetch = async () => { asked += 1; return { ok: false, status: 500, json: async () => ({}) }; };
        const c = collect();

        await ipCardHandler({ query: { ip: '203.0.113.77', lang: 'en' } }, c.res);

        assert.equal(c.status, 503);
        assert.match(c.body.error, /not configured/i);
        assert.equal(asked, 0, 'a card that cannot be drawn must not spend the registries');
    });

    it('serves a PNG for an address whose registries all failed', async (t) => {
        if (!canRender()) return t.skip('no usable font on this host');
        stubRegistries();
        const c = collect();

        await ipCardHandler({ query: { ip: '203.0.113.77', lang: 'fr' } }, c.res);

        assert.equal(c.status, 200);
        assert.equal(c.headers['Content-Type'], 'image/png');
        assert.equal(c.buffer.subarray(1, 4).toString(), 'PNG');
        assert.equal(Number(c.headers['Content-Length']), c.buffer.length);
    });
});
