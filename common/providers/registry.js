// Which commercial providers this deployment asks, and asking them at once.
//
// Off by default, one variable for all of them, for the reason the ipapi.is feed
// already carries: these are per-*lookup* calls sitting on top of keys that other
// routes spend per *visitor*. `/api/ipinfo` burns the ipinfo token once for every
// visitor who loads the page; wiring the same token into every `/api/trustscore`
// multiplies it by whatever an audit script polls, and an exhausted credential
// surfaces as a data gap rather than as the outage it should be. So a deployment
// opts in deliberately, in `.env`, having decided what its quota is for.
//
// `TRUST_PROVIDERS` is a comma-separated list of ids (`proxycheck`, `abuseipdb`,
// `ip2location`, `ipinfo`, `internetdb`; the dotted vendor form is accepted too).
// An id that is listed but whose key is absent is not a failure: the adapter
// answers `unavailable / missing_key`, the capability stays a declared gap, and
// the overall response is still a 200 with the key-free sources in it. An unknown
// id is dropped rather than guessed at, because a typo that silently enabled
// *everything* is the worse way to read a list.
//
// ipapi.is is deliberately not here. It already has its own switch
// (`TRUST_IPAPIIS_FEED`) and its own parser (`interpretAbuseFeed`), and one
// address must cost one call to that vendor — so the gatherer folds its answer
// into the merge rather than asking twice.

import { askProxycheck, PROXYCHECK_SOURCE } from './proxycheck.js';
import { askAbuseipdb, ABUSEIPDB_SOURCE } from './abuseipdb.js';
import { askIp2location, IP2LOCATION_SOURCE } from './ip2location.js';
import { askIpinfoLite, IPINFO_SOURCE } from './ipinfo-lite.js';
import { askInternetdb, INTERNETDB_SOURCE } from './internetdb.js';
import { errored, unavailable, STATUS } from './answer.js';
import { outOfBudget, recordAsk } from './quota.js';

const PROVIDERS = [
    { id: PROXYCHECK_SOURCE, ask: askProxycheck },
    { id: ABUSEIPDB_SOURCE, ask: askAbuseipdb },
    { id: IP2LOCATION_SOURCE, ask: askIp2location },
    { id: IPINFO_SOURCE, ask: askIpinfoLite },
    // The one entry with no key: the scan archive answers anyone, so listing it
    // here is not a question of credentials but of whether this deployment wants
    // a third party's scan history in every lookup. Enabling it claims the
    // capability — the anonymity rows then read as *measured* rather than as a gap
    // never promised, which is the deal `TRUST_IPAPIIS_FEED` already spells out.
    { id: INTERNETDB_SOURCE, ask: askInternetdb },
];

// `proxycheck`, `proxycheck.io` and ` PROXYCHECK_IO ` all name the same vendor.
const matches = (entry, token) => {
    const label = token.replace(/[^a-z]/g, '');
    return label && (entry.id.replace(/[^a-z]/g, '') === label
        || entry.id.split('.')[0].replace(/[^a-z]/g, '') === label);
};

/**
 * The providers listed in `TRUST_PROVIDERS`, in `PROVIDERS` order.
 *
 * @returns {Array<{id: string, ask: function}>}
 */
export const enabledProviders = () => {
    const tokens = (process.env.TRUST_PROVIDERS || '')
        .split(',')
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
    if (!tokens.length) return [];
    return PROVIDERS.filter((entry) => tokens.some((token) => matches(entry, token)));
};

/**
 * Ask one vendor, unless this deployment's own budget says not to.
 *
 * A skip answers `unavailable` with its own reason, never `missing_key`: an
 * operator reading the second would go configure a key they already have, when
 * the thing to change is the ceiling.
 *
 * The charge lands *after* the adapter runs, and not at all for an
 * `unavailable` answer — a vendor with no key asked nothing of anybody, and
 * letting it consume the budget of the ones that did answer would throttle a
 * deployment for calls it never made.
 *
 * @param {{id: string, ask: (ip: string) => Promise<object>}} entry
 * @param {string} ip
 * @returns {Promise<object>}
 */
const askWithinBudget = async (entry, ip) => {
    if (outOfBudget(entry.id)) return unavailable(entry.id, 'quota');
    const answer = await entry.ask(ip);
    if (answer?.status !== STATUS.unavailable) recordAsk(entry.id);
    return answer;
};

/**
 * Ask every enabled provider about one address, in parallel.
 *
 * `Promise.allSettled`, not `Promise.all`: these sources are redundant by
 * design, so one vendor's 500 is a missing vote, never a reason to answer
 * nothing. Each adapter already catches, so the rejected branch only covers an
 * adapter that threw past its own try — which still has to be reported as the
 * source that failed rather than the source that cleared the address.
 *
 * @param {string} ip  a validated public address
 * @returns {Promise<Array<object>>} one answer per enabled provider
 */
export const askProviders = async (ip) => {
    const entries = enabledProviders();
    if (!entries.length) return [];
    const settled = await Promise.allSettled(entries.map((entry) => askWithinBudget(entry, ip)));
    return settled.map((result, index) => (
        result.status === 'fulfilled'
            ? result.value
            : errored(entries[index].id, 'adapter-threw')
    ));
};

export { PROXYCHECK_SOURCE, ABUSEIPDB_SOURCE, IP2LOCATION_SOURCE, IPINFO_SOURCE, INTERNETDB_SOURCE };
