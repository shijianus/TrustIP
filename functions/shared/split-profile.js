// Who is this visitor, judged only by what a browser can already see?
//
// The routing table has to decide which national destinations to probe. The old
// list asked every visitor the same 44 questions; this asks a country's questions
// for every country the visitor's *addresses* named, plus one more chosen from six
// signals about the person and the network in front of them. The guess is a
// fallback for the network nothing measured, never a veto over the network
// something did. It is a *guess about a place*, not an identification of a person,
// and it is deliberately built out of signals that are aggregate rather than
// personal: a clock, a keyboard, a language preference, the address a peer-to-
// peer call leaked. Nothing here is stored, sent anywhere, or usable to name
// anybody — the answer is a two-letter region code that decides which public
// websites to ping.
//
// The weights are the whole design, so they are one table with one rule: a
// signal contributes its weight only when it could be measured, and the weights
// that could not be are spread over the ones that were. The two documented
// promotions are the interesting cases — with no geolocation to lean on, the
// system's own version and clock carry the guess (55 and 25), and the clock can
// tell Taipei from Shanghai from Ürümqi where an offset cannot.
//
// Everything below is pure. `Intl` is the only environment it reads, and both
// V8 halves have it, which is why the backend can answer the same question about
// the same signals and the two can never disagree.

import { hasPack } from './site-packs.js';
import { countriesOfZone } from './timezone-countries.js';

// Base weights, in the units the table is normalised against. A promotion is not
// a bonus — it is a share handed over when the signal it stands in for cannot be
// measured, which is why the sum is renormalised rather than treated as a score.
export const SIGNALS = [
    { id: 'geo', weight: 40 },
    // With no geolocation to lean on, the machine's own version carries the
    // guess instead.
    { id: 'os', weight: 20, promoted: { when: 'geoMissing', to: 55 } },
    // …and so does its clock, which can tell Taipei from Shanghai from Ürümqi
    // where an offset cannot.
    { id: 'tz', weight: 15, promoted: { when: 'geoMissing', to: 25 } },
    { id: 'ime', weight: 10 },
    { id: 'lang', weight: 5 },
    // A network whose exit and whose machine disagree is the single strongest
    // clue there is, so it is worth more when it happens.
    { id: 'net', weight: 15, promoted: { when: 'leaking', to: 25 } },
];

// A leaked address, or two exit addresses in two countries: either way the
// network is telling a story with more than one voice in it.
const isLeaking = (net) => Boolean(net?.leakedCountries?.length)
    || new Set([...(net?.exitCountries || []), ...(net?.leakedCountries || [])].filter(Boolean)).size > 1;

// Which weights actually apply to this visitor.
const weightsFor = (signals) => {
    const geoMissing = !signals.geo?.available;
    const out = {};
    for (const s of SIGNALS) {
        const fires = s.promoted && (s.promoted.when === 'geoMissing' ? geoMissing : isLeaking(signals.net));
        out[s.id] = fires ? s.promoted.to : s.weight;
    }
    return out;
};

// --- votes: signal → { country: strength } -----------------------------------
//
// Each vote set is normalised to total 1 before its weight is applied, so a
// signal that can only say "somewhere among these five" spends a fifth of its
// weight on each rather than shouting with five full-strength votes.

const normalize = (votes) => {
    const total = Object.values(votes).reduce((a, b) => a + b, 0);
    if (!total) return {};
    return Object.fromEntries(Object.entries(votes).map(([cc, v]) => [cc, v / total]));
};

