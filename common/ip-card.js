// The shareable IP card: one PNG about one address, rendered server-side.
//
// A verdict that cannot be shared is a screenshot waiting to happen, and a
// screenshot is where the provenance goes — no `generatedAt`, no statement of what
// was measured, and a crop that can drop the part that qualified the number. So this
// composes the same facts the dossier shows into one image with the timestamp on its
// face: the address, the country its own echo named, the AS behind it, what kind of
// network the registries say it is, the score, and when the evidence was assembled.
//
// Nothing else goes on it. The card is the one trust artifact in this build that is
// *made to leave*: it is posted to forums and pasted into chats, so it carries no
// registrant name, no abuse contact, no vendor payload, no per-signal weight table
// and no API key — the same lines `api/trust-score.js` and the adapters hold, applied
// to a medium where nobody can inspect the source.
//
// ## The font is a deployment fact
//
// Satori lays text out from font data it is handed; it does not use a browser and
// does not resolve `font-family` against the system. So a card needs real font bytes,
// and this build ships none: adding a ~200 KB binary to git for a decoration nobody
// asked for is a bigger decision than a feature flag. `IP_CARD_FONT_PATH` names a
// file or a directory; without it the well-known system locations are probed. When
// neither works — a distroless or Alpine container with no font package installed —
// `cardFont()` answers null, the route answers 503 before any upstream is asked, and
// `/api/configs` reports `ipCard: false` so the UI hides the button rather than
// offering a broken one. A missing font is a declared gap, never a card of boxes.
//
// What the probe cannot decide is *coverage*, and a font that cannot draw the label
// is worse than no label: DejaVu, Noto Sans and Liberation carry Latin, Cyrillic and
// Greek and not Han, so a `zh` card drawn from them would be a row of empty boxes.
// `drawableLang` reads the chosen face's name and drops to the fallback language for
// a script it cannot draw — an English word on a Chinese page beats tofu, and the
// numbers, the address and the country code are Latin anyway. A deployment that wants
// Han labels points `IP_CARD_FONT_PATH` at a CJK face and the rule stops firing.
//
// ## The flag is a code chip, not a flag
//
// The page renders real circle flags from `@iconify-json/circle-flags`, and the
// obvious move was to draw the same paths here. Its `body` is mask-and-`<g>` SVG that
// needs a parser and a mask-aware renderer; satori takes a deliberately small SVG
// subset, and re-drawing a flag by hand from remembered colours would put a wrong
// national symbol on an image whose entire purpose is to be reposted somewhere we
// cannot correct it. So the card names the country in the visitor's own language and
// carries the alpha-2 code as a chip — the fact, without the guess.

import fs from 'node:fs';
import path from 'node:path';

import getCountryName from './country-name.js';
import { LOCALE_CODES, FALLBACK_LOCALE } from './locale-registry.js';
import logger from './logger.js';

const WIDTH = 1200;
const HEIGHT = 620;

// Probed in order when `IP_CARD_FONT_PATH` names a directory or is unset. Bold first:
// a card is a headline, and a light face at 90 px reads as a paragraph.
const SYSTEM_FONT_FILES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    'C:\\Windows\\Fonts\\arialbd.ttf',
];

const SYSTEM_FONT_DIRS = [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    '/Library/Fonts',
    '/System/Library/Fonts',
    'C:\\Windows\\Fonts',
];

const FONT_EXTENSIONS = new Set(['.ttf', '.otf']);
const PREFERRED_NAME = /(dejavusans|notosans[-.]?(?![a-z])|liberationsans|inter|roboto|arial|helvetica)/i;

let cachedFont = null;

const readFont = (file) => {
    try {
        const data = fs.readFileSync(file);
        return { name: 'TrustIP Card', data, file };
    } catch (err) {
        logger.warn({ err, file }, 'ip-card: font unreadable');
        return null;
    }
};

// The first face in a directory that is not a mono, italic or CJK-only variant: a
// card laid out in `NotoSansMono` at 96px overflows, and one in `DejaVuSans-Oblique`
// is a headline that leans.
const pickFromDir = (dir) => {
    let entries = [];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return null;
    }
    const candidates = entries
        .filter((name) => FONT_EXTENSIONS.has(path.extname(name).toLowerCase()))
        .filter((name) => !/mono|italic|oblique|condensed|light|thin|CJK|SC|TC|JP|KR/i.test(name))
        .sort((a, b) => (PREFERRED_NAME.test(b) ? 1 : 0) - (PREFERRED_NAME.test(a) ? 1 : 0));
    for (const name of candidates) {
        const font = readFont(path.join(dir, name));
        if (font) return font;
    }
    return null;
};

/**
 * The font bytes satori needs, or null when this host cannot draw text at all.
 *
 * A found font is cached for the process; a *missing* one is re-probed on every
 * call, so an operator who installs a font package in a running container gets cards
 * on the next request rather than after a restart nobody asked for.
 *
 * @returns {{name: string, data: Buffer}|null}
 */
