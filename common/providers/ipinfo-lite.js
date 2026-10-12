// ipinfo's Lite endpoint: the ASN registration facts, and the privacy block.
//
// Key-mandatory by choice. The upstream answers keyless queries at a small daily
// pool, and `/api/ipinfo` already spends that pool one call per visitor — the
// same arithmetic that keeps the ipapi.is abuse feed behind `TRUST_IPAPIIS_FEED`
// (see `common/trust-signals.js`). A per-lookup feed on top of a per-visitor key
// turns an exhausted credential into a data gap instead of an outage, so this
// adapter asks only where a token is configured, and reports `missing_key`
// where it is not.
//
// The `abuse` object is not read: `company`, `asn` and `privacy` are what this
// build scores, and a registrant's street address is nobody's evidence.

import { fetchUpstream } from '../fetch-with-timeout.js';
import {
    answered, unavailable, errored, toFlag, toText, toAsn, usageFlags, ipinfoToken, PROVIDER_TIMEOUT_MS,
} from './answer.js';
import logger from '../logger.js';

export const IPINFO_SOURCE = 'ipinfo.io';

const buildUrl = (ip, token) => `https://api.ipinfo.io/lite/${ip}?token=${token}`;

// `37.4220,-122.0841`. A half that does not parse stays null rather than the 0
// `Number('')` would hand back — 0 is a real coordinate.
const splitLoc = (loc) => {
    const [lat, lon] = String(loc ?? '').split(',');
    const number = (value) => {
        const n = Number(value);
        return value?.trim() && Number.isFinite(n) ? n : null;
    };
    return { lat: number(lat), lon: number(lon) };
};

/**
 * Turn the Lite API's JSON into this build's answer.
 *
 * @param {object} body  the vendor's response
 * @returns {object}
 */
export const interpretIpinfoLite = (body) => {
    if (!body || typeof body !== 'object') return errored(IPINFO_SOURCE, 'no-data');
    if (body.error || body.bogon) return errored(IPINFO_SOURCE, body.bogon ? 'bogon' : 'vendor-error');

    const privacy = body.privacy && typeof body.privacy === 'object' ? body.privacy : {};
    // Two live shapes. The paid body nests the ASN record (`asn: {route, type,
    // domain}`, `company: {name}`) and answers `country` with an alpha-2. The free
    // Lite body is flat — `asn: "AS15169"`, `as_name`, `as_domain`, `country_code` —
    // and carries no privacy block, because privacy detection is a separate paid
    // product. Reading only the nested shape turns the flat one into a null ASN plus
    // a display name ("United States") where every consumer expects `US`.
    const asnRecord = body.asn && typeof body.asn === 'object' ? body.asn : {};
    const { lat, lon } = splitLoc(body.loc);
    // A `relay` is Cloudflare Warp, an anonymising exit the vendor names
    // separately from a proxy — and it is the one field on this API that accuses
    // without a `yes` anywhere else in the answer.
    const isProxy = toFlag(privacy.proxy);
    const isVpn = toFlag(privacy.vpn) ?? toFlag(privacy.relay);

    return answered(IPINFO_SOURCE, {
        authority: 'list',
        isProxy,
        isVpn,
        isTor: toFlag(privacy.tor),
        isHosting: toFlag(privacy.hosting) ?? usageFlags(asnRecord.type).isHosting,
        isMobile: null,
        asn: toAsn(asnRecord.route ?? asnRecord.asn ?? body.asn),
        asName: toText(body.company?.name) || toText(asnRecord.domain)
            || toText(body.as_name) || toText(body.as_domain),
        country: toText(body.country_code) || toText(body.country),
        usageType: toText(asnRecord.type),
        lat,
        lon,
        raw: body,
    });
};

export const askIpinfoLite = async (ip) => {
    const token = ipinfoToken();
    if (!token) return unavailable(IPINFO_SOURCE, 'missing_key');

    try {
        const res = await fetchUpstream(buildUrl(ip, token), { timeoutMs: PROVIDER_TIMEOUT_MS });
        if (!res.ok) return errored(IPINFO_SOURCE, `http-${res.status}`);
        return interpretIpinfoLite(await res.json());
    } catch (err) {
        logger.warn({ err, ip }, 'providers: ipinfo.io unavailable');
        return errored(IPINFO_SOURCE, 'request-failed');
    }
};