// Windows and macOS versions travel with markets, not with people, which is why
// this signal is worth a fifth and not a half. What it does say is *era*: a
// Windows 7 or 8 machine in 2026 is rare in the OECD and ordinary in parts of
// the sanctions-periphery, and that difference survives every other signal.
// Values are relative plausibility, rounded hard on purpose.
const OS_MIX = {
    'win-legacy': { IR: 1, AF: 0.9, SY: 0.9, KP: 0.8, UA: 0.7, RU: 0.6, PK: 0.6, VN: 0.5, ID: 0.5, IN: 0.4, EG: 0.4, TR: 0.4, CN: 0.3, BR: 0.3 },
    'win-10': { CN: 1, RU: 0.9, TR: 0.9, IR: 0.9, UA: 0.8, ID: 0.8, VN: 0.8, BR: 0.8, IN: 0.8, PK: 0.7, MX: 0.7, EG: 0.7, SA: 0.7, TH: 0.7, MY: 0.6, TW: 0.6, KR: 0.6, JP: 0.6, DE: 0.6, GB: 0.5, US: 0.5, KZ: 0.7 },
    'win-11': { US: 1, CA: 0.9, GB: 0.9, DE: 0.9, FR: 0.9, AU: 0.9, SE: 0.8, NL: 0.8, JP: 0.8, KR: 0.8, TW: 0.8, HK: 0.8, SG: 0.8, CN: 0.7, SA: 0.7, AE: 0.7, TH: 0.6, MY: 0.6, BR: 0.5, MX: 0.5, TR: 0.5, RU: 0.4, IR: 0.3, UA: 0.4 },
    macos: { US: 1, CA: 0.9, GB: 0.9, AU: 0.9, HK: 0.9, SG: 0.9, DE: 0.8, JP: 0.8, TW: 0.8, SE: 0.8, NL: 0.7, FR: 0.7, KR: 0.7, AE: 0.6, CN: 0.5, MY: 0.5, IN: 0.4, BR: 0.4, SA: 0.4, RU: 0.3 },
    linux: { DE: 0.7, FI: 0.8, US: 0.6, NL: 0.6, GB: 0.6, SE: 0.6, AU: 0.5, IN: 0.5, RU: 0.5, CN: 0.4, TW: 0.5, JP: 0.5, KR: 0.4, BR: 0.4, FR: 0.5 },
    chromeos: { US: 1, CA: 0.5, GB: 0.4, DK: 0.5, ES: 0.4, NL: 0.3 },
    // iOS share is genuinely national: near-majority in the US and Japan, a
    // minority across South and Southeast Asia. Android is everywhere, so it
    // votes for nowhere.
    ios: { US: 1, JP: 0.9, GB: 0.8, CA: 0.8, AU: 0.8, HK: 0.8, SG: 0.8, KR: 0.7, TW: 0.7, AE: 0.7, SA: 0.5, DE: 0.4, FR: 0.4, CN: 0.4, MY: 0.4, TH: 0.4, RU: 0.4, IT: 0.5, ES: 0.5 },
    android: {},
};

// A Windows `platformVersion` from a user agent is `major.minor.build`. The
// build is what separates 10 from 11 — Windows 11 reports 10.0 with a build at
// or above 22000, which is also exactly what a 22H2 machine pretending to be 10
// reports, so this can say "10-or-11" and no more. Admitting that is better than
// inventing a distinction the platform hides. Anything older than 10 is one
// era: whatever it was, it left mainstream support before the decade did.
const windowsEra = (version = '') => {
    const [major, , build] = String(version).split('.').map((n) => Number.parseInt(n, 10));
    if (!Number.isFinite(major)) return null;
    if (major <= 6) return 'win-legacy';
    if (major >= 11) return 'win-11';
    if (major === 10) return Number.isFinite(build) && build >= 22000 ? 'win-11' : 'win-10';
    return null;
};

export const osVotes = ({ platform, version } = {}) => {
    const p = String(platform || '').toLowerCase();
    const mix = p.includes('windows') ? OS_MIX[windowsEra(version) || 'win-10']
        : p.includes('mac') ? OS_MIX.macos
            : p.includes('linux') || p.includes('ubuntu') || p.includes('debian') ? OS_MIX.linux
                : p.includes('chrome') ? OS_MIX.chromeos
                    : p.includes('ios') || p.includes('iphone') || p.includes('ipad') ? OS_MIX.ios
                        : p.includes('android') ? OS_MIX.android
                            : null;
    return mix ? normalize(mix) : {};
};

// The zone *name* is the signal, never the offset: Asia/Taipei, Asia/Shanghai and
// Asia/Urumqi are one clock in the example that has to be answered three ways.
// The lookup itself is the generated table in timezone-countries.js — see that
// file for why this does not ask `Intl`.
export const timezoneVotes = (zone = '') => {
    const countries = countriesOfZone(zone);
    if (!countries.length) return {};
    // A zone shared by four countries spends a quarter of the signal on each.
    return normalize(Object.fromEntries(countries.map((cc) => [cc, 1])));
};

