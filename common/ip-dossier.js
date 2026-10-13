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
// `common/trust-score.js` scores it; this module adds the three things neither
// does — a multi-source geolocation comparison, the BGP neighbourhood computed
// from the CAIDA relationship snapshot already in memory, and the addresses the
// registered block puts around this one, which is arithmetic on a record the
// evidence already carries.

import { fetchUpstream } from './fetch-with-timeout.js';
import { gatherTrustEvidence } from './trust-signals.js';
import { assessTrust } from './trust-score.js';
import { providersOf, peersOf, customerCountOf, isTier1 } from './as-rel-db.js';
import { lookupAsOrgName } from './as-org-db.js';
import { isMaxMindReady, lookupMaxMind } from './maxmind-service.js';
import { buildAsnHistoryBlock } from './asn-announcement-history.js';
import { buildLatencyMatrix } from './latency-matrix.js';
import { toBgpPrefix } from './bgp-prefix.js';
import { parseIp, formatIp, cidrToRange } from './ip-math.js';
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

/**
 * The addresses a reader can step to from this one, inside the block the
 * registry already placed it in.
 *
 * This is arithmetic on data the dossier carries anyway — the address, and
 * `network.cidr` — so it costs no query and contacts nothing. Which addresses
 * sit *next to* this one is a property of the block; which of them are in use is
 * a property of the network, and that second question is the one no registry
 * answers. The entries are therefore links, and the gap below names the
 * observation the links cannot substitute for.
 *
 * @param {string} ip    the address the dossier is about
 * @param {string|null} cidr  its registered block, as `network.cidr`
 * @returns {object|null} `{ cidr, entries: [{ role, ip }] }`, or null when the
 *   registry named no block for this family — no block is not a block of one.
 */
const buildNeighbours = (ip, cidr) => {
    const parsed = parseIp(ip);
    const range = cidrToRange(cidr);
    if (!parsed || !range || range.family !== parsed.family) return null;

    const { value } = parsed;
    const format = (v) => formatIp({ family: range.family, value: v });
    // Stepping off either end of the registered block would name an address
    // somebody else holds, so the walk stops at the edges.
    const adjacent = (v) => (v > range.start && v < range.end ? format(v) : null);

    const wanted = [
        ['previous', adjacent(value - 1n)],
        ['next', adjacent(value + 1n)],
        // The edges are shown only when this address is not one of them — a
        // block edge the reader is already standing on is not a neighbour.
        ['blockFirst', value !== range.start ? format(range.start) : null],
        ['blockLast', value !== range.end ? format(range.end) : null],
    ];

    const seen = new Set([format(value)]);
    const entries = [];
    for (const [role, addr] of wanted) {
        if (!addr || seen.has(addr)) continue;
        seen.add(addr);
        entries.push({ role, ip: addr });
    }
    return { cidr, entries };
};

// Every section the page lays out, with the state of its backing data.
// `needs` names the specific thing that would turn the slot from a declared
// gap into a real section, so filling one in is a decision and not a search.
const SLOTS = {
    hero: { status: 'ready' },
    usage: { status: 'ready', partial: ['humanBot', 'scenario'] },
    asn: { status: 'ready', partial: ['asnKind', 'bandwidth'] },
    technical: { status: 'ready', partial: ['openPorts'] },
    threat: { status: 'partial', missing: ['abuseLevel', 'honeypot'], needs: 'an abuse-intelligence feed — `IPAPIIS_API_KEY` with `TRUST_IPAPIIS_FEED=true`, or `ABUSEIPDB_API_KEY` with `TRUST_PROVIDERS=abuseipdb` — plus the honeypot observations, which need traffic we cannot see' },
    deepRisk: { status: 'placeholder', needs: 'an anonymiser-list feed: `TRUST_PROVIDERS` (proxycheck.io, AbuseIPDB, IP2Location, ipinfo, the scan archive) or the `api.ipapi.is` abuse feed; the free registries do not carry membership in those lists' },
    vpnTrace: { status: 'placeholder', needs: 'a VPN exit directory — which service an address is the exit of, and the pool it exits into; the registries name the holder of the block, never the tunnel that terminates on it' },
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
    // The block's own arithmetic already names which addresses sit next to this
    // one, and those ship as links. The other question — which of them anyone
    // is *using* — is not in any registry, so the row says which half is real.
    neighbours: {
        status: 'partial',
        missing: ['sameBlockActivity'],
        needs: 'first-party observation of which addresses in the block answer at all — the registered block names this address\'s neighbours, and nothing here records whether any of them is in use',
    },
    topology: { status: 'ready', partial: true, note: 'CAIDA relationship graph, without path proportions' },
    // `ready` describes what this build can ask; the pass below overrides it to
    // a declared gap when no configured recursor answered truthfully about this
    // particular address. IPv6 stays partial — no zone in the default list
    // publishes v6 content, so a v6 address is reported as unasked rather than
    // as unlisted.
    blocklists: { status: 'ready', partial: ['ipv6'] },
    asnHistory: { status: 'ready' },
    companyHistory: { status: 'placeholder', needs: 'a registration-history dataset; RIR RDAP answers only for the current object' },
    coLocated: { status: 'placeholder', needs: 'a datacenter-to-customer directory we do not have' },
    actions: { status: 'ready' },
};

