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

export default getCountryName;