// Keyboard: the characters the physical keys produce. This is the nearest thing
// a web page can read to "which input method is installed" — the IME engine
// itself is not exposed to a browser, and saying so is part of the answer.
// The writing a key is labelled in. Exported because the panel shows which alphabet a
// keyboard carries, and a second definition of the ranges would be a second opinion
// about the same bytes.
export const scriptOf = (ch) => {
    const c = ch.codePointAt(0);
    if (c >= 0x0400 && c <= 0x04ff) return 'cyrillic';
    if (c >= 0x0600 && c <= 0x06ff) return 'arabic';
    if (c >= 0x0e00 && c <= 0x0e7f) return 'thai';
    // All four Hangul blocks at once: a Korean layout names its keys in
    // compatibility jamo (ㅂ ㅈ), which is a different block from the
    // conjoining jamo a font engine uses and from the syllables a word does.
    if ((c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f)
        || (c >= 0xa960 && c <= 0xa97f) || (c >= 0xac00 && c <= 0xd7af)) return 'hangul';
    if (c >= 0x3040 && c <= 0x30ff) return 'kana';
    if (c >= 0x0370 && c <= 0x03ff) return 'greek';
    if (c >= 0x0590 && c <= 0x05ff) return 'hebrew';
    if (c >= 0x1000 && c <= 0x109f) return 'myanmar';
    if (c >= 0x1780 && c <= 0x17ff) return 'khmer';
    if (c >= 0x0900 && c <= 0x097f) return 'devanagari';
    if (c >= 0x0b80 && c <= 0x0bff) return 'tamil';
    if (c >= 0x0c00 && c <= 0x0c7f) return 'telugu';
    if (c >= 0x0a80 && c <= 0x0aff) return 'gujarati';
    if (c >= 0x0b00 && c <= 0x0b7f) return 'kannada';
    return null;
};

// Four letters exist on the Persian layout and on no Arabic one. That single
// test separates Iran from the Arabic-speaking world, which no other signal
// here does as cleanly.
const PERSIAN_ONLY = ['پ', 'چ', 'ژ', 'گ'];

const LATIN_SPECIAL_VOTES = {
    'ş': { TR: 1, AZ: 0.3 }, 'ğ': { TR: 1, AZ: 0.3 }, 'ı': { TR: 1, AZ: 0.2 },
    'ö': { DE: 0.6, TR: 0.5, FI: 0.4, SV: 0.5, HU: 0.2, NL: 0.3 },
    'ü': { DE: 0.6, TR: 0.5, CH: 0.4, FI: 0.3 },
    'â': { FR: 0.5, RO: 0.6, VI: 0.6 }, 'ê': { FR: 0.4, VI: 0.7 }, 'ô': { FR: 0.4, VI: 0.7, PT: 0.4 },
    'ę': { PL: 1 }, 'ł': { PL: 1 }, 'ż': { PL: 0.8, PT: 0.3 },
    'ã': { PT: 0.7, BR: 0.9 }, 'ç': { PT: 0.5, TR: 0.4, FR: 0.4, BR: 0.4 },
    'ð': { IS: 1 }, 'þ': { IS: 0.9 }, 'ø': { DK: 0.9, NO: 0.9, FO: 0.6 },
    'å': { SV: 0.8, NO: 0.7, DK: 0.6, FI: 0.4 },
    'đ': { VI: 0.9, SR: 0.4, HR: 0.3 },
};

const SCRIPT_VOTES = {
    cyrillic: { RU: 1, UA: 0.5, BY: 0.4, KZ: 0.35, BG: 0.3, SR: 0.2, MK: 0.15, MN: 0.15, KK: 0.15, KG: 0.1, TJ: 0.1 },
    thai: { TH: 1 },
    hangul: { KR: 1 },
    kana: { JP: 1 },
    greek: { GR: 1, CY: 0.2 },
    hebrew: { IL: 1 },
    myanmar: { MM: 1 },
    khmer: { KH: 1 },
    devanagari: { IN: 1, NP: 0.5, MA: 0.1 },
    tamil: { IN: 0.7, LK: 0.6, SG: 0.2, MY: 0.15 },
    telugu: { IN: 1 },
    kannada: { IN: 1 },
    gujarati: { IN: 1 },
};

