// Shodan InternetDB's observation of one address: what somebody saw listening on
// it, and what was found when they looked.
//
// Key-free by design — the upstream answers without a credential and without an
// account, so this is the one provider that can widen the evidence of a blank
// `.env` deployment. It is *not* consulted by default though: the trust routes'
// key-free contract is about registries that answer for the address as a matter of
// record (RIR, RIPEstat, blocklist zones), and this is a third party's scan
// archive, which answers at its own pace. A deployment opts in with
// `TRUST_PROVIDERS=internetdb`.
//
// `observation` authority, and the strictest case for it in this folder: an open
// proxy on port 3128 is a fact about a *server*, not about what the visitor in
// front of the address is running, and a great many honest hosts have one.
// Everything it says therefore needs a second source before it decides anything
// (see vote.js), and a `found` record with no proxy tag is left as silence rather
// than a clearance — Shodan reports what its scanners happened to see, and most
// addresses are never scanned at all. A `false` from here would be an all-clear
// signed by nobody.
//
// The payload's real value is the ports and CVEs themselves, which no rung of the
// ladder asks about: a host running a decade-old OpenSSL is not an anonymiser, and
// pretending otherwise would charge the visitor for the operator's patch schedule.
// Those ship as facts on the response and the dossier's own open-ports row.
//
// A 404 is not an error: it is the archive saying nobody has looked at this
// address, which is a different fact from "we looked and found nothing open", and
// a different one again from the request failing.

import { fetchUpstream } from '../fetch-with-timeout.js';
import { answered, errored, toText, PROVIDER_TIMEOUT_MS } from './answer.js';
import logger from '../logger.js';

export const INTERNETDB_SOURCE = 'internetdb.shodan.io';

const buildUrl = (ip) => `https://internetdb.shodan.io/${ip}`;

// Matched on words rather than whole tag names, because the archive's vocabulary is
// not a published enum: `tor` shows up on the exits and `open_proxy` on proxies,
// and a bare `proxy` is not ours to rule out.
const hasTag = (tags, word) => tags.some((tag) => String(tag).toLowerCase().split(/[^a-z0-9]+/).includes(word));

const textList = (value) => (Array.isArray(value) ? value.map(toText).filter(Boolean) : []);

const portList = (value) => (Array.isArray(value)
    ? value.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535).sort((a, b) => a - b)
    : []);

/**
 * Turn InternetDB's JSON into this build's answer.
 *
 * @param {object} body  the upstream response
 * @param {string} ip    the address that was asked about
 * @returns {object}
 */
export const interpretInternetdb = (body, ip) => {
    if (!body || typeof body !== 'object') return errored(INTERNETDB_SOURCE, 'no-data');
    // `{ detail }` is what the archive answers for an address it has never seen —
    // and, with the same body, for one that does not parse. Both are "no
    // observation", never a refusal and never a clean bill.
    if (body.detail && !body.ports && !body.tags) {
        return answered(INTERNETDB_SOURCE, { authority: 'observation', found: false });
    }

    const tags = textList(body.tags);
    const vulns = textList(body.vulns);

    return answered(INTERNETDB_SOURCE, {
        authority: 'observation',
        found: true,
        isProxy: hasTag(tags, 'proxy') ? true : null,
        isTor: hasTag(tags, 'tor') ? true : null,
        ports: portList(body.ports),
        hostnames: textList(body.hostnames),
        cpes: textList(body.cpes),
        tags,
        vulns,
        // The archive's own record is keyed by the address it looked up; anything
        // else means the response was not about the address we asked for.
        observedIp: toText(body.ip),
        raw: body,
    });
};

/**
 * Ask the scan archive about one address.
 *
 * @param {string} ip  a validated public address
 * @returns {Promise<object>} `answered()` or `errored()` — there is no
 *   `unavailable` branch, because nothing here needs configuring
 */
export const askInternetdb = async (ip) => {
    try {
        const res = await fetchUpstream(buildUrl(ip), { timeoutMs: PROVIDER_TIMEOUT_MS });
        // A 404 is the answer, not a failure: the archive has nothing for this
        // address. Anything else non-2xx is a request that did not complete.
        if (res.status === 404) return answered(INTERNETDB_SOURCE, { authority: 'observation', found: false });
        if (!res.ok) return errored(INTERNETDB_SOURCE, `http-${res.status}`);
        const body = await res.json();
        const answer = interpretInternetdb(body, ip);
        // The archive answers a malformed address with the same body it uses for
        // an unscanned one, and `requirePublicIP` should have stopped that at the
        // door — so it stays a real "no observation" rather than a guess.
        return answer;
    } catch (err) {
        logger.warn({ err, ip }, 'providers: internetdb.shodan.io unavailable');
        return errored(INTERNETDB_SOURCE, 'request-failed');
    }
};