export const cardFont = () => {
    if (cachedFont) return cachedFont;

    const configured = (process.env.IP_CARD_FONT_PATH || '').trim();
    if (configured) {
        try {
            const stat = fs.statSync(configured);
            const font = stat.isDirectory() ? pickFromDir(configured) : readFont(configured);
            // An explicit path that resolves to nothing is the operator's own
            // mistake and is worth a line: silently falling back to a system font
            // would make a typo look like "cards are broken for no reason".
            if (!font) logger.error({ configured }, 'ip-card: IP_CARD_FONT_PATH names no readable font');
            else cachedFont = font;
            return font;
        } catch (err) {
            logger.error({ err, configured }, 'ip-card: IP_CARD_FONT_PATH is not a font');
            return null;
        }
    }

    for (const file of SYSTEM_FONT_FILES) {
        const font = readFont(file);
        if (font) {
            cachedFont = font;
            return font;
        }
    }
    for (const dir of SYSTEM_FONT_DIRS) {
        const font = pickFromDir(dir);
        if (font) {
            cachedFont = font;
            return font;
        }
    }
    return null;
};

/** @internal Tests re-run discovery against a different environment. */
export const resetCardFont = () => { cachedFont = null; };

/** Whether this instance can produce a card at all — the `/api/configs` gate. */
export const isCardConfigured = () => cardFont() !== null;

// --- labels ------------------------------------------------------------------

const packs = new Map();
const localesDir = path.resolve(import.meta.dirname, '..', 'frontend', 'locales');

const readPack = (code) => {
    if (packs.has(code)) return packs.get(code);
    let pack = {};
    try {
        pack = JSON.parse(fs.readFileSync(path.join(localesDir, `${code}.json`), 'utf8'));
    } catch (err) {
        logger.warn({ err, code }, 'ip-card: locale pack unreadable');
    }
    packs.set(code, pack);
    return pack;
};

// The scripts a Latin-default face cannot draw. DejaVu, Noto Sans and Liberation
// carry Latin, Cyrillic, Greek and most of Latin-1, so `fr` and `ru` are safe on
// them and `zh` is not: a Han label in a face with no Han glyphs renders as a row of
// empty boxes, which is a worse artifact than an English word on a Chinese page.
// Coverage is judged from the chosen file's name because that is the only signal a
// font probe gets without parsing the font — an operator who wants Han labels points
// `IP_CARD_FONT_PATH` at a CJK face and this rule stops firing.
const HAN_LOCALES = /^zh\b|^zh-/i;
const HAN_CAPABLE = /(cjk|sourcehan|notosanscjk|wqy|droidsansfallback|hei|song|kai|yahei|pingfang|gothic|mincho)/i;

/**
 * The language this host's font can actually draw.
 *
 * @param {string|undefined} lang  the requested tag
 * @returns {string} the tag to read labels from
 */
export const drawableLang = (lang) => {
    const tag = typeof lang === 'string' && lang.trim() ? lang : FALLBACK_LOCALE;
    if (!HAN_LOCALES.test(tag)) return tag;
    const font = cardFont();
    if (font && HAN_CAPABLE.test(path.basename(font.file || ''))) return tag;
    return FALLBACK_LOCALE;
};

// A card is a published artifact, so its copy comes from the same packs the site
// renders — a label translated on the page and left in English on the image is two
// products. `?lang` is passed through unvalidated and resolved down the fallback
// chain, the same rule every other handler follows. `path` is a dotted key inside the
// pack (`ipCard.score`, `trustip.value.datacenter`), so the card reuses the verdict
// words the page already translates instead of growing a second vocabulary.
const labelFor = (lang, path) => {
    const codes = [lang, FALLBACK_LOCALE].filter((code, i, all) => (
        typeof code === 'string' && LOCALE_CODES.includes(code) && all.indexOf(code) === i
    ));
    const keys = path.split('.');
    for (const code of codes) {
        let value = readPack(code);
        for (const key of keys) value = value?.[key];
        if (typeof value === 'string' && value.trim()) return value;
    }
    return path;
};

// --- the layout --------------------------------------------------------------

// Satori's input is a JSX element tree. With no JSX transform on the server side,
// elements are built as the plain objects JSX compiles down to, which also keeps
// `buildCardTree` free of satori — and therefore testable without a font.
const h = (type, props = {}, ...children) => ({
    type,
    props: { ...props, children: children.flat().filter((child) => child !== null && child !== undefined) },
    key: null,
});

const TEXT = { fontFamily: 'TrustIP Card', whiteSpace: 'pre' };

// Every row states its own width. Satori lays out with Yoga and none of a browser's
// shrink rules: a flex row that is only told `marginLeft: auto` sizes itself to its
// children and walks off the canvas — which is exactly how the score ended up clipped
// and the footer pushed below the image in the first render of this card.
const PAD = 56;
const CONTENT = WIDTH - PAD * 2;

const INK = '#0b1220';
const CHIP = '#111827';
const MUTED = '#9ca3af';
const RULE = '#243044';

const BAND_COLOUR = {
    1: '#dc2626',
    2: '#ea580c',
    3: '#ca8a04',
    4: '#16a34a',
    5: '#0d9488',
};

