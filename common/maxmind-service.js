// The MaxMind-format geolocation readers behind /api/maxmind: GeoLite2 City +
// ASN when those files are on disk (MaxMind credentials, or dropped in by
// hand), else DB-IP's free IP-to-City Lite + IP-to-ASN Lite (CC BY 4.0, same
// MMDB schema; downloaded keyless by the `dbip` dataset row). GeoLite2 is
// always preferred; a DB-IP answer carries the attribution its licence asks for.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import maxmind from 'maxmind';
import logger from './logger.js';
import { matchLocale } from './locale-registry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const MAXMIND_DB_DIR = path.resolve(__dirname, './maxmind-db');
export const MAXMIND_CITY_DB = 'GeoLite2-City.mmdb';
export const MAXMIND_ASN_DB = 'GeoLite2-ASN.mmdb';

const cityDbPath = path.join(MAXMIND_DB_DIR, MAXMIND_CITY_DB);
const asnDbPath = path.join(MAXMIND_DB_DIR, MAXMIND_ASN_DB);

export const DBIP_DB_DIR = path.resolve(__dirname, './dbip-db');
export const DBIP_CITY_DB = 'dbip-city-lite.mmdb';
export const DBIP_ASN_DB = 'dbip-asn-lite.mmdb';
// CC BY 4.0 attribution, worded and linked as https://db-ip.com/db/lite.php asks.
export const DBIP_ATTRIBUTION = Object.freeze({
    text: 'IP Geolocation by DB-IP',
    url: 'https://db-ip.com',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
});
export const GEO_SOURCE = Object.freeze({ geolite2: 'geolite2', dbip: 'dbip-lite' });

const dbipPaths = () => ({
    dbDir: DBIP_DB_DIR,
    cityDbPath: path.join(DBIP_DB_DIR, DBIP_CITY_DB),
    asnDbPath: path.join(DBIP_DB_DIR, DBIP_ASN_DB),
});

// The languages the City database carries `names` for — a property of the data
// itself, not of the UI: registering a new front-end locale changes nothing
// here, and this list only moves if MaxMind's own coverage does.
export const SUPPORTED_LANGS = ['de', 'en', 'es', 'fr', 'ja', 'pt-BR', 'ru', 'zh-CN'];

// Resolve any BCP-47 tag onto that set: exact match (canonical spelling wins),
// then the base language, then a sibling of the same family — `zh-TW` reads
// `zh-CN` names rather than falling all the way to English. Anything else, junk
// included, lands on `en`. Family resolution is defined once, in the locale
// registry; only the resolver is borrowed, never its list of UI locales.
export const normalizeLang = (tag) => {
    if (typeof tag !== 'string') return 'en';
    return matchLocale(tag.trim(), SUPPORTED_LANGS) ?? 'en';
};

let cityLookup = null;
let asnLookup = null;
let activeSource = null;
let reloadPromise = null;

/**
 * Return the canonical MaxMind database paths.
 */
export function getMaxMindDbPaths() {
    return {
        dbDir: MAXMIND_DB_DIR,
        cityDbPath,
        asnDbPath,
    };
}

/**
 * The pair to open: GeoLite2 when both of its files are present, else DB-IP
 * Lite when both of those are, else GeoLite2's paths (which then fail to open,
 * as before). `exists` is injectable for tests.
 */
export const pickGeoDbPaths = (exists = fs.existsSync) => {
    const geolite = getMaxMindDbPaths();
    if (exists(geolite.cityDbPath) && exists(geolite.asnDbPath)) return { ...geolite, source: GEO_SOURCE.geolite2 };
    const dbip = dbipPaths();
    if (exists(dbip.cityDbPath) && exists(dbip.asnDbPath)) return { ...dbip, source: GEO_SOURCE.dbip };
    return { ...geolite, source: GEO_SOURCE.geolite2 };
};

/** Which database answers /api/maxmind: 'geolite2', 'dbip-lite', or null when none is loaded. */
export const getGeoSource = () => (cityLookup && asnLookup ? activeSource : null);

