// Assembly of the full IP dossier — everything /ip shows about one address,
// produced in one pass so the page makes a single request instead of fanning
// out across a dozen endpoints.
//
// Two kinds of section live in the result, and the difference is explicit:
//
//   * `SLOTS` entries with status `ready` are backed by data this deployment
//     gathers itself.
//   * Entries with any other status are declared, not skipped. A slot that
//     needs a paid feed, an active probe we refuse to run, or a history store
//     we do not have yet still appears in the response with the reason and the
//     source that would fill it, so the UI renders the section's place in the
//     layout and the reader learns what is absent rather than assuming the
//     address has no such property.
//
// `common/trust-signals.js` gathers the registry evidence and
// `common/trust-score.js` scores it; this module adds the two things neither
// does — a multi-source geolocation comparison, and the BGP neighbourhood
// computed from the CAIDA relationship snapshot already in memory.

import { fetchUpstream } from './fetch-with-timeout.js';
import { gatherTrustEvidence } from './trust-signals.js';
import { assessTrust } from './trust-score.js';
import { providersOf, peersOf, customerCountOf, isTier1 } from './as-rel-db.js';
import { lookupAsOrgName } from './as-org-db.js';
import { isMaxMindReady, lookupMaxMind } from './maxmind-service.js';
import { buildAsnHistoryBlock } from './asn-announcement-history.js';
import { buildLatencyMatrix } from './latency-matrix.js';
import { toBgpPrefix } from './bgp-prefix.js';
import { isIPv6 } from './valid-ip.js';
import logger from './logger.js';

// Second-hop breadth. Two upstreams deep is enough to show the shape of a
// network; a /24-announcing hosting AS can have hundreds of providers'
// providers, and the fan stops being readable long before it stops being
// accurate.
const MAX_UPSTREAMS = 6;
const MAX_SECOND_HOP = 3;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const clean = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s && s.toLowerCase() !== 'private' && s !== '-' ? s : null;
};

// Great-circle distance in km. Used only to report how far apart two sources
// put the same address; the number is a disagreement measure, not a position.
const haversineKm = (a, b) => {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
};

const normaliseIpApi = (body) => (body?.status !== 'success' ? null : ({
    country: clean(body.country),
    country_code: clean(body.countryCode),
    region: clean(body.regionName),
    city: clean(body.city),
    lat: num(body.lat),
    lon: num(body.lon),
}));

// Additional geolocation sources. IP.SB is not among them: the trust evidence
// already carries its answer, and asking twice would double the requests to one
// upstream for nothing. ip-api.com is a genuinely independent opinion that
// answers in the visitor's language; MaxMind answers from a local file when a
// database has been installed. A bare deployment therefore compares two
// sources, a configured one three.
const GEO_SOURCES = [
    {
        id: 'ipapicom',
        label: 'IP-API.com',
        url: (ip, lang) => `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,lat,lon&lang=${lang}`,
        normalise: normaliseIpApi,
    },
];

// The evidence's geo answer uses the canonical API shape (`latitude` /
// `longitude`, `country` for the code); the dossier's own sources use short
// keys. Mapping one onto the other keeps every source comparable — without it
// the primary source silently contributes no coordinates and the spread that
// makes this section worth reading can never be computed.
const geoFromEvidence = (g = {}) => ({
    country: clean(g.country_name) || clean(g.country),
    country_code: clean(g.country_code) || clean(g.country),
    region: clean(g.region),
    city: clean(g.city),
    lat: num(g.latitude) ?? num(g.lat),
    lon: num(g.longitude) ?? num(g.lon),
});

const fetchGeoSource = async (source, ip, lang) => {
    try {
        const res = await fetchUpstream(source.url(ip, lang), { timeoutMs: 6000 });
        if (!res.ok) return { id: source.id, label: source.label, failed: true };
        const body = await res.json();
        const value = source.normalise(body);
        return value
            ? { id: source.id, label: source.label, ...value }
            : { id: source.id, label: source.label, failed: true };
    } catch (err) {
        logger.warn({ err, ip, source: source.id }, 'dossier: geo source failed');
        return { id: source.id, label: source.label, failed: true };
    }
};

