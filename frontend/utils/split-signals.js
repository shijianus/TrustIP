// The six signals the routing test reads about a visitor, taken from the browser.
//
// Nothing here decides anything — each reader returns what it found (or honestly
// reports that it could not look), and `common/split-profile.js` does the
// arithmetic. Splitting it this way is what lets the same scoring run on the
// server and give the same answer about the same machine.
//
// What is deliberately *not* read: the visitor's GPS, saved forms, history, or
// anything that identifies a person rather than a place. A clock, a keyboard and
// a language preference describe a region, and the answer this feeds is a
// two-letter code that selects which public websites to ping. If you are looking
// for a way to learn something about a user that they have not already put in
// their own HTTP headers, this file will not give it to you.

// The physical-key codes whose characters separate the layouts that matter. The
// top two letter rows plus the home row, so a Cyrillic, Arabic, Persian, Greek,
// Thai or Hangul layout names at least one key in its own script, and the four
// letters that single out the Persian layout from every Arabic one (پ چ ژ گ) are
// on the sampled rows.
const LAYOUT_KEYS = [
    'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP',
    'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL',
    'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM',
    'Semicolon', 'IntlRo', 'IntlYen',
];

// JIS keyboards carry two keys no other layout has.
const layoutFamilyOf = (keys) => {
    if (!Object.keys(keys).length) return null;
    if ('IntlRo' in keys && 'IntlYen' in keys) return 'jis';
    if (keys.KeyA === 'q' && keys.KeyQ === 'a') return 'azerty';
    if (keys.KeyZ === 'y' && keys.KeyY === 'z') return 'qwertz';
    if (keys.KeyQ === 'q' && keys.KeyW === 'w') return 'qwerty';
    return 'other';
};

/**
 * Which characters the physical keys produce. `navigator.keyboard` exists only on
 * Chromium on Windows (and Android) behind a permission prompt-free call, so on
 * Firefox and Safari this returns `{ available: false }` and the input-method
 * signal reports as unmeasured rather than guessed — its weight moves somewhere
 * a browser can actually answer.
 */
export const readKeyboard = async () => {
    const keyboard = typeof navigator !== 'undefined' ? navigator.keyboard : null;
    if (!keyboard?.getLayoutMap) return { available: false, reason: 'unsupported' };
    try {
        const map = await keyboard.getLayoutMap();
        const keys = {};
        for (const code of LAYOUT_KEYS) {
            const value = map.get(code);
            // A key with no label (dead keys, modifiers) tells us nothing; an
            // empty string is exactly that and must not read as "Latin layout".
            if (typeof value === 'string' && value) keys[code] = value;
        }
        if (!Object.keys(keys).length) return { available: false, reason: 'empty' };
        return { available: true, keys, layout: layoutFamilyOf(keys) };
    } catch {
        // The permission is granted per document and a browser can refuse the
        // promise outright; either way the honest answer is "not measured".
        return { available: false, reason: 'denied' };
    }
};

// The IANA zone name is the signal; the offset is only how it is written down.
// `Asia/Taipei` and `Asia/Shanghai` are the same clock and different answers, so
// anything that collapses them — `UTC+8`, an offset in minutes — is discarded.
export const readClock = () => {
    try {
        const { timeZone, hourCycle } = Intl.DateTimeFormat().resolvedOptions();
        if (!timeZone) return { available: false, reason: 'unsupported' };
        const offsetMinutes = -new Date().getTimezoneOffset();
        return { available: true, zone: timeZone, offsetMinutes, hourCycle };
    } catch {
        return { available: false, reason: 'unsupported' };
    }
};

export const readLanguages = () => {
    const list = typeof navigator !== 'undefined' ? navigator.languages : null;
    const languages = (Array.isArray(list) && list.length ? list : [navigator?.language]).filter(Boolean);
    if (!languages.length) return { available: false, reason: 'unsupported' };
    return { available: true, languages };
};

