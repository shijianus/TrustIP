// DNS blocklist lookups: the one part of the trust assessment that asks a
// third party "have you seen this address misbehave", rather than deriving a
// verdict from registry data.
//
// The trap this module is built around — and the reason an earlier attempt was
// dropped — is an intercepting resolver. A resolver that fabricates answers
// returns NOERROR with an address for *every* name, so it reports every address
// on Earth as listed in every zone. That is not a weak measurement, it is a
// false accusation, and a stored row cannot tell the two apart afterwards.
//
// The defence is a canary, asked only when it is needed: interception always
// shows up as a hit, never as an NXDOMAIN, so a zone answering "clean" has
// already proved the resolver told the truth about that zone. Before anything is
// reported as listed, a guaranteed-nonexistent name is queried in the same zone
// through the same resolver. If that answers too, the resolver is fabricating,
// the pass is thrown away, and the next resolver is tried. The cost is zero in
// the common case and one extra query in the case that matters.
//
// Two other answers describe something other than this address, and are kept
// out of the tally for that reason: a diagnostic code is the zone refusing our
// query, and a policy code is the zone's rule about the address's *range* — a
// dynamic block that should not speak SMTP directly, say. Neither is a verdict
// about the address, so neither may read as clean, and a pass made only of them
// is reported as unmeasured rather than as a clear sheet.
//
// Nothing here queries a zone name that arrived in a request: `DNSBL_ZONES` is
// the whole set, and the only caller-supplied string is an already-validated IP.
// A blocklist endpoint that would accept an arbitrary zone becomes a DNS
// amplification reflector, which is the same reason no geo route is asked about
// an address we do not control.

import { Resolver } from 'node:dns/promises';
import { reverseName } from './ip-math.js';
import { DNSBL_ZONES, DIAGNOSTICS } from './dnsbl-zones.js';
import logger from './logger.js';

// Blocklists are the fastest-moving evidence in the assessment: a listing is
// usually delisted within days, so the 6h registry cache in trust-signals.js is
// far too long here.
const ZONE_TTL_MS = 30 * 60 * 1000;
// A resolver's honesty is not a per-address fact; re-proving it every lookup
// would triple the query count for a property that changes when someone
// reconfigures the network.
const CANARY_TTL_MS = 12 * 60 * 60 * 1000;
const DNS_TIMEOUT_MS = 3000;
const CACHE_MAX = 4000;

// Resolvers in preference order. Public recursors are used deliberately: the
// query must not appear to come from the audited network, and a hosting
// provider's own resolver is the one most likely to intercept it. Override for
// a deployment that can reach an authoritative-capable recursor of its own.
const DEFAULT_RESOLVERS = ['8.8.8.8', '1.1.1.1'];

