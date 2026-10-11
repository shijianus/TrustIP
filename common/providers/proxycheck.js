// proxycheck.io's anonymiser verdict for one address.
//
// A `list` source: the vendor's product is the anonymiser database, so one `yes`
// from it decides a capability on its own (see vote.js — an observation source
// like a port scan may not). Its numbers are percentages, and `risk` is the
// vendor's own abuse-confidence figure, published with no stated relationship to
// anybody else's scale, so it is normalised at the merge rather than here.
//
// The response is keyed by the queried address rather than being the answer, so
// the entry is looked up by that key. `interpretProxycheck` falls back to the
// single non-status key because an IPv6 address comes back in the vendor's own
// normalisation (lower-cased, `::`-compressed), which is not the string we sent.
//
// `PROXYCHECK_API_KEY` is mandatory here even though the upstream answers
// keyless queries at a lower quota: on a per-visitor fan-out, a shared anonymous
// budget is somebody else's outage, and a deployment that wants it should say so
// with a key. Without one, the provider reports `unavailable` and the signal
// stays a declared gap.

import { fetchUpstream } from '../fetch-with-timeout.js';
import {
    answered, unavailable, errored, toFlag, toNumber, toText, toAsn, pickKey, PROVIDER_TIMEOUT_MS,
} from './answer.js';
import logger from '../logger.js';

export const PROXYCHECK_SOURCE = 'proxycheck.io';

// `asn=1` is the free enrichment module, `vpn=1` the VPN list, `risk=1` the
// abuse score. Paid-only modules are not asked for: an unanswerable parameter is
// silently ignored by the upstream, which is how a field nobody has ends up
// looking present.
const buildUrl = (ip, key) => `https://proxycheck.io/v2/${ip}?key=${key}&vpn=1&asn=1&risk=1`;

const entryOf = (body, ip) => {
    if (body?.[ip] && typeof body[ip] === 'object') return body[ip];
    const keys = Object.keys(body || {}).filter((k) => k !== 'status');
    return keys.length === 1 ? body[keys[0]] : null;
};

// The `type` label names what the vendor's list actually contains, and it is the
// only place Tor shows up on this API. Matched on words, since the upstream
// writes `VPN`, `Tor`, `Web Proxy`, `Proxy` and combinations of them.
const typeWord = (entry, word) => {
    const text = toText(entry?.type)?.toLowerCase() || '';
    return text.split(/[^a-z]+/).includes(word);
};

/**
 * Turn proxycheck.io's JSON into this build's answer.
 *
 * Exported for the spec, which pins it against a captured body — an absent
 * `proxy` field must come back `null`, never the `false` that `!== 'yes'` would
 * produce, and that distinction is the difference between "not measured" and
 * "cleared".
 *
 * @param {object} body  the vendor's response
 * @param {string} ip    the address that was asked about
 * @returns {object}
 */
export const interpretProxycheck = (body, ip) => {
    const status = toText(body?.status)?.toLowerCase();
    // The reason is the vendor's own message when it sent one: `error` on its own
    // cannot tell a quota out from a bad key, and the difference is what an
    // operator goes looking for.
    if (status && status !== 'ok') return errored(PROXYCHECK_SOURCE, toText(body?.message) || status);

    const entry = entryOf(body, ip);
    if (!entry || typeof entry !== 'object') return errored(PROXYCHECK_SOURCE, 'no-entry');
    // Per-IP errors (`invalid ip`, `access denied`) arrive as `ok` at the top.
    if (entry.error) return errored(PROXYCHECK_SOURCE, toText(entry.error) || 'entry-error');

    const proxy = toFlag(entry.proxy);
    const risk = toNumber(entry.risk);

    return answered(PROXYCHECK_SOURCE, {
        authority: 'list',
        isProxy: proxy,
        // `vpn` is its own module; when it is absent the type label is the only
        // statement the vendor made about this address being a VPN exit.
        isVpn: toFlag(entry.vpn) ?? (proxy === true && typeWord(entry, 'vpn') ? true : null),
        isTor: toFlag(entry.tor) ?? (typeWord(entry, 'tor') ? true : null),
        isMobile: toFlag(entry.mobile),
        abuseScore: risk,
        riskScore: risk,
        // The vendor writes the number in both cases depending on the endpoint
        // version, so neither spelling is the one to insist on.
        asn: toAsn(entry.asn ?? entry.ASN ?? entry.as),
        asName: toText(entry.provider) || toText(entry.org) || toText(entry.isp),
        country: toText(entry.country),
        usageType: toText(entry.usage_type),
        lat: toNumber(entry.latitude),
        lon: toNumber(entry.longitude),
        raw: body,
    });
};

export const askProxycheck = async (ip) => {
    const key = pickKey('PROXYCHECK_API_KEY');
    if (!key) return unavailable(PROXYCHECK_SOURCE, 'missing_key');

    try {
        const res = await fetchUpstream(buildUrl(ip, key), { timeoutMs: PROVIDER_TIMEOUT_MS });
        if (!res.ok) return errored(PROXYCHECK_SOURCE, `http-${res.status}`);
        return interpretProxycheck(await res.json(), ip);
    } catch (err) {
        logger.warn({ err, ip }, 'providers: proxycheck.io unavailable');
        return errored(PROXYCHECK_SOURCE, 'request-failed');
    }
};