const maxMindSource = (ip, lang) => {
    if (!isMaxMindReady()) return { id: 'maxmind', label: 'MaxMind GeoLite2', unavailable: 'no-database' };
    try {
        const r = lookupMaxMind(ip, lang);
        return {
            id: 'maxmind',
            label: 'MaxMind GeoLite2',
            country: clean(r.country_name) || clean(r.country),
            country_code: clean(r.country) || clean(r.country_code),
            region: clean(r.region),
            city: clean(r.city),
            lat: num(r.latitude),
            lon: num(r.longitude),
            asn: num(r.asn),
        };
    } catch (err) {
        logger.warn({ err, ip }, 'dossier: MaxMind lookup failed');
        return { id: 'maxmind', label: 'MaxMind GeoLite2', failed: true };
    }
};

/**
 * The sources' answers, plus what they agree on.
 *
 * Consensus is a majority vote on country and on `region / city`; the spread
 * is the largest distance any two sources disagree by. Reporting the maximum
 * pairwise distance rather than a per-row verdict is deliberate: one source
 * pointing elsewhere is usually that source being wrong about a border, and
 * singling it out invites the reader to treat the remaining disagreement as
 * zero.
 */
const buildGeo = (sources) => {
    const usable = sources.filter((s) => !s.failed && !s.unavailable && (s.country_code || s.city));
    const withCoords = usable.filter((s) => s.lat != null && s.lon != null);

    const tally = (key) => {
        const counts = new Map();
        for (const s of usable) {
            const v = s[key];
            if (!v) continue;
            counts.set(v, (counts.get(v) || 0) + 1);
        }
        let best = null, bestCount = 0;
        for (const [value, count] of counts) {
            if (count > bestCount) { best = value; bestCount = count; }
        }
        return best;
    };

    let maxOffsetKm = null;
    for (let i = 0; i < withCoords.length; i += 1) {
        for (let j = i + 1; j < withCoords.length; j += 1) {
            const d = haversineKm(withCoords[i], withCoords[j]);
            if (maxOffsetKm === null || d > maxOffsetKm) maxOffsetKm = d;
        }
    }

    return {
        sources: usable,
        unavailable: sources.filter((s) => s.unavailable).map((s) => s.id),
        consensus: {
            country: tally('country'),
            country_code: tally('country_code'),
            city: tally('city'),
            // "Diverging" is a claim about a measured gap, so it needs two
            // coordinates to compare. One geolocated source among several
            // textual ones is unknown, not disagreement.
            agreement: maxOffsetKm === null
                ? (usable.length > 1 ? 'single-fix' : 'single-source')
                : maxOffsetKm <= 100 ? 'agreeing' : 'diverging',
        },
        maxOffsetKm,
        sourceCount: usable.length,
    };
};

/**
 * The address's BGP neighbourhood, read from the CAIDA relationship snapshot.
 *
 * This costs no network call: the provider/peer graph is loaded at boot. What
 * it cannot say is path proportion — that needs a looking-glass view of who
 * actually carries the prefix, which this deployment does not query. The
 * consumer renders the graph without the widths rather than inventing them.
 */
const buildTopology = (asn) => {
    if (!asn) return null;
    const describe = (other) => ({
        asn: other,
        org: lookupAsOrgName(other),
        tier1: isTier1(other),
        customers: customerCountOf(other),
    });

    const providers = providersOf(asn).slice(0, MAX_UPSTREAMS).map(describe);
    const peers = peersOf(asn).slice(0, MAX_UPSTREAMS).map(describe);
    const secondHop = providers.slice(0, MAX_SECOND_HOP).map((p) => ({
        via: p.asn,
        upstreams: providersOf(p.asn).slice(0, MAX_SECOND_HOP).map(describe),
    }));

    return {
        origin: { asn, org: lookupAsOrgName(asn), tier1: isTier1(asn), customers: customerCountOf(asn) },
        providers,
        peers,
        secondHop,
        // Honest about the one number the competitor's diagram carries that we
        // do not: how much of the visible path each upstream accounts for.
        hasPathShares: false,
    };
};

