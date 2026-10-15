// /api/ipapiis — geolocation source handler backed by api.ipapi.is.
// With IPAPIIS_API_KEY it picks a random key and reads the full record (plus
// isHosting / isProxy); without one it reads the same endpoint's free tier
// (no key, ~1000 lookups/day per server), whose flat body carries location and
// AS but none of the privacy flags. Both normalize into the canonical geo shape
// via the shared makeGeoHandler factory, so a blank `.env` still gets the card.

import getCountryName, { countryCodeFromName } from '../common/country-name.js';
import { makeGeoHandler } from '../common/geo-handler.js';
import { pickIpApiIsKey } from '../common/ipapi-key.js';

function buildUrl(req) {
    const ipAddress = req.query.ip;
    const key = pickIpApiIsKey();
    return key
        ? `https://api.ipapi.is?q=${ipAddress}&key=${key}`
        : `https://api.ipapi.is?q=${ipAddress}`;
}

// The free tier's flat body: `asn` is one string ("AS15169 Google LLC"),
// `country` an English name, coordinates as `lat` / `lon`. No privacy flags are
// sent, so `isHosting` / `isProxy` stay absent rather than read as false.
export const modifyFreeTierJson = (json) => {
    const asnMatch = /^AS(\d+)\s*(.*)$/i.exec(String(json.asn || ''));
    const code = countryCodeFromName(json.country);
    return {
        ip: json.ip,
        city: json.city || 'N/A',
        region: json.region || 'N/A',
        country: code || 'N/A',
        country_name: (code && getCountryName(code, 'en')) || json.country || 'N/A',
        country_code: code || 'N/A',
        latitude: json.lat ?? 'N/A',
        longitude: json.lon ?? 'N/A',
        asn: asnMatch ? `AS${asnMatch[1]}` : 'N/A',
        org: json.company || (asnMatch && asnMatch[2]) || 'N/A',
    };
};

// Both nested objects are optional: the upstream answers 200 with a null
// `location` (and no `asn`) for addresses it can't place — anycast ranges,
// bogons — so neither may be dereferenced directly.
export function modifyJsonForIPAPI(json) {
    // A string `asn` is the free tier's flat body (no key configured).
    if (typeof json.asn === 'string' || (json.location === undefined && json.lat !== undefined)) {
        return modifyFreeTierJson(json);
    }
    const asn = json.asn || {};
    const location = json.location || {};
    const { ip, is_datacenter, is_proxy, is_vpn, is_tor } = json;

    return {
        ip: ip,
        city: location.city || 'N/A',
        region: location.state || 'N/A',
        country: location.country_code || 'N/A',
        country_name: location.country || 'N/A',
        country_code: location.country_code || 'N/A',
        latitude: location.latitude || 'N/A',
        longitude: location.longitude || 'N/A',
        asn: asn.asn === undefined ? 'N/A' : 'AS' + asn.asn,
        org: asn.org || 'N/A',
        isHosting: is_datacenter || false,
        isProxy: is_proxy || is_vpn || is_tor || false
    };
}

export default makeGeoHandler({
    name: 'ipapi-is',
    buildUrl,
    normalize: modifyJsonForIPAPI,
});