/**
 * Report whether both City and ASN readers are ready to serve lookups.
 */
export function isMaxMindReady() {
    return Boolean(cityLookup && asnLookup);
}

/**
 * Open fresh MaxMind readers from the provided database paths.
 */
export async function openMaxMindReaders(dbPaths = getMaxMindDbPaths()) {
    const [city, asn] = await Promise.all([
        maxmind.open(dbPaths.cityDbPath),
        maxmind.open(dbPaths.asnDbPath),
    ]);

    return { city, asn };
}

/**
 * Replace the active MaxMind readers after both databases are opened successfully.
 */
export async function reloadMaxMindDatabases(reason = 'manual') {
    if (reloadPromise) {
        return reloadPromise;
    }

    const paths = pickGeoDbPaths();
    reloadPromise = openMaxMindReaders(paths)
        .then(({ city, asn }) => {
            cityLookup = city;
            asnLookup = asn;
            activeSource = paths.source;
            logger.info(`📦 ${paths.source === GEO_SOURCE.dbip ? 'DB-IP Lite' : 'MaxMind'} databases loaded (${reason})`);
            return true;
        })
        .catch(error => {
            logger.error({ err: error, reason }, 'Failed to load MaxMind databases');
            throw error;
        })
        .finally(() => {
            reloadPromise = null;
        });

    return reloadPromise;
}

/**
 * Bare ISO country code of an IP (null when unknown) plus the prefix length
 * of the MaxMind network holding it, so a caller can walk a range one network
 * at a time — the bgp-prefixes Radar view does, thousands of times per
 * request. No formatting, no 503 throw: null when there is no answer — the
 * City database isn't loaded, or the lookup failed — so the caller can tell
 * it from an address MaxMind places in no country ({ country: null }).
 */
export const lookupCountryRange = (ip) => {
    if (!cityLookup) return null;
    try {
        const [record, prefixLength] = cityLookup.getWithPrefixLength(ip);
        return { country: record?.country?.iso_code || null, prefixLength };
    } catch {
        return null;
    }
};

/**
 * Look up an IP address and return the API response shape expected by the frontend.
 * `lang` is any raw tag — normalization happens here, so no caller can skip it.
 */
export function lookupMaxMind(ip, lang) {
    if (!isMaxMindReady()) {
        const error = new Error('MaxMind database is not ready');
        error.statusCode = 503;
        throw error;
    }

    const city = cityLookup.get(ip);
    const asn = asnLookup.get(ip);

    const result = formatMaxMindResult(ip, normalizeLang(lang), city, asn);
    // Only a DB-IP answer grows the two fields, so a GeoLite2 body keeps its shape.
    return activeSource === GEO_SOURCE.dbip
        ? { ...result, source: GEO_SOURCE.dbip, attribution: DBIP_ATTRIBUTION }
        : result;
}

/**
 * Pick the requested localized name with English and N/A fallbacks.
 */
function getLocalizedName(names, lang) {
    if (!names) {
        return 'N/A';
    }

    return names[lang] || names.en || 'N/A';
}

/**
 * Normalize MaxMind City and ASN records into this API's stable JSON format.
 */
function formatMaxMindResult(ip, lang, city, asn) {
    city = city || {};
    asn = asn || {};

    return {
        ip,
        city: city.city ? getLocalizedName(city.city.names, lang) : 'N/A',
        region: city.subdivisions?.[0] ? getLocalizedName(city.subdivisions[0].names, lang) : 'N/A',
        country: city.country ? city.country.iso_code : 'N/A',
        country_name: city.country ? getLocalizedName(city.country.names, lang) : 'N/A',
        country_code: city.country ? city.country.iso_code : 'N/A',
        latitude: city.location ? city.location.latitude : 'N/A',
        longitude: city.location ? city.location.longitude : 'N/A',
        asn: asn.autonomous_system_number ? `AS${asn.autonomous_system_number}` : 'N/A',
        org: asn.autonomous_system_organization ? asn.autonomous_system_organization : 'N/A',
    };
}
