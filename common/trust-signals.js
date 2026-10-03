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
// context through ip.sb, and the AS→org name from the CAIDA snapshot already on
// disk. Upstream budgets are the reason for the cache below — RIPEstat asks for
// about one request per second per `sourceapp`, and four data calls per lookup
// would exceed that on a busy instance.
//
// No active probing happens here: we never connect to the queried address.
// That keeps the endpoint from becoming an amplification vector, and it means
// an answer cannot be poisoned by the target.

import { fetchUpstream } from './fetch-with-timeout.js';
import { expandIPv6, toBgpPrefix } from './bgp-prefix.js';
import { lookupAsOrgName } from './as-org-db.js';
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
// minute to minute, and the same address is looked up again the moment a
// visitor shares the link. Entries expire after `ttlMs`; the cap stops a
// scanner walking a /8 from growing this unboundedly.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map();

const cached = (key, producer, ttlMs = CACHE_TTL_MS) => {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    return producer().then((value) => {
        if (cache.size >= CACHE_MAX) {
            // Drop the oldest insert rather than a random entry: Map keeps
            // insertion order, so the first key is the stale one.
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
        }
        cache.set(key, { value, expires: Date.now() + ttlMs });
        return value;
    });
};

// --- name helpers --------------------------------------------------------

const reverseV4 = (ip) => ip.split('.').reverse().join('.') + '.in-addr.arpa';

const reverseV6 = (ip) => {
    const hextets = expandIPv6(ip);
    if (!hextets) return null;
    return hextets.join('').split('').reverse().join('.') + '.ip6.arpa';
};

export const reverseName = (ip) => (ip.includes(':') ? reverseV6(ip) : reverseV4(ip));

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
        smallShare: masks.filter((m) => m >= 24).length / masks.length,
        largest: Math.min(...masks),
    };
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
    const [ptr, rir, holder, shape] = await Promise.all([
        queryPtr(ip),
        readRirRecord(ip),
        readAsHolder(asn),
        readAnnounceShape(asn),
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

export { RIPESTAT_APP };
