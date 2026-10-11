// `ipapicom` — geolocation from ip-api.com, the key-free source the SPA lists as
// id 2. Same URL (including its `fields` bitmask) and same canonical shape as
// api/ipapi-com.js; see shared/geo-handler.js for why the timezone is passed
// through rather than derived.

import { makeGeoHandler, passThroughTimeZone } from './geo-handler.js';

const buildUrl = (params) => {
    const lang = params.get('lang') || 'en';
    return {
        url: `http://ip-api.com/json/${params.get('ip')}?fields=66842623&lang=${lang}`,
    };
};

const normalize = (json) => {
    const { query, country, countryCode, regionName, city, lat, lon, isp, as: asText, timezone } = json;
    const asn = asText ? asText.split(' ')[0] : '';

    return passThroughTimeZone({
        ip: query,
        city,
        region: regionName,
        country: countryCode,
        country_name: country,
        country_code: countryCode,
        latitude: lat,
        longitude: lon,
        asn,
        org: isp,
    }, timezone);
};

export default makeGeoHandler({ name: 'ipapi-com', buildUrl, normalize, cacheSeconds: 24 * 60 * 60 });