// `keys` is the physical-code → character map from `navigator.keyboard`.
export const keyboardVotes = ({ keys, layout } = {}) => {
    const chars = Object.values(keys || {}).filter((v) => typeof v === 'string' && v.length);
    if (!chars.length && !layout) return {};

    const votes = {};
    const add = (map) => { for (const [cc, v] of Object.entries(map)) votes[cc] = Math.max(votes[cc] || 0, v); };

    let arabicScript = false;
    let persian = false;
    for (const ch of chars) {
        const script = scriptOf(ch);
        if (script === 'arabic') arabicScript = true;
        if (PERSIAN_ONLY.includes(ch)) persian = true;
        if (script && SCRIPT_VOTES[script]) add(SCRIPT_VOTES[script]);
        if (LATIN_SPECIAL_VOTES[ch]) add(LATIN_SPECIAL_VOTES[ch]);
    }
    // An Arabic-script keyboard carrying پ چ ژ گ is the Persian layout.
    if (arabicScript && persian) return { IR: 1 };
    if (arabicScript && !Object.keys(votes).length) add({ SA: 0.8, EG: 0.7, IQ: 0.4, YE: 0.35, JO: 0.3, MA: 0.35, DZ: 0.3, TN: 0.3, SY: 0.3, AE: 0.3 });

    // Layout families that carry no script at all: azerty and qwertz are
    // regional facts in a way that "qwerty" is not.
    if (!Object.keys(votes).length) {
        if (layout === 'azerty') add({ FR: 1, BE: 0.6, CH: 0.2 });
        else if (layout === 'qwertz') add({ DE: 0.7, AT: 0.6, CZ: 0.5, SK: 0.4, HU: 0.4, PL: 0.3, SI: 0.2, HR: 0.2, BA: 0.15 });
        else if (layout === 'jis') add({ JP: 1 });
    }
    // Plain QWERTY is the default of a third of the planet: it discriminates
    // nothing, and pretending otherwise would spend 10% of the guess on noise.
    return normalize(votes);
};

const regionOf = (tag = '') => {
    try {
        return new Intl.Locale(String(tag).replace(/_/g, '-')).maximize().region || null;
    } catch {
        return null;
    }
};

// The ordered language preference. The first entry is the display language and
// carries the guess; the later ones are downloaded language packs, which say
// something real about a person but weaker.
export const languageVotes = (languages = []) => {
    const votes = {};
    languages.slice(0, 4).forEach((tag, i) => {
        const cc = regionOf(tag);
        if (!cc) return;
        votes[cc] = Math.max(votes[cc] || 0, [1, 0.3, 0.12, 0.06][i] ?? 0.03);
    });
    return normalize(votes);
};

// Own geolocation of the resolved address. One country is a fact; two (an IPv4
// in one place and an IPv6 in another) is two half-facts.
export const geoVotes = (countries = []) => normalize(
    Object.fromEntries([...new Set(countries.filter(Boolean))].map((cc) => [cc, 1])),
);

// The network's own story. Counter-intuitive and deliberate: the *leaked*
// address gets more weight than the resolved one. A public IP says where the
// traffic enters the internet; a WebRTC or resolver leak says where the machine
// sits, and the visitor is the machine.
export const networkVotes = ({ exitCountries = [], leakedCountries = [] } = {}) => {
    const votes = {};
    for (const cc of new Set(leakedCountries.filter(Boolean))) votes[cc] = 1;
    for (const cc of new Set(exitCountries.filter(Boolean))) votes[cc] = Math.max(votes[cc] || 0, leakedCountries.length ? 0.8 : 1);
    return normalize(votes);
};

// --- assembly ----------------------------------------------------------------

// One voter per signal, each returning country → strength already normalised to
// total 1, so a signal's weight is the most it can ever spend.
const VOTERS = {
    geo: (s) => (s?.available ? geoVotes(s?.countries || []) : {}),
    os: (s) => (s?.available ? osVotes(s) : {}),
    tz: (s) => (s?.available ? timezoneVotes(s?.zone) : {}),
    ime: (s) => (s?.available ? keyboardVotes(s) : {}),
    lang: (s) => (s?.available ? languageVotes(s?.languages) : {}),
    net: (s) => (s?.available ? networkVotes(s) : {}),
};

// A floor on how confident the *guess* has to be before the table shows national
// rows for it. Below this, every signal disagreed and the honest display is the
// international pack alone, said out loud rather than padded with a coin flip.
export const MIN_CONFIDENCE = 12;

// How many countries get a pack. Measured ones are not rationed against each
// other the way guesses are: a network with a mainland IPv4, an overseas proxy and
// a Taipei clock really does have three internets in front of the visitor, and
// testing two of them and calling the page a routing report would be the bug this
// change exists to fix. The cap is on the length of the table, not on the worth of
// the evidence.
export const MEASURED_MAX = 4;
export const INFERRED_MAX = 1;