// The operating system, and as much of its version as the browser is allowed to
// say. Chrome and Edge answer `platformVersion` when asked with the high-entropy
// hint; everywhere else the user agent is the only witness, and a frozen UA says
// "Windows NT 10.0" for the last fifteen years of Windows. Both paths are taken,
// and the result carries which one produced it so the page can say so too.
const uaOS = () => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const win = ua.match(/Windows NT ([\d.]+)/);
    if (win) return { platform: 'Windows', version: win[1], source: 'ua' };
    if (/Android/.test(ua)) return { platform: 'Android', version: (ua.match(/Android ([\d.]+)/) || [])[1], source: 'ua' };
    const mac = ua.match(/OS ([\d_]+)/);
    if (mac && /Mac OS X|iPhone|iPad/.test(ua)) return { platform: /iPhone|iPad/.test(ua) ? 'iOS' : 'macOS', version: mac[1].replace(/_/g, '.'), source: 'ua' };
    if (/CrOS/.test(ua)) return { platform: 'Chrome OS', source: 'ua' };
    if (/(Linux|X11)/.test(ua)) return { platform: 'Linux', source: 'ua' };
    return { platform: '', source: 'ua' };
};

export const readOperatingSystem = async () => {
    const hints = typeof navigator !== 'undefined' ? navigator.userAgentData : null;
    if (hints?.getHighEntropyValues) {
        try {
            const high = await hints.getHighEntropyValues(['platform', 'platformVersion', 'architecture']);
            if (high?.platform) {
                return {
                    available: true,
                    platform: high.platform,
                    version: high.platformVersion,
                    architecture: high.architecture,
                    mobile: Boolean(high.mobile),
                    source: 'client-hints',
                };
            }
        } catch {
            // A browser that has the API but will not answer it is the same
            // caller as one that never had it — the UA below still says plenty.
        }
    }
    const fallback = uaOS();
    return { available: Boolean(fallback.platform), reason: fallback.platform ? undefined : 'unsupported', ...fallback };
};

// Where the visitor's own address resolves to. Every card is taken, not just the
// first, because an IPv4 in one country and an IPv6 in another is the finding —
// it is just not this signal's finding; the network signal reports that one.
export const geoSliceFromCards = (cards = []) => {
    const countries = [...new Set(cards
        .filter((card) => card?.ip)
        .map((card) => String(card.country_code || '').toUpperCase())
        .filter((cc) => /^[A-Z]{2}$/.test(cc)))];
    if (!countries.length) return { available: false, reason: 'unresolved' };
    return { available: true, countries };
};

// WebRTC candidates that are actually *the visitor's* interface addresses. A
// `relay` candidate belongs to the TURN server that is relaying the call, so
// counting it as a leak would place the visitor wherever their relay sits — the
// exact mistake this split is meant to avoid. That filter is applied once, where
// the candidates are gathered (`composables/use-egress-leak.js`), which is why this
// reads a list of addresses and not a pile of ICE lines.
//
// `leaks` is `[{ ip, country_code, org }]`: the STUN answers the homepage gathered
// quietly on this visitor's behalf. They lead the country list because a leaked
// address says where the *machine* sits, while an exit only says where the traffic
// entered the internet, and the work order has to test the machine's country first.
export const networkSlice = ({ cards = [], leaks = [] } = {}) => {
    const codesOf = (list) => [...new Set(list
        .map((entry) => String(entry?.country_code || '').toUpperCase())
        .filter((cc) => /^[A-Z]{2}$/.test(cc)))];
    const leaked = codesOf(leaks);
    const exits = codesOf(cards);
    // A boolean, not a count. `requireSplitSignals` reads this field as
    // `=== true`, so an `available: 2` arrives at the scorer as *unavailable* — and
    // the whole network signal silently stops voting, which is exactly what this
    // slice was for.
    const available = leaked.length > 0 || exits.length > 0;
    return {
        available,
        reason: available ? undefined : 'unresolved',
        exitCountries: exits,
        leakedCountries: leaked,
        leakSource: leaked.length ? 'webrtc' : null,
    };
};
