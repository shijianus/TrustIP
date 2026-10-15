// Express middleware that factors out the boilerplate every api/ handler
// used to repeat at the top of its function body: referer check, param
// presence check, param validity check. Mount once in backend-server.js;
// handlers stop carrying the defensive checks and can't accidentally forget
// them.

import { refererCheck } from './referer-check.js';
import { isValidIP, isValidDomain, isUsablePublicIP } from './valid-ip.js';
import { isValidBgpPrefix } from './bgp-prefix.js';
import { STATUS_PROVIDER_IDS } from './service-status-providers.js';
import { DNS_RECORD_TYPE_SET } from './dns-record-types.js';
import { parseAsnInput } from './asn-input.js';

// Write a canonical value back for the handlers behind a guard. Express 5
// makes `req.query` a getter that re-parses the URL on every read, so
// `req.query[k] = v` is silently lost and the handler sees the raw input
// (`AS13335` reaching `Number()` as NaN). An own `query` property on the
// request shadows the getter, so every later reader — handlers, the cache
// key, the cf-radar dispatcher's `view.fetch(req.query)` — sees the
// canonical value.
export const setQueryParam = (req, name, value) => {
    Object.defineProperty(req, 'query', {
        value: { ...req.query, [name]: value },
        configurable: true,
        enumerable: true,
        writable: true,
    });
};

// Reject requests without an allowed referer. The error message variant
// preserves the existing user-facing wording.
export const requireReferer = (req, res, next) => {
    const referer = req.headers.referer;
    if (!refererCheck(referer)) {
        return res.status(403).json({
            error: referer ? 'Access denied' : 'What are you doing?',
        });
    }
    next();
};

// Reject requests whose IP query param isn't a publicly routable address.
// Every `?ip=` route asks an external service about that address — a
// registry, a geolocation source — and reserved space has no answer there,
// so it never reaches an upstream call. Malformed input and reserved space
// get distinct messages; the two failures need different fixes.
// Factory so a route using another param name (none today, but leaving the
// door open) can say `requirePublicIP('target')`.
export const requirePublicIP = (paramName = 'ip') => (req, res, next) => {
    const ip = req.query[paramName];
    if (!ip) {
        return res.status(400).json({ error: 'No IP address provided' });
    }
    if (!isValidIP(ip)) {
        return res.status(400).json({ error: 'Invalid IP address' });
    }
    if (!isUsablePublicIP(ip)) {
        return res.status(400).json({ error: 'Not a public IP address' });
    }
    next();
};

// Reject requests without a syntactically valid domain in the specified
// query param. Lowercases the value (setQueryParam) so handlers and the edge cache
// see one canonical form (domains are case-insensitive; a mixed-case query
// must not become a distinct CF cache entry).
export const requireValidDomain = (paramName = 'domain') => (req, res, next) => {
    const raw = req.query[paramName];
    if (!raw) {
        return res.status(400).json({ error: 'No domain provided' });
    }
    const domain = String(raw).toLowerCase();
    if (!isValidDomain(domain)) {
        return res.status(400).json({ error: 'Invalid domain' });
    }
    setQueryParam(req, paramName, domain);
    next();
};

// Reject requests without a valid CIDR prefix in the specified query param.
// Accepts any well-formed CIDR — the quantization policy (e.g. /24 for v4,
// /48 for v6) is the frontend's job, not the guard's.
export const requireValidPrefix = (paramName = 'prefix') => (req, res, next) => {
    const prefix = req.query[paramName];
    if (!prefix) {
        return res.status(400).json({ error: 'No prefix provided' });
    }
    if (!isValidBgpPrefix(prefix)) {
        return res.status(400).json({ error: 'Invalid prefix' });
    }
    next();
};

// Reject requests without a valid ASN (AS1 … AS4294967295, up to ten
// digits, optional 'AS' prefix — parseAsnInput in common/asn-input.js) and
// rewrite it (setQueryParam) to the canonical number string (`AS013335` → `13335`),
// so the edge cache sees one key. Used by /api/asn-connectivity,
// /api/asn-profile and, per-view, the /api/cfradar dispatcher.
export const requireValidASN = (paramName = 'asn') => (req, res, next) => {
    const raw = req.query[paramName];
    if (!raw) {
        return res.status(400).json({ error: 'No ASN provided' });
    }
    const asn = parseAsnInput(raw);
    if (asn === null) {
        return res.status(400).json({ error: 'Invalid ASN' });
    }
    setQueryParam(req, paramName, String(asn));
    next();
};

// Canonicalize an ASN-shaped value (`AS13335`, `as13335` — the `AS` prefix
// is required) to `AS<n>` (setQueryParam), rejecting AS0 and anything past 32 bits.
// Any other value, a bare number included, passes through untouched —
// /api/whois also takes IPs and domains, which its handler validates.
export const normalizeAsnQuery = (paramName = 'q') => (req, res, next) => {
    const raw = req.query[paramName];
    if (typeof raw !== 'string' || !/^AS\d+$/i.test(raw.trim())) return next();
    const asn = parseAsnInput(raw, { requirePrefix: true });
    if (asn === null) {
        return res.status(400).json({ error: 'Invalid ASN' });
    }
    setQueryParam(req, paramName, `AS${asn}`);
    next();
};

// Reject requests without a two-letter country code; uppercases it (setQueryParam) so
// the edge cache sees one canonical key. Syntactic only — an unassigned code
// just yields an empty upstream series.
export const requireValidCountry = (paramName = 'country') => (req, res, next) => {
    const raw = req.query[paramName];
    if (!raw) {
        return res.status(400).json({ error: 'No country provided' });
    }
    if (!/^[A-Za-z]{2}$/.test(raw)) {
        return res.status(400).json({ error: 'Invalid country' });
    }
    setQueryParam(req, paramName, String(raw).toUpperCase());
    next();
};

