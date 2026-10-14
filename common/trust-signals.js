// Evidence gathering for common/trust-score.js: every call out to a public
// registry, run in parallel, each one best-effort.
//
// Nothing here judges anything — `assessTrust` owns all arithmetic. This file
// only answers "what do the registries say about this address", and it answers
// `null` when a source is unreachable rather than guessing. A source that
// failed is recorded on the returned object (`failed`), so the scorer can mark
// that signal unknown instead of silently reading the absence as clean.
//
// Key-free by construction: reverse DNS through public DNS-over-HTTPS, AS,
// allocation and routing facts through RIPEstat's open data API, the geolocation
// context through ip.sb, blocklist membership through DNS queries to public
// recursors (common/dnsbl.js), and the AS→org name from the CAIDA snapshot
// already on disk. Upstream budgets are the reason for the cache below — RIPEstat
// asks for about one request per second per `sourceapp`, and four data calls per
// lookup would exceed that on a busy instance.
//
// Two opt-in exceptions, both off by default. `TRUST_IPAPIIS_FEED=true` adds the
// keyed abuse-feed call, and `TRUST_PROVIDERS=proxycheck,abuseipdb,…` adds the
// commercial anonymiser lists (common/providers/registry.js). Either one turns
// declared gaps into measured signals. Off, this module asks nothing that needs a
// key, and the gaps stay declared rather than pretending to be
// unmeasured-by-accident — which is how this fork ships, and why a key-free
// deployment is never capped for a subscription it did not claim.
//
// Where both are on, one vendor's answer is worth one call: the abuse feed and
// the provider list are merged, not concatenated, so api.ipapi.is is asked once
// per address however many signals want a piece of it.
//
// No active probing happens here: we never connect to the queried address.
// That keeps the endpoint from becoming an amplification vector, and it means
// an answer cannot be poisoned by the target.

import { fetchUpstream } from './fetch-with-timeout.js';
import { toBgpPrefix } from './bgp-prefix.js';
import { reverseName } from './ip-math.js';
import { pickIpApiIsKey } from './ipapi-key.js';
import { checkBlocklists } from './dnsbl.js';
import { lookupAsOrgName } from './as-org-db.js';
import { rdapAsn } from './rdap.js';
import { readEntry, writeEntry } from './trust-cache.js';
import { askProviders } from './providers/registry.js';
import { mergeProviders } from './providers/vote.js';
import { answered, STATUS, errored as providerErrored } from './providers/answer.js';
import { INTERNETDB_SOURCE } from './providers/internetdb.js';
import logger from './logger.js';

const RIPESTAT_BASE = 'https://stat.ripe.net/data';
const RIPESTAT_APP = process.env.RIPESTAT_SOURCE_APP || 'trustip';

// Reverse-DNS relays, tried in order. Both answer in JSON and both are public
// resolvers that return PTR for `in-addr.arpa` / `ip6.arpa` names.
const DOH_RELAYS = [
    { url: (name) => `https://dns.google/resolve?name=${name}&type=PTR`, json: true },
    { url: (name) => `https://cloudflare-dns.com/dns-query?name=${name}&type=PTR`, json: true },
];

// Address-level cache: registry facts about one IP or one prefix do not change
// minute to minute, and the same address is looked up again the moment a visitor
// shares the link. `common/trust-cache.js` holds it — this process' LRU, plus
// Workers KV when the deployment configures it, since a second instance or an
// overnight restart used to mean asking RIPEstat for the whole world again. The
// cap stops a scanner walking a /8 from growing the memory half unboundedly.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// `ttlMs` is the clock of the family being cached, not a per-call whim: the
// registry families below keep the 6h default, and the opt-in keyed feeds
// override it with `LIST_TTL_MS`, which an operator can set.
const cached = async (key, producer, ttlMs = CACHE_TTL_MS) => {
    const hit = await readEntry(key);
    if (hit !== undefined) return hit;
    const value = await producer();
    writeEntry(key, value, ttlMs / 1000);
    return value;
};