// The most packs any work order may carry, judged or asked-for. `api/split.js` holds
// the explicit `countries` list to this same number so the escape hatch cannot
// produce a table the scoring path would never have dared show — the shared
// `requireSplitSignals` ceiling is a body-size limit (12 codes), not this policy.
export const PLAN_COUNTRIES_MAX = MEASURED_MAX + INFERRED_MAX;

/**
 * The countries an *address* named, as opposed to a clock or a keyboard.
 *
 * These are facts, not votes. An exit that resolves to China is in China however
 * the visitor's timezone disagrees, and the weighted arithmetic used to spend two
 * of them against each other: a mainland IPv4 and an overseas IPv6 split the
 * geolocation signal 50/50, so each landed near the confidence floor and a
 * confident third guess could crowd a real country out of the table altogether.
 * Which is why this runs before the floor is consulted, not after.
 *
 * The order is the meaning: a leaked address first, because the leak says where
 * the machine sits while the exit only says where the traffic entered the
 * internet. Then everything the visitor's own sources resolved, then the rest.
 */
export const measuredCountries = (signals = {}) => {
    const list = (slice, key) => (slice?.available ? slice[key] || [] : []);
    const seen = [
        ...list(signals.net, 'leakedCountries'),
        ...list(signals.geo, 'countries'),
        ...list(signals.net, 'exitCountries'),
    ];
    const out = [];
    for (const cc of seen) {
        if (out.length >= MEASURED_MAX) break;
        if (hasPack(cc) && !out.includes(cc)) out.push(cc);
    }
    return out;
};

export const confidentTop = (ranking, floor = MIN_CONFIDENCE) => ranking
    .filter((r) => r.hasPack && r.pct >= floor)
    .slice(0, 2)
    .map((r) => r.cc);

/**
 * Score a visitor's signals into a ranking of countries.
 *
 * `signals` is `{ geo, os, tz, ime, lang, net }`, each slice either absent, or
 * `{ available: false, reason }`, or `{ available: true, ...values }` as the
 * voters above read them. The returned weights are the ones actually applied,
 * so the page can show the arithmetic rather than assert it.
 *
 * `top` — who gets a pack — is the measured countries first and then at most one
 * guessed one. `ranking` stays the full arithmetic of the guess, because that is
 * what the weights exist for; it no longer decides alone what gets tested.
 */
export const scoreProfile = (signals = {}) => {
    const weights = weightsFor(signals);
    const scores = {};
    const provenance = {};
    const gaps = [];
    let applied = 0;

    for (const s of SIGNALS) {
        const slice = signals[s.id];
        const votes = slice ? VOTERS[s.id](slice) : {};
        const weight = weights[s.id];
        if (!slice?.available || !Object.keys(votes).length) {
            // Absent, unmeasurable, or measured and uninformative — all three
            // cost the display the same words and the ranking the same nothing.
            gaps.push({
                id: s.id,
                weight,
                reason: !slice ? 'absent' : !slice.available ? (slice.reason || 'unsupported') : 'uninformative',
            });
            continue;
        }
        applied += weight;
        for (const [cc, strength] of Object.entries(votes)) {
            scores[cc] = (scores[cc] || 0) + weight * strength;
            (provenance[cc] ||= {})[s.id] = Number(strength.toFixed(3));
        }
    }

    const ranking = Object.entries(scores)
        .map(([cc, raw]) => ({
            cc,
            score: Number(raw.toFixed(3)),
            pct: applied ? Number(((raw / applied) * 100).toFixed(1)) : 0,
            hasPack: hasPack(cc),
            votes: provenance[cc],
        }))
        .sort((a, b) => b.score - a.score || a.cc.localeCompare(b.cc));

    const measured = measuredCountries(signals);
    // A guessed country the addresses already named adds no new destination to
    // test, so the one inference slot goes to the next country the signals
    // disagree about least. A third-place guess with no pack behind it would show
    // nothing but its own name — which is a promise the table cannot keep.
    const inferred = confidentTop(ranking).filter((cc) => !measured.includes(cc)).slice(0, INFERRED_MAX);

    return {
        weights,
        applied,
        ranking,
        measured,
        inferred,
        top: [...measured, ...inferred],
        gaps,
    };
};