// Reject requests whose report id doesn't look like one we issued: 16 random
// bytes as base64url, always exactly 22 chars. Reads the ROUTE param (not the
// query) — the share-report read endpoint is /api/report/:id.
export const requireValidReportId = (paramName = 'id') => (req, res, next) => {
    const id = req.params?.[paramName];
    if (!id || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
        return res.status(400).json({ error: 'Invalid report id' });
    }
    next();
};

// Whitelist ?type= against the record types the resolver actually handles.
// Without it the DoH branch forwards any string verbatim to four third-party
// endpoints, which makes this route a query proxy for types we never support.
export const requireValidRecordType = (paramName = 'type') => (req, res, next) => {
    const type = req.query[paramName];
    if (!type) {
        return res.status(400).json({ error: 'No record type provided' });
    }
    if (!DNS_RECORD_TYPE_SET.has(String(type).toUpperCase())) {
        return res.status(400).json({ error: 'Invalid record type' });
    }
    setQueryParam(req, paramName, String(type).toUpperCase());
    next();
};

// Reject requests whose `id` isn't a known service-status provider slug.
// Used by the per-provider components / incidents endpoints, which select a
// row from the in-memory snapshot by id.
export const requireValidProviderId = (paramName = 'id') => (req, res, next) => {
    const id = req.query[paramName];
    if (!id) {
        return res.status(400).json({ error: 'No provider id provided' });
    }
    if (!STATUS_PROVIDER_IDS.has(id)) {
        return res.status(400).json({ error: 'Invalid provider id' });
    }
    next();
};

// Validate and trim the profile body `POST /api/split` scores.
//
// This is the one body-shaped input the API scores rather than proxies, so the
// shape rule lives here with every other rule instead of being re-typed in the
// handler. The route is pure arithmetic, so what a bad body costs is CPU on a
// stranger's request: every list, object and string below gets a ceiling, and a
// value past it is dropped rather than truncated — a signals object that lost its
// third language is still a signals object, and quietly clipping a string would
// make a zone name that no longer resolves to anything.
//
// Unknown keys are removed, so the handler can trust that whatever reaches
// `scoreProfile` is one of the six slices it knows.
const CC_SET = /^[A-Z]{2}$/;
const SIGNAL_IDS = ['geo', 'os', 'tz', 'ime', 'lang', 'net'];
const LIMITS = { codes: 12, languages: 6, keys: 32, short: 64, long: 128 };

const codesUpTo = (list) => (Array.isArray(list)
    ? [...new Set(list.filter((c) => typeof c === 'string' && CC_SET.test(c)))].slice(0, LIMITS.codes)
    : []);

const trimmed = (value, max) => (typeof value === 'string' && value.length <= max ? value : undefined);

const cleanSlice = (slice, id) => {
    if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return undefined;
    const out = { available: slice.available === true };
    if (slice.reason) out.reason = trimmed(slice.reason, LIMITS.short) || 'unsupported';
    if (id === 'geo' || id === 'net') {
        if (Array.isArray(slice.countries)) out.countries = codesUpTo(slice.countries.map((c) => String(c).toUpperCase()));
        if (Array.isArray(slice.exitCountries)) out.exitCountries = codesUpTo(slice.exitCountries.map((c) => String(c).toUpperCase()));
        if (Array.isArray(slice.leakedCountries)) out.leakedCountries = codesUpTo(slice.leakedCountries.map((c) => String(c).toUpperCase()));
    }
    if (id === 'os') {
        const platform = trimmed(slice.platform, LIMITS.short);
        const version = trimmed(slice.version, LIMITS.short);
        if (platform) out.platform = platform;
        if (version) out.version = version;
    }
    if (id === 'tz' && trimmed(slice.zone, LIMITS.long)) out.zone = slice.zone;
    if (id === 'lang' && Array.isArray(slice.languages)) {
        out.languages = slice.languages.filter((t) => typeof t === 'string' && t.length <= LIMITS.short).slice(0, LIMITS.languages);
    }
    if (id === 'ime') {
        const layout = trimmed(slice.layout, LIMITS.short);
        if (layout) out.layout = layout;
        // code → character: the pairs the layout map actually returns. Both
        // halves of every entry are one character in a working browser, and
        // anything longer is a caller inventing data.
        if (slice.keys && typeof slice.keys === 'object' && !Array.isArray(slice.keys)) {
            const keys = {};
            for (const [code, ch] of Object.entries(slice.keys).slice(0, LIMITS.keys)) {
                if (typeof ch === 'string' && ch.length >= 1 && ch.length <= 4 && code.length <= LIMITS.short) keys[code] = ch;
            }
            if (Object.keys(keys).length) out.keys = keys;
        }
    }
    return out;
};

export const requireSplitSignals = () => (req, res, next) => {
    const body = req.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)) {
        return res.status(400).json({ error: 'Invalid body' });
    }
    if (body.signals !== undefined && (typeof body.signals !== 'object' || body.signals === null || Array.isArray(body.signals))) {
        return res.status(400).json({ error: 'Invalid signals' });
    }
    const signals = {};
    for (const id of SIGNAL_IDS) {
        const slice = cleanSlice(body.signals?.[id], id);
        if (slice) signals[id] = slice;
    }
    // The scorer reads an absent signal exactly like an unmeasured one, so an
    // empty object is a legitimate request rather than a rejected one: asking
    // "what does nothing at all tell you?" has an answer, and it is "nothing".
    req.body = { signals, countries: codesUpTo((Array.isArray(body.countries) ? body.countries : []).map((c) => String(c).toUpperCase())) };
    next();
};