// --- name helpers --------------------------------------------------------

// `reverseName` lives with the rest of the address arithmetic (common/ip-math.js),
// where the blocklist lookups read the same shape from the same parser.

// --- reverse DNS ---------------------------------------------------------

// Returns { name } on a hit, { name: null } on a real NXDOMAIN/empty answer,
// and { failed: true } when no relay answered — the difference matters, since
// "no PTR exists" is evidence and "we could not ask" is not.
const queryPtr = (ip) => {
    const name = reverseName(ip);
    if (!name) return Promise.resolve({ name: null });
    return cached(`ptr:${name}`, async () => {
        for (const relay of DOH_RELAYS) {
            try {
                const res = await fetchUpstream(relay.url(name), {
                    timeoutMs: 5000,
                    headers: { accept: 'application/dns-json' },
                });
                if (!res.ok) continue;
                const body = await res.json();
                // Status 2 = SERVFAIL, 3 = NXDOMAIN. Both are answers, not
                // transport failures.
                if (body?.Status === 2 || body?.Status === 3) return { name: null };
                const answers = Array.isArray(body?.Answer) ? body.Answer : [];
                const hit = answers.find((a) => a?.type === 12 && typeof a.data === 'string');
                if (hit) return { name: hit.data.replace(/\.$/, '').toLowerCase() };
                if (Array.isArray(body?.Question)) return { name: null };
            } catch (err) {
                logger.warn({ err, ip }, 'trust-score: PTR relay failed');
            }
        }
        return { failed: true, name: null };
    });
};

// --- RIPEstat ------------------------------------------------------------

const ripestat = (endpoint, resource, params = {}, timeoutMs = 6000) =>
    cached(`rs:${endpoint}:${resource}:${new URLSearchParams(params).toString()}`, async () => {
        const search = new URLSearchParams({ resource, sourceapp: RIPESTAT_APP, ...params });
        try {
            const res = await fetchUpstream(`${RIPESTAT_BASE}/${endpoint}/data.json?${search}`, { timeoutMs });
            if (!res.ok) return { failed: true };
            const body = await res.json();
            if (body?.status !== 'ok') return { failed: true };
            return { data: body.data ?? {} };
        } catch (err) {
            logger.warn({ err, endpoint, resource }, 'trust-score: RIPEstat call failed');
            return { failed: true };
        }
    });

// RIR allocation record. RIPEstat normalises all five RIRs into key/value
// rows, which beats speaking NODC/RDAP in four dialects per region.
const readRirRecord = async (ip) => {
    const { data, failed } = await ripestat('whois', ip, {}, 6000);
    if (failed) return { failed: true };
    const rows = [];
    for (const group of data?.records || []) {
        for (const row of group || []) {
            if (row?.key && row?.value) rows.push([String(row.key).toLowerCase(), String(row.value)]);
        }
    }
    // RIPE objects repeat `descr` and `org` across several lines (institution,
    // city, country), and the informative one is rarely the first — so every
    // value for a text key is joined. Date and prefix keys must NOT be joined:
    // ARIN carries both a `RegDate` and a `Created`, and "1991-12-19 2011-12-08"
    // parses to nothing at all.
    const valuesFor = (...keys) => {
        for (const key of keys) {
            const values = rows.filter(([k]) => k === key).map(([, v]) => v.trim()).filter(Boolean);
            if (values.length) return [...new Set(values)];
        }
        return [];
    };
    const pick = (...keys) => valuesFor(...keys).join(' ') || null;
    const pickOne = (...keys) => valuesFor(...keys)[0] || null;
    // ARIN spells these NetType/CIDR/RegDate; RIPE/APNIC/LACNIC/AFRINIC use
    // inetnum/status/created. Reading both dialects keeps one code path.
    return {
        netType: pickOne('nettype'),
        status: pickOne('status'),
        descr: pick('descr', 'org-name', 'organisation', 'org'),
        netName: pickOne('netname'),
        cidr: pickOne('cidr', 'inetnum', 'prefix'),
        regDate: pickOne('regdate', 'created'),
        country: pickOne('country', 'org_country', 'country-code'),
        originAs: pickOne('originas', 'origin'),
    };
};

