// Iconify without the network. `@iconify/vue` fetches any icon it has not been
// given from api.iconify.design (falling back to api.simplesvg.com and
// api.unisvg.com) — a third-party request on every page that shows a flag before
// the circle-flags JSON has arrived, and on every brand glyph. This module
// answers every lookup from the bundle instead:
//   - circle-flags: the whole set from `@iconify-json/circle-flags` (lazy chunk,
//     the same JSON main.js preloads after mount);
//   - ri / simple-icons / bxl: the few glyphs the app names, vendored in
//     frontend/data/iconify-subset.json (regenerate with
//     `node scripts/build-iconify-subset.mjs`);
//   - anything else: the API fetch is stubbed to reject, so an unknown name
//     renders nothing rather than leaving the page.
import { _api, setCustomIconsLoader } from '@iconify/vue';

let flagSet = null;
const loadFlagSet = () => {
    flagSet ||= import('@iconify-json/circle-flags/icons.json').then((m) => m.default || m);
    return flagSet;
};

let subset = null;
const loadSubset = () => {
    subset ||= import('../data/iconify-subset.json').then((m) => m.default || m);
    return subset;
};

// Return an IconifyJSON limited to the requested names (the loader contract).
export const pickIcons = (set, names) => {
    if (!set) return null;
    const icons = {};
    const aliases = {};
    for (const name of names) {
        if (set.icons?.[name]) icons[name] = set.icons[name];
        else if (set.aliases?.[name]) {
            aliases[name] = set.aliases[name];
            const parent = set.aliases[name].parent;
            if (set.icons?.[parent]) icons[parent] = set.icons[parent];
        }
    }
    const out = { prefix: set.prefix, icons, aliases };
    for (const k of ['width', 'height', 'left', 'top']) if (set[k] !== undefined) out[k] = set[k];
    return out;
};

export const OFFLINE_PREFIXES = ['circle-flags', 'ri', 'simple-icons', 'bxl'];

export const installOfflineIcons = () => {
    setCustomIconsLoader(async (names) => pickIcons(await loadFlagSet(), names), 'circle-flags');
    for (const prefix of ['ri', 'simple-icons', 'bxl']) {
        setCustomIconsLoader(async (names) => {
            const sets = await loadSubset();
            return pickIcons(sets.find((s) => s.prefix === prefix), names);
        }, prefix);
    }
    _api.setFetch(() => Promise.reject(new Error('iconify API disabled: icons are bundled')));
};

export { loadFlagSet };
