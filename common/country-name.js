// Localized country/region names via the built-in Intl.DisplayNames API.
// Names come from the runtime's CLDR/ICU data, so any ISO 3166-1 alpha-2 code
// resolves in any supported locale with zero maintenance and zero bundle weight.

const displayNamesCache = new Map();
// `lang` can come straight from a query string, so the cache is capped: past
// this many distinct tags, new ones are built per call instead of retained.
const DISPLAY_NAMES_CACHE_MAX = 64;

const getDisplayNames = (lang) => {
    if (!displayNamesCache.has(lang)) {
        if (displayNamesCache.size >= DISPLAY_NAMES_CACHE_MAX) {
            try {
                return new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' });
            } catch {
                return null;
            }
        }
        let displayNames = null;
        try {
            // fallback: 'none' → unknown-but-well-formed codes yield undefined
            // instead of echoing the code back, so callers get '' as before
            displayNames = new Intl.DisplayNames([lang], { type: 'region', fallback: 'none' });
        } catch {
            // malformed / unsupported locale — cache the null so we don't retry
        }
        displayNamesCache.set(lang, displayNames);
    }
    return displayNamesCache.get(lang);
};

const getCountryName = (abbr, lang) => {
    if (typeof abbr !== 'string' || typeof lang !== 'string') return '';
    const code = abbr.toUpperCase();
    // ZZ is the ISO "unknown region" placeholder; return '' so callers can fall back
    if (!/^[A-Z]{2}$/.test(code) || code === 'ZZ') return '';
    const displayNames = getDisplayNames(lang);
    return (displayNames && displayNames.of(code)) || '';
};

// English country name → ISO 3166-1 alpha-2, for the one key-free source that
// answers with a name and no code (api.ipapi.is's free tier). Built once from
// the runtime's CLDR names; a name CLDR spells differently ("Korea, Republic
// of") is not guessed at and answers null.
let codeByEnglishName = null;
const normalizeName = (name) => name.toLowerCase().replace(/[^a-z]/g, '');

export const countryCodeFromName = (name) => {
    if (typeof name !== 'string' || !name.trim()) return null;
    if (!codeByEnglishName) {
        codeByEnglishName = new Map();
        const en = getDisplayNames('en');
        if (en) {
            for (let a = 65; a <= 90; a += 1) {
                for (let b = 65; b <= 90; b += 1) {
                    const code = String.fromCharCode(a, b);
                    if (code === 'ZZ') continue;
                    const label = en.of(code);
                    if (label) codeByEnglishName.set(normalizeName(label), code);
                }
            }
        }
    }
    return codeByEnglishName.get(normalizeName(name)) ?? null;
};

export default getCountryName;