const configuredResolvers = () => {
    const list = (process.env.DNSBL_RESOLVERS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return list.length ? list : DEFAULT_RESOLVERS;
};

// `tries: 1` because a retry on a *timeout* is a second chance to be lied to by
// the same path; moving to the next resolver is the recovery that means
// something (see `checkBlocklists`).
const resolvers = new Map();
const resolverFor = (server) => {
    let r = resolvers.get(server);
    if (!r) {
        r = new Resolver({ timeout: DNS_TIMEOUT_MS, tries: 1 });
        r.setServers([server]);
        resolvers.set(server, r);
    }
    return r;
};

const cache = new Map();
const remember = (key, ttlMs, value) => {
    if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(key, { value, expires: Date.now() + ttlMs });
    return value;
};

// One random label per process: a zone has no reason to publish it, so any
// answer to it is an answer the resolver invented.
const CANARY_LABEL = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

const isBlocklistedRange = (address) => address.startsWith('127.');

// What one in-range answer says, and about what.
//
// `policy` — the zone's own rule about the address's range, declared in the zone
// entry; `diagnostic` — the zone refusing our query; `accusation` — a code the
// zone blames on this address, including one we cannot name, since a zone that
// says yes is not less guilty because we have not read its documentation.
const readCode = (zone, address) => {
    if (zone?.policy?.[address]) return { address, kind: 'policy', meaning: zone.policy[address] };
    if (DIAGNOSTICS[address]) return { address, kind: 'diagnostic', meaning: DIAGNOSTICS[address] };
    if (zone?.listings?.[address]) return { address, kind: 'accusation', meaning: zone.listings[address] };
    return { address, kind: 'accusation', meaning: 'undocumented' };
};

// A DNS answer as a small closed set, so a caller never has to know node's
// error codes. `clean` is NXDOMAIN or an empty NOERROR; everything else says
// which question went unanswered.
const classifyError = (err) => {
    if (err?.code === 'ENOTFOUND') return 'clean';
    if (err?.code === 'ENODATA') return 'clean';
    if (err?.code === 'ESERVFAIL') return 'servfail';
    if (err?.code === 'EREFUSED' || err?.code === 'ENOTIMP') return 'refused';
    if (err?.code === 'ETIMEOUT') return 'timeout';
    return 'error';
};

const answerWith = async (resolver, name) => {
    try {
        const addresses = await resolver.resolve4(name);
        return { ok: true, addresses: Array.isArray(addresses) ? addresses : [] };
    } catch (err) {
        return { ok: false, status: classifyError(err), code: err?.code };
    }
};

// Does this resolver invent answers for this zone? Asked lazily, only before a
// listing is reported, and remembered per resolver+zone.
//
// Three answers, because "we could not tell" is a real possibility and must not
// be quietly read as "it is honest":
//   `intercepting` — the canary name answered, so every answer is fabricated;
//   `clear`        — it came back nonexistent, refused, failed or empty: an
//                    interception manufactures an *answer*, so anything that is
//                    not one proves this path told the truth about this zone;
//   `unproven`     — the canary itself timed out. Never cached: a transient
//                    loss of DNS must not suppress legitimate listings for a
//                    TTL's worth of hours.
const resolverIntercepts = async (server, zone) => {
    const key = `canary:${server}:${zone.zone}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;

    const answer = await answerWith(resolverFor(server), `${CANARY_LABEL}.${zone.zone}`);
    let verdict;
    if (answer.ok) verdict = answer.addresses.length ? 'intercepting' : 'clear';
    else verdict = answer.status === 'timeout' || answer.status === 'error' ? 'unproven' : 'clear';

    if (verdict !== 'unproven') remember(key, CANARY_TTL_MS, verdict);
    return verdict;
};

// --- one zone, one address ------------------------------------------------

const queryZone = async (server, name, zone) => {
    const started = Date.now();
    const answer = await answerWith(resolverFor(server), name);
    const base = {
        id: zone.id, label: zone.label, zone: zone.zone, category: zone.category, ms: Date.now() - started,
    };

    if (!answer.ok) {
        return { ...base, status: answer.status, listed: false, codes: [] };
    }
    if (!answer.addresses.length) {
        return { ...base, status: 'clean', listed: false, codes: [] };
    }

    const inRange = answer.addresses.filter(isBlocklistedRange);
    // A hit the zone does not document is still the zone saying yes: report it
    // with the raw code rather than quietly sorting it into "clean".
    const codes = inRange.map((address) => readCode(zone, address));

    // Every answer was outside the listing range — a sinkholed or poisoned
    // reply, not a verdict about the address.
    if (!inRange.length) return { ...base, status: 'bogus-answer', listed: false, codes: [] };

    // A diagnostic code is the zone refusing our query, and says nothing about
    // the address. Never let one read either way.
    if (codes.every((c) => c.kind === 'diagnostic')) {
        return { ...base, status: codes[0].meaning, listed: false, codes };
    }

    // Every code is the zone's rule about the range this address sits in. That
    // is a fact about the netblock, so it accuses neither the address nor its
    // neighbours — and it does not clear it either, which is why the status is
    // its own and `tallyOf` refuses to count it as an answer.
    if (codes.every((c) => c.kind === 'policy')) {
        return { ...base, status: 'policy', listed: false, codes };
    }

    return { ...base, status: 'listed', listed: true, codes };
};

// How much of a pass is allowed to speak.
//
// `answered` counts only the zones that gave a verdict about this address, so a
// pass whose every reply was a range policy or a refusal answers nothing and
// scores as unmeasured; `policy` is carried separately because the page shows it
// as information about the block, and a stored row has to be able to tell the
// two apart later.
const tallyOf = (results) => {
    const answered = results.filter((r) => r.status === 'listed' || r.status === 'clean');
    const listed = answered.filter((r) => r.listed);
    return {
        zones: results.length,
        answered: answered.length,
        listed: listed.length,
        botnet: listed.filter((r) => r.category === 'Botnet').length,
        policy: results.filter((r) => r.status === 'policy').length,
    };
};

const queryAllZones = async (server, name, zones) => Promise.all(zones.map(async (zone) => {
    const result = await queryZone(server, `${name}.${zone.zone}`, zone);
    // About to accuse: prove the resolver is not the source of the accusation.
    // A policy answer is guarded too — a recursor that invents the range-policy
    // code for every name would quietly spare a genuinely listed address.
    if (!result.listed && result.status !== 'policy') return result;
    const canary = await resolverIntercepts(server, zone);
    if (canary === 'intercepting') return { ...result, status: 'intercepting', listed: false };
    if (canary === 'unproven') return { ...result, status: 'unverified', listed: false };
    return result;
}));

/**
 * Ask every configured blocklist zone about one address.
 *
 * @param {string} ip  a validated public address
 * @returns {Promise<object>} `{ ip, supported, resolver, results, tally, reason? }`
 *   `supported` is false when no zone here answers questions about this address
 *   family; `resolver` names which recursor the answers came through, because a
 *   stored listing is only as good as the path that reported it; `reason` is set
 *   whenever `tally.answered` is 0, and says which of the ways that happens this
 *   pass is — `policy-only` among them.
 */
const runPass = async (ip) => {
    const name = reverseName(ip);
    if (!name) return { ip, supported: false, reason: 'unparseable', results: [], tally: tallyOf([]) };

    const v6 = ip.includes(':');
    // Reversing nibbles is only half of IPv6 support: a zone that publishes no
    // IPv6 content answers NXDOMAIN for every v6 query, which would read as
    // "clean" for every address of that family. Declared per zone instead.
    const zones = DNSBL_ZONES.filter((z) => (v6 ? z.v6 === true : true));
    if (!zones.length) {
        return { ip, supported: false, reason: v6 ? 'no-ipv6-zone' : 'no-zones', results: [], tally: tallyOf([]) };
    }

    const started = Date.now();
    for (const server of configuredResolvers()) {
        const results = await queryAllZones(server, name, zones);

        if (results.some((r) => r.status === 'intercepting')) {
            logger.warn({ ip, server }, 'dnsbl: resolver fabricated an answer, trying the next one');
            continue;
        }
        const tally = tallyOf(results);
        // An empty `answered` has two different causes, and the pass is the only
        // place that can still tell them apart: nobody answered about this
        // address, versus everybody answered about its *range*. Calling the
        // second one "none of the zones replied" would be the module's own words
        // lying about its own reading, three layers downstream.
        const reason = tally.answered === 0 && results.some((r) => r.status === 'policy')
            ? 'policy-only'
            : undefined;
        return {
            ip,
            supported: true,
            resolver: server,
            results,
            tally,
            ms: Date.now() - started,
            ...(reason ? { reason } : {}),
        };
    }

    // Every path we have is fabricating. Reporting "clean" here would be the
    // exact failure this module exists to prevent, so the answer is no answer.
    return {
        ip,
        supported: true,
        resolver: null,
        results: [],
        tally: { zones: zones.length, answered: 0, listed: 0, botnet: 0, policy: 0 },
        reason: 'no-trustworthy-resolver',
    };
};

/**
 * Ask every configured blocklist zone about one address, through a resolver we
 * have proved is not fabricating answers.
 *
 * Results are cached per address for `ZONE_TTL_MS`, and a pass is re-run through
 * the next resolver only when a listing fails its canary. `supported: false`
 * answers are cached too — they are a property of the address family and the
 * zone list, not a transient failure.
 *
 * @param {string} ip  a validated public address
 * @returns {Promise<object>} `{ ip, supported, resolver, results, tally, reason? }`
 *   `results[].status` is the answer of one zone and `tally` the count that can
 *   be scored; `resolver` names which recursor the answers came through, because
 *   a stored listing is only as good as the path that reported it.
 */
export const checkBlocklists = async (ip) => {
    const key = `bl:${ip}`;
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    return remember(key, ZONE_TTL_MS, await runPass(ip));
};

// The four pieces of this module's reading of an answer that a caller may want
// to check for itself; the zone list is read from common/dnsbl-zones.js, which
// is where its data-integrity spec looks too.
export { isBlocklistedRange, classifyError, readCode, tallyOf };