// The AS's own description line, which names the operator in its words rather
// than the RIR's (`HETZNER-AS Hetzner Online GmbH`).
const readAsHolder = async (asn) => {
    if (!asn) return { failed: true };
    const { data, failed } = await ripestat('as-overview', `AS${asn}`, {}, 4000);
    if (failed) return { failed: true };
    const holder = typeof data?.holder === 'string' ? data.holder : null;
    return { holder };
};

const readAnnounceShape = async (asn) => {
    if (!asn) return { failed: true };
    const { data, failed } = await ripestat('announced-prefixes', `AS${asn}`, {}, 12000);
    if (failed) return { failed: true };
    const v4 = (data?.prefixes || [])
        .map((p) => p?.prefix)
        .filter((p) => typeof p === 'string' && !p.includes(':'));
    if (!v4.length) return { failed: true };
    const masks = v4.map((p) => Number(p.split('/')[1])).filter(Number.isFinite);
    if (!masks.length) return { failed: true };
    return {
        v4Count: masks.length,
        // The address space the AS actually carries today — the sum of what is
        // announced, not what it holds on paper. Aggregates and deaggregates
        // both count, because both are routed.
        v4Size: masks.reduce((n, m) => n + 2 ** (32 - m), 0),
        smallShare: masks.filter((m) => m >= 24).length / masks.length,
        largest: Math.min(...masks),
    };
};

// When the registry handed the number out. Scoring does not use it — the
// dossier's allocation-age signal reads the address block's own date — but the
// ASN card answers to it, and it is the one ASN fact that only the RIR has.
const readAsnRegistration = async (asn) => {
    if (!asn) return { failed: true };
    try {
        return await rdapAsn(asn);
    } catch (error) {
        logger.warn({ err: error, asn }, 'RDAP ASN lookup failed');
        return { failed: true };
    }
};

const RPKI_STATES = ['valid', 'invalid', 'invalid_asn', 'invalid_length', 'not-found', 'unknown'];

const readRpki = async (asn, prefix) => {
    if (!asn || !prefix) return { failed: true };
    const { data, failed } = await ripestat('rpki-validation', `AS${asn}`, { prefix }, 8000);
    if (failed) return { failed: true };
    const state = data?.status;
    return RPKI_STATES.includes(state) ? { state } : { failed: true };
};

// --- geolocation context -------------------------------------------------

// The score needs two facts no registry publishes: where an address is served
// from, and which AS carries it. ip.sb answers both without a key, and its
// response is the same canonical shape every /api geo route already emits.
// A failure here is not fatal — it leaves the ASN-dependent signals and the
// nativeness check unknown.
const readGeoContext = async (ip) => {
    return cached(`geo:${ip}`, async () => {
        try {
            const res = await fetchUpstream(`https://api.ip.sb/geoip/${ip}`, { timeoutMs: 6000 });
            if (!res.ok) return { failed: true };
            const body = await res.json();
            if (!body?.asn) return { failed: true };
            return {
                value: {
                    ip: body.ip || ip,
                    country_code: body.country_code || null,
                    region: body.region || null,
                    city: body.city || null,
                    asn: typeof body.asn === 'number' ? body.asn : null,
                    org: body.organization || body.isp || null,
                    isp: body.isp || null,
                    latitude: body.latitude ?? null,
                    longitude: body.longitude ?? null,
                },
            };
        } catch (err) {
            logger.warn({ err, ip }, 'trust-score: geo context unavailable');
            return { failed: true };
        }
    });
};

// --- blocklists ----------------------------------------------------------

