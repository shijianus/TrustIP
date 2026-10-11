// The Express guards from common/guards.js, re-shaped for a runtime without
// middleware: each one takes the parsed query (mutable, so a canonicalising
// guard can write its lower/uppercased value back exactly as Express did) and
// answers either `null` — passed — or the Response to return instead.
//
// Messages and status codes are carried over verbatim; the SPA reads the status,
// and a drift here would silently change which branch a UI error message takes.

import { json } from './respond.js';
import { isValidIP, isValidDomain, isUsablePublicIP } from './valid-ip.js';
import { isValidBgpPrefix } from './bgp-prefix.js';
import { DNS_RECORD_TYPE_SET } from './dns-record-types.js';
import { STATUS_PROVIDER_IDS } from './service-status-providers.js';

const bad = (error) => json({ error }, { status: 400 });

export const requirePublicIP = (params, paramName = 'ip') => {
    const ip = params.get(paramName);
    if (!ip) return bad('No IP address provided');
    if (!isValidIP(ip)) return bad('Invalid IP address');
    if (!isUsablePublicIP(ip)) return bad('Not a public IP address');
    return null;
};

export const requireValidDomain = (params, paramName = 'domain') => {
    const raw = params.get(paramName);
    if (!raw) return bad('No domain provided');
    const domain = String(raw).toLowerCase();
    if (!isValidDomain(domain)) return bad('Invalid domain');
    params.set(paramName, domain);
    return null;
};

export const requireValidPrefix = (params, paramName = 'prefix') => {
    const prefix = params.get(paramName);
    if (!prefix) return bad('No prefix provided');
    if (!isValidBgpPrefix(prefix)) return bad('Invalid prefix');
    return null;
};

export const requireValidRecordType = (params, paramName = 'type') => {
    const type = params.get(paramName);
    if (!type) return bad('No record type provided');
    if (!DNS_RECORD_TYPE_SET.has(String(type).toUpperCase())) return bad('Invalid record type');
    params.set(paramName, String(type).toUpperCase());
    return null;
};

export const requireValidProviderId = (params, paramName = 'id') => {
    const id = params.get(paramName);
    if (!id) return bad('No provider id provided');
    if (!STATUS_PROVIDER_IDS.has(id)) return bad('Invalid provider id');
    return null;
};

// --- POST /split body ---------------------------------------------------------
//
// The route is pure arithmetic on a stranger's payload, so every list, object
// and string gets a ceiling and a value past it is dropped rather than truncated:
// a clipped zone name resolves to no country and would read as a measurement.
const CC_SET = /^[A-Z]{2}$/;
const SIGNAL_IDS = ['geo', 'os', 'tz', 'ime', 'lang', 'net'];
const LIMITS = { codes: 12, languages: 6, keys: 32, short: 64, long: 128 };

const codesUpTo = (list) => (Array.isArray(list)
    ? [...new Set(list.filter((c) => typeof c === 'string' && CC_SET.test(c)))].slice(0, LIMITS.codes)
    : []);

const trimmed = (value, max) => (typeof value === 'string' && value.length <= max ? value : undefined);

const cleanSlice = (slice, id) => {
    if (!slice || typeof slice !== 'object' || Array.isArray(slice)) return undefined;
    // `available` is read as `=== true`, so a producer that sends a count ships a
    // signal this scorer treats as never measured.
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

/**
 * @param {unknown} body  the parsed JSON body
 * @returns {{ error?: string, value?: { signals: object, countries: string[] } }}
 */
export const requireSplitSignals = (body) => {
    const source = body ?? {};
    if (typeof source !== 'object' || Array.isArray(source)) return { error: 'Invalid body' };
    if (source.signals !== undefined && (typeof source.signals !== 'object' || source.signals === null || Array.isArray(source.signals))) {
        return { error: 'Invalid signals' };
    }
    const signals = {};
    for (const id of SIGNAL_IDS) {
        const slice = cleanSlice(source.signals?.[id], id);
        if (slice) signals[id] = slice;
    }
    // An empty signals object is a legitimate request: asking "what does nothing
    // at all tell you?" has an answer, and it is "nothing".
    return {
        value: {
            signals,
            countries: codesUpTo((Array.isArray(source.countries) ? source.countries : [])
                .map((c) => String(c).toUpperCase())),
        },
    };
};