// Every section the page lays out, with the state of its backing data.
// `needs` names the specific thing that would turn the slot from a declared
// gap into a real section, so filling one in is a decision and not a search.
const SLOTS = {
    hero: { status: 'ready' },
    usage: { status: 'ready' },
    asn: { status: 'ready' },
    technical: { status: 'ready', partial: ['openPorts'] },
    threat: { status: 'partial', missing: ['abuseLevel', 'honeypot'], needs: 'an abuse-intelligence feed; the free registries do not carry per-address abuse history' },
    deepRisk: { status: 'placeholder', needs: 'VPN / proxy / Tor membership feeds. DNSBL lookups were tried and dropped: an intercepting resolver answers every query with a hit, which is a false accusation, not a measurement' },
    vpnTrace: { status: 'placeholder', needs: 'a routing-visibility dataset we do not currently query' },
    // The numbers are not ours to produce: measuring from this server would
    // report this datacenter's uplink as if it were the world's. The block
    // carries the probe plan and the visitor's browser runs it, so the slot is
    // ready in the sense that matters — every cell has a source.
    latency: { status: 'ready', note: 'probe plan only; the round trips are measured in the browser by Globalping datacenter probes, on the visitor\'s own quota' },
    heat: { status: 'placeholder', needs: 'a local per-prefix observation store; nothing is recorded today, so there is no trend to draw' },
    map: { status: 'ready' },
    geo: { status: 'ready' },
    relatedDomains: { status: 'placeholder', needs: 'reverse DNS sweeping across the containing prefix, which is active scanning of third-party address space' },
    locationHistory: { status: 'placeholder', needs: 'a per-address observation history; the IP history we keep is the visitor\'s own, not the address\'s' },
    neighbours: { status: 'placeholder', needs: 'same as relatedDomains' },
    topology: { status: 'ready', partial: true, note: 'CAIDA relationship graph, without path proportions' },
    blocklists: { status: 'placeholder', needs: 'a resolver that answers DNSBL queries truthfully' },
    asnHistory: { status: 'ready' },
    companyHistory: { status: 'placeholder', needs: 'a registration-history dataset; RIR RDAP answers only for the current object' },
    coLocated: { status: 'placeholder', needs: 'a datacenter-to-customer directory we do not have' },
    actions: { status: 'ready' },
};

/**
 * Build the dossier for one address.
 *
 * @param {string} ip  validated, publicly routable
 * @param {object} [options]
 * @param {string} [options.lang]  BCP-47 tag forwarded to the geo sources
 * @returns {Promise<object>}
 */
export const buildDossier = async (ip, { lang = 'en' } = {}) => {
    // The trust evidence carries one geolocation answer, the reverse name, the
    // RIR record, the announcement shape and the RPKI state. The remaining geo
    // sources are gathered alongside it; the topology costs nothing, and the
    // announcement history answers at BGP granularity for the /24 or /48 that
    // contains the address — the same quantization the standalone ASN-history
    // tool uses, so both read one edge-cache key.
    const [evidence, asnHistory, ...extra] = await Promise.all([
        gatherTrustEvidence(ip),
        buildAsnHistoryBlock(toBgpPrefix(ip)),
        ...GEO_SOURCES.map((s) => fetchGeoSource(s, ip, lang)),
    ]);

    const trust = assessTrust(evidence);

    const primary = evidence.geo?.country_code || evidence.geo?.asn
        ? { id: 'ipsb', label: 'IP.SB', ...geoFromEvidence(evidence.geo) }
        : { id: 'ipsb', label: 'IP.SB', failed: true };
    const maxmind = maxMindSource(ip, lang);
    const sources = [primary, ...extra, maxmind];

    const geo = buildGeo(sources);
    // ip.sb's answer is the only one carrying an ASN, and it is absent when
    // that source failed. MaxMind is the sole local fallback, so consult it
    // before declaring the ASN and topology blocks empty.
    const resolvedAsn = evidence.asn || Number(maxmind.asn) || null;

    return {
        ip,
        version: isIPv6(ip) ? 6 : 4,
        trust,
        identity: {
            cls: trust.cls,
            anycast: trust.anycast,
            country_code: geo.consensus.country_code || evidence.geo?.country_code || null,
        },
        geo,
        network: {
            asn: resolvedAsn,
            asName: evidence.asName,
            asOrg: evidence.asOrg,
            cidr: evidence.rir?.cidr || null,
            netname: evidence.rir?.netName || null,
            status: evidence.rir?.status || null,
            netType: evidence.rir?.netType || null,
            descr: evidence.rir?.descr || null,
            regDate: evidence.rir?.regDate || null,
            country: evidence.rir?.country || null,
            rdns: evidence.rdns,
            rpki: evidence.rpki,
            announce: evidence.announce,
        },
        topology: buildTopology(resolvedAsn),
        latency: buildLatencyMatrix(ip),
        asnHistory,
        slots: {
            ...SLOTS,
            // A declared gap stays a declared gap, but an attempted fetch that
            // came back empty or timed out must not report itself as ready.
            asnHistory: asnHistory.failed
                ? { status: 'placeholder', needs: 'RIPEstat routing-history did not answer within our timeout for this prefix' }
                : { status: 'ready' },
        },
        sourcesFailed: evidence.failed,
    };
};

export { SLOTS, buildGeo, buildTopology, haversineKm, geoFromEvidence };