// The scorer reads three numbers out of a DNSBL pass — how many zones answered
// truthfully, how many named this address, how many of those are botnet feeds —
// so a pass with nothing to say becomes `null` rather than a zero, which the
// ladder reads as "not measured" instead of "clean". A pass that heard only
// range policy is kept, `answered: 0` and all: the scorer still reads it as
// unmeasured, and the page still gets the policy rows it was built to show.
const blocklistSummary = (pass) => {
    if (!pass?.tally) return null;
    if (pass.tally.answered < 1 && !(pass.tally.policy > 0)) return null;
    const listed = pass.results.filter((r) => r.listed).map((r) => r.label);
    return {
        ...pass.tally,
        resolver: pass.resolver || null,
        // Kept whole for the dossier: the scorer reads the tally, the page shows
        // which zone said what, and a stored accusation names its source.
        results: pass.results,
        labels: listed.length ? listed : pass.results.filter((r) => r.status === 'clean').map((r) => r.label),
    };
};

// --- optional keyed abuse feed -------------------------------------------

const IPAPI_SOURCE = 'ipapi.is';
// The list clock — how long an answer from a keyed feed or a vendor's anonymiser
// database stays worth repeating. The vendors re-evaluate their own verdicts on
// roughly a daily cycle, so a day is as long as an answer is worth holding and
// short enough that a cleared address is not accused for a week.
const DEFAULT_LIST_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_LIST_TTL_MS = 60 * 1000;
const MAX_LIST_TTL_MS = 7 * DEFAULT_LIST_TTL_MS;

// `TRUST_CACHE_TTL_SECONDS` lets a deployment trade freshness for the key's quota,
// which is the same lever that decides whether these feeds are enabled at all. Both
// ends are clamped rather than trusted: a five-second cache spends the quota on every
// visitor anyway, and a decade-long one holds an accusation long past the evidence
// that produced it. An unset or unparseable value is the default, not an error.
export const listTtlMs = () => {
    const raw = Number(process.env.TRUST_CACHE_TTL_SECONDS ?? '');
    if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_LIST_TTL_MS;
    return Math.min(Math.max(raw * 1000, MIN_LIST_TTL_MS), MAX_LIST_TTL_MS);
};

// Off by default. The geolocation card already spends this key's quota one call
// per visitor; wiring the same feed into every /api/trustscore and /api/dossier
// lookup multiplies it by whatever an audit script polls, and a key that runs
// out mid-scan answers as a data gap rather than as an outage. Enabling it is
// therefore a deployment decision, taken once, in `.env`.
const feedEnabled = () => process.env.TRUST_IPAPIIS_FEED === 'true';

/**
 * Read the fields of an upstream abuse answer this build is willing to score.
 *
 * Only the documented detection flags and the abuse score are read. The
 * upstream's `abuse` object — a registrant's name, postal address, e-mail and
 * phone — is never touched: a trust verdict has no use for it, and passing it
 * through would turn this endpoint into a people-search proxy, the same line
 * `api/trust-score.js` holds the RIR records to.
 *
 * An answer carrying neither a flag we understand nor a score is `{ failed }`,
 * not a set of `false`es. That distinction is what keeps "the vendor did not
 * tell us" from being scored as "the vendor cleared it" — which the free tier
 * does routinely, by answering without the detection fields at all.
 *
 * @param {object} body  the upstream JSON
 * @returns {object}
 */
export const interpretAbuseFeed = (body) => {
    const src = body && typeof body === 'object' ? body : {};
    const FLAGS = [
        ['proxy', 'is_proxy'], ['vpn', 'is_vpn'], ['tor', 'is_tor'], ['abuser', 'is_abuser'],
        // What kind of block this is, which the registry's own text sometimes
        // fails to name. The scorer charges a secondhand class less than its own
        // token (see `LIST_CLASS_EFFECT`), so a vendor that says nothing about the
        // address's posture can still tell it is a hosting range.
        ['hosting', 'is_datacenter'], ['mobile', 'is_mobile'],
    ];
    const known = FLAGS.filter(([, key]) => typeof src[key] === 'boolean');

    // The score lives beside the ASN and, for a customer network, beside the
    // company; whichever the answer carries is the one the vendor measured.
    const scores = [src.asn?.abuser_score, src.company?.abuser_score]
        .filter((v) => typeof v === 'number' && Number.isFinite(v));
    const score = scores.length ? Math.max(...scores) : null;

    if (!known.length && score === null) return { failed: true, source: IPAPI_SOURCE };

    const out = { source: IPAPI_SOURCE };
    for (const [name, key] of known) out[name] = src[key];
    if (score !== null) out.abuserScore = score;
    return out;
};

