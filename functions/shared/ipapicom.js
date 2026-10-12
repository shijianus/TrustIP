// `ipapicom` — geolocation from ip-api.com, the key-free source the SPA lists as
// id 2. Same URL (including its `fields` bitmask) and same canonical shape as
// api/ipapi-com.js; see shared/geo-handler.js for why the timezone is passed
// through rather than derived.

import { makeGeoHandler, passThroughTimeZone } from './geo-handler.js';

const buildUrl = (params) => {
    // Same allow-list as common/lang-param.js: a raw `lang=en%26callback%3Dx`
    // used to append its own query parameters to the upstream URL.
    const raw = params.get('lang');
    const lang = raw && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(raw) ? raw : 'en';
    return {
        url: `http://ip-api.com/json/${params.get('ip')}?fields=66842623&lang=${encodeURIComponent(lang)}`,
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