// IPv6 in a card's headline is the one string that cannot be trusted to fit: a full
// address is 39 characters and an IPv4 is 15. Tiered sizes rather than a measured
// fit, because satori has no way to ask how wide a glyph run came out.
const ipSize = (ip) => (ip.length > 32 ? 44 : ip.length > 20 ? 60 : 82);

const formatStamp = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

const row = (extra = {}) => ({
    display: 'flex',
    width: `${CONTENT}px`,
    ...extra,
});

/**
 * The card's element tree, from the facts a caller was willing to put on it.
 *
 * @param {object} spec
 * @param {string} spec.ip
 * @param {string|null} [spec.country]  alpha-2 code
 * @param {number|null} [spec.asn]
 * @param {string|null} [spec.org]
 * @param {string|null} [spec.clsLabel]
 * @param {number|null} [spec.score]
 * @param {number|null} [spec.band]
 * @param {string} spec.generatedAt
 * @param {string} [spec.lang]
 * @returns {object} a satori element tree
 */
export const cardLabel = labelFor;

export const buildCardTree = (spec) => {
    const stamp = formatStamp(spec.generatedAt);
    const lang = drawableLang(spec.lang);
    const country = spec.country ? getCountryName(spec.country, lang) : '';

    return h('div', {
        style: {
            // Content-box sizing: satori adds `padding` outside the declared size the
            // way a bare Yoga layout does, so the box is stated at the content size
            // and the padding brings it back to WIDTH × HEIGHT. Declaring the full
            // canvas *and* the padding pushed the footer off the bottom of the image.
            width: `${CONTENT}px`,
            height: `${HEIGHT - PAD * 2}px`,
            display: 'flex',
            flexDirection: 'column',
            padding: `${PAD}px`,
            background: INK,
            color: '#e5e7eb',
            ...TEXT,
        },
    },
    h('div', { style: row({ alignItems: 'center', gap: '18px', marginBottom: '22px' }) },
        spec.country ? h('div', {
            style: {
                ...TEXT,
                fontSize: '22px',
                fontWeight: '700',
                letterSpacing: '1.5px',
                padding: '8px 16px',
                borderRadius: '999px',
                background: CHIP,
                border: `1px solid ${RULE}`,
                color: '#e5e7eb',
            },
        }, spec.country) : null,
        h('div', { display: 'flex', flexDirection: 'column' },
            h('div', { style: { ...TEXT, fontSize: '25px', fontWeight: '700', letterSpacing: '1px' } }, 'TrustMy.IP'),
            h('div', { style: { ...TEXT, fontSize: '19px', color: MUTED } }, country || '\u2014'),
        ),
    ),
    h('div', { style: { ...TEXT, width: `${CONTENT}px`, fontSize: `${ipSize(spec.ip)}px`, fontWeight: '700', lineHeight: '1.15' } }, spec.ip),
    h('div', { style: row({ marginTop: '26px', paddingTop: '24px', borderTop: `2px solid ${RULE}` }) },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', width: '470px' } },
            h('div', { style: { ...TEXT, fontSize: '18px', color: MUTED } }, 'ASN'),
            h('div', { style: { ...TEXT, fontSize: '30px', fontWeight: '700' } }, spec.asn ? `AS${spec.asn}` : '\u2014'),
            h('div', { style: { ...TEXT, fontSize: '19px', color: MUTED, width: '470px' } }, spec.org || ''),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', width: '330px' } },
            h('div', { style: { ...TEXT, fontSize: '18px', color: MUTED } }, labelFor(lang, 'ipCard.kind')),
            h('div', { style: { ...TEXT, fontSize: '30px', fontWeight: '700' } }, spec.clsLabel || '\u2014'),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', width: '250px', alignItems: 'flex-end' } },
            h('div', { style: { ...TEXT, fontSize: '18px', color: MUTED } }, labelFor(lang, 'ipCard.score')),
            h('div', {
                style: {
                    ...TEXT,
                    fontSize: '62px',
                    fontWeight: '700',
                    color: BAND_COLOUR[spec.band] || '#e5e7eb',
                },
            }, spec.score == null ? '\u2014' : `${spec.score}`),
        ),
    ),
    h('div', { style: row({ marginTop: 'auto', paddingTop: '22px', gap: '24px', fontSize: '19px', color: MUTED }) },
        h('div', { style: { ...TEXT } }, stamp ? `${labelFor(lang, 'ipCard.generated')} ${stamp}` : ''),
        h('div', { style: { ...TEXT, marginLeft: 'auto' } }, labelFor(lang, 'ipCard.footnote')),
    ));
};

/**
 * Render the card.
 *
 * @param {object} spec  see `buildCardTree`
 * @returns {Promise<Buffer|null>} PNG bytes, or null when no font is available
 */
export const renderCard = async (spec) => {
    const font = cardFont();
    if (!font) return null;

    const { default: satori } = await import('satori');
    const { Resvg } = await import('@resvg/resvg-js');
    const svg = await satori(buildCardTree(spec), {
        width: WIDTH,
        height: HEIGHT,
        fonts: [{ name: font.name, data: font.data, styles: ['normal'], weight: 700 }],
    });
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng());
};