/**
 * What the open-ports row can honestly say, given whatever the scan archive said.
 *
 * Four states, because collapsing them is how a page lies by omission: a
 * deployment that never consults the archive has a declared gap; an address the
 * archive has never looked at *was* asked and got an answer; a record is a
 * measurement; and a timeout is this lookup's failure, not this instance's.
 *
 * @param {object|null} scan  `evidence.scan`, or absent when it was never asked
 * @returns {object} a slot descriptor
 */
const technicalSlot = (scan) => !scan ? SLOTS.technical
    : scan.status === 'record' ? { status: 'ready' }
        : scan.status === 'no-record' ? { status: 'ready', note: 'the archive has no observation for this address' }
            : { status: 'placeholder', needs: 'internetdb.shodan.io did not answer within our timeout' };

// Why a blocklist pass had nothing to say, keyed on the reason `common/dnsbl.js`
// reported. Each is a genuinely different situation, and one message for all of
// them would read a network that blocks DNS as a network that clears the address
// — an IPv6 address as one that was asked and found clean, and a range's posting
// rules as nobody answering at all.
const BLOCKLIST_GAP_REASONS = {
    'no-ipv6-zone': 'no blocklist zone in this build\'s list publishes IPv6 content, so an IPv6 address is never asked about at all',
    'no-trustworthy-resolver': 'a recursor that answers blocklist queries truthfully; every configured one fabricated its canary answer',
    'no-zones': 'a blocklist zone to ask — this build\'s list answers no question about this address',
    unparseable: 'an address that parses into a reverse-DNS query name',
    'no-answer': 'a recursor that answers blocklist queries truthfully; none of the zones replied',
    'policy-only': 'at least one zone answering about the address itself — the pass did hear back, but every answer was the policy that covers this range, and a range\'s rules accuse no address',
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
    // The keyed lists promote a panel only when at least one vendor actually
    // answered — an object full of `null` because every configured source timed
    // out must not render as a section of clears.
    const usablePrivacy = Boolean(evidence.privacy?.sources?.length);
    const technical = technicalSlot(evidence.scan);

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
            // The registry's own statement of who originates the block. Whether
            // it matches the AS carrying the address is already decided and
            // reported inside `trust.signals.nativeness`; this is the raw half, so
            // a consumer can see which of the two answers disagreed.
            originAs: evidence.rir?.originAs || null,
            rdns: evidence.rdns,
            rpki: evidence.rpki,
            announce: evidence.announce,
            asnRegistered: evidence.asnRegistered || null,
            ipv4Total: evidence.announce?.v4Size || null,
            // RIPEstat's holder reads `GOOGLE - Google LLC`: the handle, then
            // the organisation. The card shows them on separate rows, so split
            // here rather than making the UI parse a registry string.
            holderName: (evidence.asName || '').split(' - ')[0] || null,
            // The scan archive's observations, present only when this deployment
            // consults it (`TRUST_PROVIDERS=internetdb`). Absent is a declared gap,
            // not an empty port list: "nobody has looked at this address" and
            // "nothing was open on it" are different answers, and the row has to be
            // able to say which one it is showing.
            scan: evidence.scan || null,
        },
        blocklists: evidence.blocklists || null,
        privacy: evidence.privacy || null,
        topology: buildTopology(resolvedAsn),
        neighbours: buildNeighbours(ip, evidence.rir?.cidr || null),
        latency: buildLatencyMatrix(ip),
        asnHistory,
        slots: {
            ...SLOTS,
            // A declared gap stays a declared gap, but an attempted fetch that
            // came back empty or timed out must not report itself as ready.
            asnHistory: asnHistory.failed
                ? { status: 'placeholder', needs: 'RIPEstat routing-history did not answer within our timeout for this prefix' }
                : { status: 'ready' },
            // Which recursor the accusations came through is part of their
            // meaning, so it is reported; a pass with nothing to say is a
            // declared gap rather than a clean sheet — and the reason it had
            // nothing to say is the pass's own words, not a guess made here.
            blocklists: evidence.blocklists
                ? {
                    status: 'ready',
                    note: `${evidence.blocklists.answered} of ${evidence.blocklists.zones} zones answered through ${evidence.blocklists.resolver || 'an unattributed recursor'}`,
                }
                : {
                    // The reason travels as a machine key as well as a sentence.
                    // The page reads its own words out of the locale packs, and
                    // one of these gaps is misdescribed by the generic line:
                    // "nobody replied" is not what a pass that heard only range
                    // policy looks like, and the panel has to be able to tell
                    // without parsing English.
                    status: 'placeholder',
                    gapKey: evidence.blocklistsReason,
                    needs: BLOCKLIST_GAP_REASONS[evidence.blocklistsReason] || BLOCKLIST_GAP_REASONS['no-answer'],
                },
            // The two panels the optional keyed feed fills. Off, they stay the
            // declared gaps they have always been; on, they report what it said,
            // and the honeypot half — which needs traffic we cannot observe —
            // stays listed either way.
            threat: usablePrivacy ? { status: 'ready', partial: ['honeypot'] } : SLOTS.threat,
            deepRisk: usablePrivacy ? { status: 'ready', partial: ['botTrafficRatio'] } : SLOTS.deepRisk,
            // The open-ports row, which is filled by the scan archive rather than
            // by any registry — hence its own three states above.
            technical,
        },
        sourcesFailed: evidence.failed,
    };
};

export {
    SLOTS, BLOCKLIST_GAP_REASONS, buildGeo, buildNeighbours, buildTopology,
    haversineKm, geoFromEvidence, technicalSlot,
};
