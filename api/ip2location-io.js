// /api/ip2location — geolocation source handler backed by api.ip2location.io.
// With IP2LOCATION_API_KEY it picks a random key; without one it asks the same
// endpoint keyless, which the vendor serves at 1,000 lookups per day per server
// with the same body. Either way the response is normalized into the canonical
// geo shape via the shared makeGeoHandler factory.

import { makeGeoHandler } from '../common/geo-handler.js';

function buildUrl(req) {
    const ipAddress = req.query.ip;

    const keys = (process.env.IP2LOCATION_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
    const key = keys.length ? keys[Math.floor(Math.random() * keys.length)] : null;
    return key
        ? `https://api.ip2location.io/?ip=${ipAddress}&key=${key}`
        : `https://api.ip2location.io/?ip=${ipAddress}`;
}

function modifyJsonForIPAPI(json) {
    let asn = json.asn || {};
    const { ip, country_code, country_name, region_name, city_name, latitude, longitude, as } = json;

    return {
        ip: ip,
        city: city_name || 'N/A',
        region: region_name || 'N/A',
        country: country_code || 'N/A',
        country_name: country_name || 'N/A',
        country_code: country_code || 'N/A',
        latitude: latitude || 'N/A',
        longitude: longitude || 'N/A',
        asn: asn === undefined || asn === null ? 'N/A' : 'AS' + asn,
        org: as || 'N/A',
    };
}

export default makeGeoHandler({
    name: 'ip2location-io',
    buildUrl,
    normalize: modifyJsonForIPAPI,
});
