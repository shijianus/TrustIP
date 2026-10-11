// AbuseIPDB's abuse-report answer for one address.
//
// Key-mandatory: the upstream has no keyless mode, so an unconfigured deployment
// reports `unavailable` and the abuse signal stays a declared gap rather than a
// measurement this instance never made.
//
// The authority is `observation`, not `list`. What AbuseIPDB sells is a
// *reporting* census — e-mails from operators who saw something — and its
// `usageType` is registry data; neither is a claim about anonymisation. Its
// `isTor` flag is documented as deprecated and answers for the whole netblock on
// some entries, which is exactly the kind of accusation that needs a second
// source before it decides anything (see vote.js).
//
// The response's `lastReports[]` and contact fields are never read: a trust
// verdict has no use for a reporter's e-mail, and passing it through would make
// this endpoint a people-search proxy — the same line `interpretAbuseFeed` holds
// the vendor's `abuse` object to.

import { fetchUpstream } from '../fetch-with-timeout.js';
import {
    answered, unavailable, errored, toFlag, toNumber, toText, toAsn, usageFlags, pickKey, PROVIDER_TIMEOUT_MS,
} from './answer.js';
import logger from '../logger.js';

export const ABUSEIPDB_SOURCE = 'abuseipdb.com';

// 90 days is the widest window the free plan answers for and the one its own
// docs recommend for a reputation read; a shorter window would let a quiet
// address look clean because nobody looked at it.
const MAX_AGE_DAYS = 90;
const buildUrl = (ip) => `https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}&maxAgeInDays=${MAX_AGE_DAYS}`;

/**
 * Turn AbuseIPDB's JSON into this build's answer.
 *
 * `abuseConfidenceScore` is a percentage (0–100) and leaves here unchanged: the
 * scale table in vote.js is where a vendor's unit is decided, so the ladder never
 * has to know that this one publishes percent and ipapi.is publishes a decimal.
 *
 * @param {object} body  the vendor's response
 * @returns {object}
 */
export const interpretAbuseipdb = (body) => {
    const data = body?.data;
    // An answer with neither a score nor a report count told us nothing about
    // abuse. `{ errors }` (bad key, over quota) and a bare `data` both land here,
    // and reading either as a 0 would be the inversion this module exists for.
    if (!data || typeof data !== 'object') return errored(ABUSEIPDB_SOURCE, body?.errors ? 'vendor-error' : 'no-data');

    const score = toNumber(data.abuseConfidenceScore);
    const reports = toNumber(data.totalReports);
    if (score === null && reports === null) return errored(ABUSEIPDB_SOURCE, 'no-score');

    const usage = usageFlags(data.usageType);

    return answered(ABUSEIPDB_SOURCE, {
        authority: 'observation',
        isTor: toFlag(data.isTor),
        isHosting: usage.isHosting,
        isMobile: usage.isMobile,
        abuseScore: score,
        abuseReports: reports,
        asn: toAsn(data.asn),
        asName: toText(data.isp) || toText(data.domain),
        country: toText(data.countryCode),
        usageType: toText(data.usageType),
        // No `raw`: this is the one answer whose body carries other people — the
        // reporters' e-mail addresses and their free-text comments. Dropping it at
        // the merge would still mean a PII payload sitting in the evidence object
        // until then, and no spec needs the vendor's JSON to pin this parser.
    });
};

export const askAbuseipdb = async (ip) => {
    const key = pickKey('ABUSEIPDB_API_KEY');
    if (!key) return unavailable(ABUSEIPDB_SOURCE, 'missing_key');

    try {
        const res = await fetchUpstream(buildUrl(ip), {
            timeoutMs: PROVIDER_TIMEOUT_MS,
            headers: { Key: key, accept: 'application/json' },
        });
        if (!res.ok) return errored(ABUSEIPDB_SOURCE, `http-${res.status}`);
        return interpretAbuseipdb(await res.json());
    } catch (err) {
        logger.warn({ err, ip }, 'providers: AbuseIPDB unavailable');
        return errored(ABUSEIPDB_SOURCE, 'request-failed');
    }
};
