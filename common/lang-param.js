// `?lang` arrives from the browser and is only ever a UI language hint. It is
// forwarded into upstream URLs, so anything that isn't a plain BCP-47-ish tag
// (letters/digits/hyphens, 2-3 letter primary subtag) falls back to English.
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/;

export const normalizeLang = (value, fallback = 'en') =>
    (typeof value === 'string' && LANG_RE.test(value) ? value : fallback);