const readAbuseFeed = (ip) => {
    if (!feedEnabled()) return Promise.resolve(null);
    const key = pickIpApiIsKey();
    if (!key) return Promise.resolve(null);
    // `cached` takes the producer before its ttl; the second argument is called as
    // a function.
    return cached(`feed:${ip}`, async () => {
        try {
            const res = await fetchUpstream(`https://api.ipapi.is?q=${ip}&key=${key}`, { timeoutMs: 8000 });
            if (!res.ok) return { failed: true, source: IPAPI_SOURCE };
            return interpretAbuseFeed(await res.json());
        } catch (err) {
            logger.warn({ err, ip }, 'trust-score: abuse feed unavailable');
            return { failed: true, source: IPAPI_SOURCE };
        }
    }, listTtlMs());
};

// --- the optional provider lists ------------------------------------------

// The abuse feed's answer, re-expressed in the shape the merge reads. It is a
// `list` authority — that vendor's product *is* the anonymiser database — and it
// publishes the same claims the commercial adapters do, so folding it in here is
// what keeps one api.ipapi.is call serving both switches instead of asking twice.
const feedAnswer = (feed) => {
    if (!feed) return null;
    if (feed.failed) return providerErrored(IPAPI_SOURCE, 'request-failed');
    return answered(IPAPI_SOURCE, {
        authority: 'list',
        isProxy: feed.proxy ?? null,
        isVpn: feed.vpn ?? null,
        isTor: feed.tor ?? null,
        isAbuser: feed.abuser ?? null,
        abuseScore: feed.abuserScore ?? null,
        isHosting: feed.hosting ?? null,
        isMobile: feed.mobile ?? null,
    });
};

// Cached on the list clock: a vendor's list is re-evaluated on roughly a daily
// cycle, and one address costs one call per vendor however many switches want it.
const readProviders = (ip) => cached(`prov:${ip}`, () => askProviders(ip), listTtlMs());

// --- the gatherer --------------------------------------------------------

/**
 * Collect everything the public registries say about one address.
 *
 * @param {string} ip                already validated as a usable public address
 * @param {object} [options.geo]     canonical geo shape, supplied to skip the
 *                                   geo lookup when the caller already has one
 * @returns {Promise<object>}        the `assessTrust` input, with `failed`
 *                                   naming every source that could not be reached
 */
