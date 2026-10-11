// IP2Location.io's answer for one address.
//
// On the plan this fork can reach without a subscription, the detection fields
// (`is_proxy`, `is_datacenter`) are not in the response at all — they belong to
// the paid tiers — so what this source contributes is geolocation and the block's
// registered `usageType`. Returning those and leaving the flags `null` is the
// honest answer; a `false` would be a clearance nobody issued.
//
// Key-mandatory: the upstream's free tier is keyed too, so a deployment without
// `IP2LOCATION_API_KEY` reports `unavailable`. The free plan requires attribution
// for the *geolocation* product (see `README.md`); the fields read here are the
// block's registration label and its coordinates, which the source card already
// cites.

import { fetchUpstream } from '../fetch-with-timeout.js';
import {
    answered, unavailable, errored, toFlag, toNumber, toText, toAsn, usageFlags, pickKey, PROVIDER_TIMEOUT_MS,
} from './answer.js';
import logger from '../logger.js';

export const IP2LOCATION_SOURCE = 'ip2location.io';

const buildUrl = (ip, key) => `https://api.ip2location.io/?ip=${ip}&key=${key}&format=json`;

/**
 * Turn IP2Location's JSON into this build's answer.
 *
 * `True`/`False` strings and real booleans both appear across this vendor's
 * endpoints and versions, so every flag goes through `toFlag` rather than a
 * truthiness test — `toFlag('False')` is `false` and `toFlag(undefined)` is
 * `null`, which is the whole difference this adapter could get wrong.
 *
 * @param {object} body  the vendor's response
 * @returns {object}
 */
export const interpretIp2location = (body) => {
    if (body?.error || body?.status === 'error') return errored(IP2LOCATION_SOURCE, body?.code ? `code-${body.code}` : 'vendor-error');
    const usage = usageFlags(body?.usage_type);

    return answered(IP2LOCATION_SOURCE, {
        authority: 'observation',
        isProxy: toFlag(body?.is_proxy),
        isVpn: toFlag(body?.is_vpn),
        isTor: toFlag(body?.is_tor),
        // Read from the paid flag when the plan carries it, otherwise from the
        // registered usage label — and labelled observation authority either way,
        // because a block allocated to a data centre is a fact about the block,
        // not about what the visitor in front of it is running.
        isHosting: toFlag(body?.is_datacenter) ?? usage.isHosting,
        isMobile: usage.isMobile,
        asn: toAsn(body?.asn ?? body?.as),
        asName: toText(body?.as) || toText(body?.isp),
        country: toText(body?.country_code),
        usageType: toText(body?.usage_type),
        lat: toNumber(body?.latitude),
        lon: toNumber(body?.longitude),
        raw: body,
    });
};

export const askIp2location = async (ip) => {
    const key = pickKey('IP2LOCATION_API_KEY');
    if (!key) return unavailable(IP2LOCATION_SOURCE, 'missing_key');

    try {
        const res = await fetchUpstream(buildUrl(ip, key), { timeoutMs: PROVIDER_TIMEOUT_MS });
        if (!res.ok) return errored(IP2LOCATION_SOURCE, `http-${res.status}`);
        return interpretIp2location(await res.json());
    } catch (err) {
        logger.warn({ err, ip }, 'providers: ip2location.io unavailable');
        return errored(IP2LOCATION_SOURCE, 'request-failed');
    }
};
