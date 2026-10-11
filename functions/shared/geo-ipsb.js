// `ipsb` — geolocation from api.ip.sb, the key-free source the SPA lists as id 5.
// Same URL and same canonical shape as api/ip-sb.js; see shared/geo-handler.js for
// why the timezone is passed through rather than derived.

import { makeGeoHandler, passThroughTimeZone } from './geo-handler.js';

const buildUrl = (params) => `https://api.ip.sb/geoip/${params.get('ip')}`;

const normalize = (json) => passThroughTimeZone({
    ip: json.ip,
    city: json.city,
    region: json.region ? json.region : json.city,
    country: json.country_code,
    country_name: json.country,
    country_code: json.country_code,
    latitude: json.latitude,
    longitude: json.longitude,
    asn: 'AS' + json.asn,
    org: json.isp,
}, json.timezone);

export default makeGeoHandler({ name: 'ip-sb', buildUrl, normalize, cacheSeconds: 24 * 60 * 60 });