export const gatherTrustEvidence = async (ip, { geo = null } = {}) => {
    const supplied = geo?.asn ? { value: geo } : await readGeoContext(ip);

    const context = supplied?.value || {};
    const asn = Number(context.asn) || null;
    const evidence = { ip, geo: context, asn };
    const failed = [];
    if (!supplied?.value) failed.push('geo');

    // Independent of each other; run together so the response costs the
    // slowest source, not their sum. RPKI is the exception — it needs the
    // prefix, which only the allocation record can supply.
    const [ptr, rir, holder, shape, allocated, blocklists, feed, providerAnswers] = await Promise.all([
        queryPtr(ip),
        readRirRecord(ip),
        readAsHolder(asn),
        readAnnounceShape(asn),
        readAsnRegistration(asn),
        checkBlocklists(ip),
        readAbuseFeed(ip),
        readProviders(ip),
    ]);

    evidence.asOrg = asn ? lookupAsOrgName(asn) : null;
    evidence.rdns = ptr?.name ?? null;
    if (ptr?.failed) failed.push('rdns');

    evidence.rir = rir?.failed ? null : rir;
    if (rir?.failed) failed.push('rir');

    // Kept whole, including the operator's own AS name token (`CLOUDFLARENET`,
    // `HETZNER-AS`) — that string is often the clearest evidence available.
    evidence.asName = holder?.holder || null;
    if (holder?.failed) failed.push('as-overview');

    evidence.announce = shape?.failed ? null : shape;
    if (shape?.failed) failed.push('announced-prefixes');

    evidence.asnRegistered = allocated?.failed ? null : (allocated.registered || null);
    if (allocated?.failed) failed.push('rdap-asn');

    evidence.blocklists = blocklistSummary(blocklists);
    if (!evidence.blocklists?.answered) {
        failed.push('dnsbl');
        // A pass that had nothing to say names why: no zone in the list answers
        // questions about this address family, every configured recursor
        // fabricated an answer, or the address did not parse into a query name.
        // The dossier renders that reason instead of guessing at it — "we never
        // asked an IPv6 address" and "nobody accused you" are different messages.
        evidence.blocklistsReason = blocklists?.reason || 'no-answer';
    }

    // Carried only when the deployment consulted *something* keyed. Nothing
    // configured means the capability was never claimed, which `assessTrust`
    // reports as a declared gap and leaves out of the confidence denominator;
    // configured-and-unanswered is a different fact — the signal goes `unknown`,
    // which does shrink it — and that is the whole reason the two states are kept
    // apart on the way through this file.
    const answers = [feedAnswer(feed), ...providerAnswers].filter(Boolean);
    const merged = mergeProviders(answers);
    if (merged.status.length) {
        evidence.privacy = {
            proxy: merged.flags.proxy,
            vpn: merged.flags.vpn,
            tor: merged.flags.tor,
            hosting: merged.flags.hosting,
            mobile: merged.flags.mobile,
            abuser: merged.abuse.flag,
            abuserScore: merged.abuse.score,
            abuserReports: merged.abuse.reports,
            // Per capability, because the vendor that decided the proxy row is
            // usually not the one that decided the Tor row, and `matched` has to
            // name whoever spoke. `source` is every vendor that answered at all,
            // kept for the shape consumers were written against. The abuse row's
            // attribution sits on the flag, not on the score, because the worst
            // score and the loudest flag rarely come from the same vendor.
            by: { ...merged.by, abuse: merged.abuse.flaggedBy },
            votes: merged.votes,
            sources: merged.sources,
            source: merged.sources.join(' + ') || null,
            status: merged.status,
        };
        if (!merged.sources.length) failed.push('abuse-feed');
    }

    // The scan archive's own facts, kept beside the verdict rather than folded into
    // it: which ports were seen is a different question from who is anonymising, and
    // an unpatched service is the operator's schedule, not the visitor's posture. It
    // is absent when the deployment never consulted the archive — which is the
    // default — so the page declares the gap instead of showing an empty list.
    const scan = providerAnswers.find((a) => a.source === INTERNETDB_SOURCE);
    if (scan) {
        evidence.scan = scan.status === STATUS.error ? { status: 'failed' }
            : scan.found
                ? {
                    status: 'record',
                    ports: scan.ports,
                    tags: scan.tags,
                    vulns: scan.vulns,
                    hostnames: scan.hostnames,
                    cpes: scan.cpes,
                }
                : { status: 'no-record' };
    }

    // RPKI needs a prefix. Prefer the allocation's own CIDR — RIPE writes
    // `inetnum` as a range (`a - b`) about as often as a CIDR, and only the
    // CIDR form is something RPKI can validate — otherwise fall back to the DFZ
    // floor (/24, /48), which is what an ROA is normally written for and what
    // lets the edge cache dedupe across a whole prefix.
    const allocation = (rir?.cidr || '').split(',')[0]?.trim();
    const prefix = allocation?.includes('/') ? allocation : toBgpPrefix(ip);
    const rpkiResult = await readRpki(asn, prefix);
    evidence.rpki = rpkiResult?.state ?? null;
    if (rpkiResult?.failed) failed.push('rpki');

    evidence.failed = failed;
    return evidence;
};

export { RIPESTAT_APP, blocklistSummary };
