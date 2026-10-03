// TrustMy.IP's own IP trust score: the classification and arithmetic, with no
// network access at all. `assessTrust` takes whatever the gatherer managed to
// learn about an address and returns a 0–100 score plus one entry per signal.
//
// Three rules shape the whole module:
//
//   1. Every judgement names its evidence. `signals[].matched` carries the
//      literal text (an org name, a PTR label, a mask distribution) that
//      produced the verdict, so the UI can show WHY and a visitor can tell a
//      well-founded read from a wrong one.
//   2. An unmeasured signal is `unknown`, never a pass. `confidence` counts the
//      signals that actually resolved, the score is capped by it (a
//      half-evaluated address cannot reach the top band on absent evidence),
//      and `floor`/`ceiling` report the range the score could have occupied had
//      every unknown resolved against us.
//   3. The scale starts neutral, not perfect. An address begins at 70 — "no
//      reason to distrust it" — and only reaches the top bands by showing
//      positive registry evidence. A 100 means "we could see six good things
//      about this line", not "nothing was found".
//
// This is a heuristic classification built from public registry data. It is not
// an abuse-intelligence product: the signals that would need a subscription
// feed or a feed we could not verify are listed in `GAPS` and reported to the
// UI as deliberately not measured, rather than imitated with something weaker.
//
// The gatherer lives in common/trust-signals.js; the HTTP shell in
// api/trust-score.js.

// Network identity classes. `datacenter` and `isp` are the headline verdict
// visitors come for; the rest keep the ladder honest — a university range is
// neither a home line nor a hosting pool, and calling it either would be wrong.
const CLASSES = {
    datacenter: 'datacenter',
    isp: 'isp',
    mobile: 'mobile',
    education: 'education',
    government: 'government',
    business: 'business',
    anycast: 'anycast',
    unknown: 'unknown',
};

// The neutral starting point of any address with no evidence either way.
const BASE = 70;

// Hosting / VPS / colocation operators, keyed on words that appear in their
// registry `org`, `netname`, `descr`, AS-name and geo `isp` fields. Matching
// runs over a lower-cased, word-normalised concatenation.
const DATACENTER_TOKENS = [
    'hosting', 'hostings', 'host', 'hosts', 'webhost', 'webhosts', 'colocation',
    'colocate', 'datacenter', 'datacenters', 'datacentre',
    'vps', 'cloud', 'clouds', 'servers', 'server', 'dedicated', 'hetzner',
    'ovh', 'contabo', 'scaleway', 'upcloud', 'hostinger', 'selectel',
    'hostkey', 'zomro', 'kamatera', 'phoenixnap', 'equinix', 'cyrusone',
    'softlayer', 'dreamhost', 'klara', 'nforce', 'leaseweb', 'worldstream',
    'transip', 'm247', 'vpsdime', 'xtom', 'gcore', 'cdn77', 'keycdn',
    'maxcdn', 'stackpath', 'highwinds', 'digitalocean', 'vultr', 'linode',
    'akamai', 'cloudflare', 'fastly', 'amazon', 'aws', 'alibaba', 'aliyun',
    'tencent', 'baidu', 'huawei', 'oracle', 'azure', 'microsoft', 'gcp',
];

// Transit providers, telcos and cable/fibre access networks — the addresses a
// person's own connection actually comes from.
const ISP_TOKENS = [
    'telekom', 'vodafone', 'orange', 'sfr', 'movistar', 'telefonica',
    'swisscom', 'sunrise', 'telenor', 'telia', 'tele2', 'comcast', 'charter',
    'cox', 'cablevision', 'verizon', 'sprint', 'centurylink', 'lumen',
    'frontier', 'viasat', 'starlink', 'telstra', 'optus', 'tpg', 'iinet',
    'hinet', 'chinanet', 'hgc', 'ggv', 'kpn', 'zeelandnet', 'fastweb',
    'jio', 'bsnl', 'mtn', 'vodacom', 'bt', 'att', 'ee', 'o2', 'three',
    't mobile', 'tmobile', 'kddi', 'softbank', 'pldt', 'globacom', 'ntt',
    'broadband', 'cable', 'wireless', 'telecom', '~telefon', 'communications',
    'networks', 'internet', 'provider', 'providers', 'telecommunications',
];

// Telcos whose retail identity is mobile-first. Checked before ISP so
// "Vodafone GmbH" reads as a cellular network rather than a fixed line.
// Only claimed when the name says mobile itself. Brand names of operators that
// sell both fixed and cellular access ("Deutsche Telekom", "Vodafone",
// "Movistar") are deliberately absent: guessing a subscriber's medium from
// their carrier's brand is the kind of confident wrong inference this ladder
// must not make, and calling such a network an access provider is right either
// way.
const MOBILE_TOKENS = [
    'mobile', 'cellular', 'wireless', 'gsm', 'umts', 'lte', '4g', '5g', 'pcs',
    't mobile', 'tmobile', 'hutchison', 'mobifone', 'viettel', 'smartfren',
    'dtac', 'airtel', 'viom', 'hkt',
];

const EDUCATION_TOKENS = [
    'university', 'universitat', 'universitaet', 'universite', 'universidade',
    'universidad', 'universitats', 'college', 'school', 'institute',
    'institut', 'academy', 'research', 'education', 'edu', 'hochschule',
    '~politecn', 'cnrs', 'cern', '~forschungs', '~lehr',
];

const GOVERNMENT_TOKENS = [
    'government', 'gov', '~minist', 'department', 'agency', 'municipal',
    'council', 'defence', 'defense', 'military', 'army', 'navy',
    'parliament', '~bundes', 'administration', 'stadt', 'gemeente',
];

// Public recursive DNS resolvers. Their geolocation is the point of presence
// the visitor happened to reach, never a fact about the service, so
// identifying one changes what the rest of the evidence means (see
// `identity.anycast`). Deliberately narrow: a CDN or cloud edge is not a public
// resolver and must not get the anycast exemption — an AWS instance is a
// rented machine and should score like one.
const ANYCAST_NETWORKS = new Set([
    15169,   // Google Public DNS
    13335,   // Cloudflare (1.1.1.1)
    35540,   // Quad9
    36376,   // Cisco Umbrella / OpenDNS
    198053,  // Adaptive DNS
    42708,   // Surfilter / Cleanup
]);

// PTR label patterns, matched as whole words against the hostname with its
// dots turned into spaces (`a.b.compute.amazonaws.com` → `a b compute amazonaws
// com`). Word matching is what keeps the city "Liverpool" from reading as a
// customer `pool`, and a trailing `*` marks the few patterns that genuinely are
// word prefixes (`dsl` inside `adsl`, `vdsl`, `xdsl`).
const DATACENTER_PTR = [
    'compute amazonaws', 'compute amazon', 'ec2 internal', 'compute local',
    'amazonaws', 'googleusercontent', 'aliyuncs', 'myqcloud', 'tencentclb',
    'vultr', 'digitaloceanspaces', 'linode', 'upcloudcs', 'contabo',
    'hetzner', 'your server', 'ovh', 'klara', 'm247', 'leaseweb',
    'worldstream', 'hostserver', 'hosting', 'hosted', 'dedicated', 'vps',
    'scaleway', 'oraclecloud', 'cloudways', 'servercontrol', 'cdn77',
    'fastly', 'akamaiedge',
];

const RESIDENTIAL_PTR = [
    'cpe', '~dsl', '~ppp', 'catv', 'hsd', 'hsi', 'broadband', 'pool', '~dyn',
    'dynamic', 'customer', 'clients', 'home', 'residential', 'ftth', 'fttb',
    'gpon', 'mobile', 'subscriber', 'bng', 'bras', 'ggv', 'ddns', 'wireless',
    'kabelfunk',
];

// Signals we deliberately do not measure, and the reason. Surfaced to the UI so
// the absence is visible instead of looking like an all-clear.
const GAPS = [
    // Subscription abuse databases; a heuristic cannot substitute for them.
    'proxyVpnDb',
    // Tor exit membership: the list endpoints we could reach from a clean
    // install did not answer, and an untested detector is worse than none.
    'anonymityNetworks',
    // Blocklists resolve differently through every recursive resolver, and
    // the ones we could test answered with fabricated hits for every query.
    'blocklists',
    // Needs traffic visibility we have no way to observe.
    'botTrafficRatio',
    'historicalAbuseReports',
];

// Some findings do not merely subtract: they disqualify. An address whose
// route origination is provably unauthorized has contradicted a fact about
// itself, and no amount of other good evidence should lift it into a band that
// reads "trusted". Without this gate a well-established access provider with a
// misconfigured ROA still lands in the 60s, which would be a lie.
const GATE_CEILING = {
    invalid: 44,
    invalid_asn: 49,
};

// Which signals can gate. Only facts about routing are disqualifying today;
// naming heuristics must never be, because a wrong guess would be unforgivable
// in a way a low score is not.
const GATED_SIGNALS = ['rpki'];

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Tokens are matched as whole words, not bare substrings. `'host'` matching
// inside "g**host**" is the exact failure this prevents, and several real AS
// names ("Ghost Communications") walk right into it. Two escapes exist for
// stems that genuinely live inside a word:
//
//   'dsl*'  starts a word        — matches `dsl-1.example`, not `adsl`
//   '~dsl'  anywhere in a word   — matches `adsl`, `vdsl`, `xdsl`, `dslam`
//
// The `~` form is reserved for stems distinctive enough that a substring hit is
// not an accident; `'~host'` would be exactly the bug the boundary exists for.
const PATTERNS = new Map();

const patternFor = (token) => {
    let re = PATTERNS.get(token);
    if (!re) {
        const anywhere = token.startsWith('~');
        const prefixOnly = token.endsWith('*');
        const body = (anywhere ? token.slice(1) : token)
            .replace(/\*$/, '')
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const source = anywhere
            ? body
            : `(?:^|\\s)${body}${prefixOnly ? '' : '(?:\\s|$)'}`;
        re = new RegExp(source);
        PATTERNS.set(token, re);
    }
    return re;
};

// First token from `list` that matches `haystack`, or null. Returning the
// literal token is the point: the UI shows what matched.
const firstToken = (haystack, list) => list.find((token) => patternFor(token).test(haystack)) || null;

const knownText = (s) => (typeof s === 'string' && s.trim() && s.trim() !== '-') ? s.trim() : null;

// --- Registry identity ---------------------------------------------------

// One class per address, first match wins, ordered most-specific-first: a
// public anycast service is not an ordinary datacenter, and a mobile network
// is not a fixed line. Every name the sources offer is searched together — the
// CAIDA org name, the RIR's netname/descr, the AS's own description line and
// the geo answer's isp field — because they disagree often enough that one
// field's absence should not hide another's evidence.
const classifyName = ({ asOrg, netName, descr, asName, geoIsp, geoOrg, asn }) => {
    if (ANYCAST_NETWORKS.has(asn)) return { cls: CLASSES.anycast, matched: `AS${asn}` };

    const hay = norm([asOrg, netName, descr, asName, geoIsp, geoOrg].filter(Boolean).join(' '));
    if (!hay) return { cls: CLASSES.unknown, matched: null };

    let hit = firstToken(hay, EDUCATION_TOKENS);
    if (hit) return { cls: CLASSES.education, matched: hit };

    hit = firstToken(hay, GOVERNMENT_TOKENS);
    if (hit) return { cls: CLASSES.government, matched: hit };

    hit = firstToken(hay, DATACENTER_TOKENS);
    if (hit) return { cls: CLASSES.datacenter, matched: hit };

    // Mobile is checked before isp because many mobile tokens are also
    // present in telco names; the more specific claim wins.
    hit = firstToken(hay, MOBILE_TOKENS);
    if (hit) return { cls: CLASSES.mobile, matched: hit };

    hit = firstToken(hay, ISP_TOKENS);
    if (hit) return { cls: CLASSES.isp, matched: hit };

    return { cls: CLASSES.unknown, matched: null };
};

// --- Reverse DNS ---------------------------------------------------------

// `none` (a real, empty answer) is weak evidence of a hosting pool — access
// networks usually do name their customers. `failed` (we could not ask) is not
// evidence at all and must never read as "no PTR".
const classifyPtr = (rdns) => {
    const hay = norm(rdns);
    if (!hay) return { kind: 'none', matched: null };
    const dc = firstToken(hay, DATACENTER_PTR);
    if (dc) return { kind: 'datacenter', matched: dc };
    const res = firstToken(hay, RESIDENTIAL_PTR);
    if (res) return { kind: 'residential', matched: res };
    return { kind: 'neutral', matched: null };
};

// --- BGP announcement shape ---------------------------------------------

// A network announcing almost everything as a /24 or smaller is selling slices
// of it. A transit access provider announces a handful of large blocks and lets
// customer ASes do the de-aggregation. `smallShare` is the fraction of
// announced v4 prefixes with mask >= 24; `largest` is the coarsest mask seen.
//
// Called with no shape at all — an absent source and an anycast address, for
// which the question is meaningless — both arrive as nothing to report.
const announceShape = (source) => {
    const { v4Count, smallShare, largest } = source || {};
    if (!v4Count || typeof smallShare !== 'number' || typeof largest !== 'number') {
        return null;
    }
    const pct = Math.round(smallShare * 100);
    if (largest <= 12) return { kind: 'transit', matched: `largest /${largest}, ${pct}% small` };
    if (v4Count >= 150 && smallShare >= 0.85) return { kind: 'pool', matched: `${v4Count} prefixes, ${pct}% /24 or smaller` };
    if (v4Count <= 20 && smallShare < 0.5) return { kind: 'single', matched: `${v4Count} prefixes, ${pct}% small` };
    return { kind: 'mixed', matched: `${v4Count} prefixes, ${pct}% /24 or smaller` };
};

// --- Allocation age ------------------------------------------------------

// How long the *current registration object* has existed. Note what this is
// not: RIPE legacy objects carry 1970-01-01 as a placeholder for "date
// unknown", and a re-allocation resets the timestamp, so this measures the
// record, not the network's history. Dates before 1980 are read as that
// placeholder rather than as an extraordinarily trustworthy block.
const PLACEHOLDER_BEFORE_MS = Date.parse('1980-01-01T00:00:00Z');

const ageYears = (regDate, now) => {
    const t = Date.parse(regDate || '');
    if (!Number.isFinite(t) || t < PLACEHOLDER_BEFORE_MS) return null;
    const years = (now - t) / (365.25 * 24 * 60 * 60 * 1000);
    return years >= 0 ? years : null;
};

// --- The ladder ----------------------------------------------------------

const BANDS = [
    { min: 85, band: 5, tone: 'strong' },
    { min: 70, band: 4, tone: 'good' },
    { min: 50, band: 3, tone: 'mixed' },
    { min: 30, band: 2, tone: 'risky' },
    { min: 0, band: 1, tone: 'poor' },
];

const bandOf = (score) => BANDS.find((b) => score >= b.min) || BANDS[BANDS.length - 1];

// The score a partially-evidenced address is allowed to reach. Six of six
// signals may show 100; five of six 92; four of six tops out at 79 — inside
// "good" but never "strong" — and two or fewer cannot leave the middle.
const capForConfidence = (measured, total) => {
    const missing = total - measured;
    if (missing <= 0) return 100;
    if (missing === 1) return 92;
    if (missing === 2) return 79;
    return 66;
};

// A non-public address has no trust story: it cannot appear in the global
// routing table at all. Short-circuited so no caller reads a score as
// "this reserved range is reputable".
const NON_PUBLIC = () => ({
    score: null,
    band: null,
    tone: 'none',
    cls: 'non-public',
    anycast: false,
    signals: [{
        id: 'publicness',
        state: 'unknown',
        effect: 0,
        label: 'trustip.signal.nonPublic',
        detail: null,
        matched: null,
    }],
    confidence: { measured: 0, total: 0, level: 'none' },
    floor: null,
    ceiling: null,
    gaps: GAPS,
});

/**
 * Score one address from the evidence gathered about it.
 *
 * @param {object} input
 * @param {string}  input.ip
 * @param {boolean} [input.reserved]  RFC1918 / CGNAT / documentation / loopback
 * @param {object}  [input.geo]       { country_code, asn, org, isp }
 * @param {string}  [input.asOrg]     CAIDA as2org name (local snapshot)
 * @param {string}  [input.asName]    RIPEstat as-overview holder line
 * @param {string}  [input.rdns]      PTR target, or null when absent
 * @param {boolean} [input.rdnsFailed] lookup attempted and errored
 * @param {object}  [input.rir]       { netType, status, descr, netName, cidr,
 *                                      regDate, country }
 * @param {string}  [input.rpki]      'valid' | 'invalid' | 'not-found' | null
 * @param {object}  [input.announce]  { v4Count, smallShare, largest }
 * @param {number}  [input.now]       epoch ms, injectable for tests
 * @returns {object} score, band, tone, class, per-signal breakdown, confidence
 */
export const assessTrust = (input = {}) => {
    const now = typeof input.now === 'number' ? input.now : Date.now();
    if (input.reserved) return NON_PUBLIC();

    const geo = input.geo || {};
    const rir = input.rir || {};
    const asn = typeof geo.asn === 'number' ? geo.asn : Number(geo.asn) || null;
    const signals = [];

    const name = classifyName({
        asOrg: input.asOrg,
        netName: rir.netName,
        descr: rir.descr,
        asName: input.asName,
        geoIsp: geo.isp,
        geoOrg: geo.org,
        asn,
    });
    const anycast = name.cls === CLASSES.anycast;

    // 1 — Registry identity. The heaviest signal, because the operator that
    //       owns a block is what makes it a home line or a rented VM.
    const CLASS_EFFECT = {
        [CLASSES.anycast]: 0,
        [CLASSES.datacenter]: -34,
        [CLASSES.isp]: 14,
        [CLASSES.mobile]: 10,
        [CLASSES.education]: 12,
        [CLASSES.government]: 12,
        [CLASSES.business]: 4,
        [CLASSES.unknown]: 0,
    };
    const classEffect = CLASS_EFFECT[name.cls] ?? 0;
    signals.push({
        id: 'registryClass',
        state: name.cls === CLASSES.unknown ? 'unknown'
            : classEffect > 0 ? 'positive'
                : classEffect < 0 ? 'negative' : 'neutral',
        effect: classEffect,
        label: 'trustip.signal.registryClass',
        detail: name.cls,
        matched: name.matched,
    });

    // 2 — Reverse DNS.
    const ptr = input.rdnsFailed
        ? { kind: 'failed', matched: null }
        : classifyPtr(input.rdns);
    const PTR_EFFECT = { datacenter: -16, residential: 12, neutral: 0, none: -4, failed: 0 };
    const ptrEffect = PTR_EFFECT[ptr.kind];
    signals.push({
        id: 'rdns',
        state: ptr.kind === 'failed' ? 'unknown'
            : ptr.kind === 'none' ? 'caution'
                : ptrEffect > 0 ? 'positive'
                    : ptrEffect < 0 ? 'negative' : 'neutral',
        effect: ptrEffect,
        label: 'trustip.signal.rdns',
        detail: ptr.kind,
        matched: ptr.matched || knownText(input.rdns),
    });

    // 3 — Announcement shape. Meaningless for an anycast service: it announces
    //       customer-facing space everywhere by design, so it is reported as
    //       not-applicable rather than held against the address.
    const shape = anycast ? null : announceShape(input.announce);
    const SHAPE_EFFECT = { pool: -12, transit: 8, single: 5, mixed: 0 };
    const shapeEffect = shape ? SHAPE_EFFECT[shape.kind] : 0;
    signals.push({
        id: 'announcement',
        state: anycast ? 'neutral'
            : !shape ? 'unknown'
                : shapeEffect < 0 ? 'negative'
                    : shapeEffect > 0 ? 'positive' : 'neutral',
        effect: shapeEffect,
        label: 'trustip.signal.announcement',
        detail: anycast ? 'not-applicable' : shape ? shape.kind : null,
        matched: shape ? shape.matched : null,
    });

    // 4 — RPKI. The only signal here that is a routing fact rather than a
    //       naming heuristic, so it is weighted to dominate. RIPEstat reports
    //       six states: an origin that is not the authorized one
    //       (`invalid_asn`) and an over-long announcement (`invalid_length`)
    //       are different mistakes and cost differently, and `unknown` means
    //       the validator had no answer — which is not the same as, and must
    //       not be charged like, a prefix that provably has no ROA (`not-found`).
    const RPKI_EFFECT = {
        valid: 6,
        invalid: -40,
        invalid_asn: -30,
        invalid_length: -10,
        'not-found': -8,
        unknown: 0,
    };
    const rpki = input.rpki || null;
    const rpkiEffect = rpki != null ? (RPKI_EFFECT[rpki] ?? 0) : 0;
    signals.push({
        id: 'rpki',
        state: rpki == null || rpki === 'unknown' ? 'unknown'
            : rpkiEffect < 0 ? 'negative'
                : rpkiEffect > 0 ? 'positive' : 'neutral',
        effect: rpkiEffect,
        label: 'trustip.signal.rpki',
        detail: rpki,
        matched: rpki && rpki !== 'valid' && rpki !== 'unknown' && asn ? `AS${asn}` : null,
    });

    // 5 — How long the allocation has existed. Old, stable allocations are
    //       rarely throwaway abuse infrastructure. Note this is the *current
    //       registration* of the block, which a re-allocation resets.
    const years = ageYears(rir.regDate, now);
    const ageEffect = years == null ? 0 : years >= 10 ? 10 : years >= 8 ? 8 : years <= 1 ? -8 : 0;
    signals.push({
        id: 'allocationAge',
        state: years == null ? 'unknown'
            : ageEffect > 0 ? 'positive'
                : ageEffect < 0 ? 'caution' : 'neutral',
        effect: ageEffect,
        label: 'trustip.signal.allocationAge',
        detail: years == null ? null : `${Math.floor(years)}y`,
        matched: knownText(rir.regDate),
    });

    // 6 — Nativeness: the country the block is registered in versus the country
    //       the geo answer places it in. A mismatch on an ordinary unicast
    //       address means the geo answer and the registry disagree; it is
    //       reported, and costs little, because one of the two is simply wrong.
    const rirCountry = knownText(rir.country);
    const geoCountry = knownText(geo.country_code);
    const comparable = Boolean(rirCountry && geoCountry);
    const mismatch = comparable && rirCountry.toUpperCase() !== geoCountry.toUpperCase();
    signals.push({
        id: 'nativeness',
        state: anycast || !comparable ? 'unknown' : mismatch ? 'caution' : 'positive',
        effect: anycast || !comparable ? 0 : mismatch ? -6 : 2,
        label: 'trustip.signal.nativeness',
        detail: anycast ? 'not-applicable'
            : !comparable ? null
                : mismatch ? `${rirCountry.toUpperCase()}≠${geoCountry.toUpperCase()}` : 'native',
        matched: mismatch && !anycast ? `${rirCountry} / ${geoCountry}` : null,
    });

    // --- arithmetic ------------------------------------------------------
    const measured = signals.filter((s) => s.state !== 'unknown').length;
    const total = signals.length;

    // `raw` is the plain additive total before any ceiling is applied — the
    // best this evidence on its own could claim, and the top of the range the
    // UI may show.
    const raw = clamp(BASE + signals.reduce((sum, s) => sum + s.effect, 0), 0, 100);

    // A disqualifying finding caps the result no matter what else is in the
    // address's favour.
    const gates = signals
        .filter((s) => GATED_SIGNALS.includes(s.id) && GATE_CEILING[s.detail] != null)
        .map((s) => GATE_CEILING[s.detail]);
    const gatedBy = gates.length ? Math.min(...gates) : null;
    const confidenceCap = capForConfidence(measured, total);

    const score = Math.min(raw, gatedBy ?? 100, confidenceCap);

    // Range the score could have taken had every unknown resolved worst-case.
    const WORST = {
        registryClass: -34, rdns: -16, announcement: -12, rpki: -40,
        allocationAge: -8, nativeness: -6,
    };
    let floor = score;
    for (const s of signals) {
        if (s.state === 'unknown') floor = clamp(floor + WORST[s.id], 0, 100);
    }

    const level = measured >= total - 1 ? 'high'
        : measured >= Math.ceil(total / 2) ? 'medium' : 'low';

    const band = bandOf(score);
    return {
        score,
        raw,
        band: band.band,
        tone: band.tone,
        cls: name.cls,
        anycast,
        signals,
        confidence: { measured, total, level },
        // Why the displayed score sits below the evidence's own total, when it
        // does: a disqualifying finding, or simply not having measured enough.
        capped: gatedBy != null && gatedBy < raw ? 'disqualified'
            : confidenceCap < raw ? 'evidence' : null,
        floor,
        ceiling: raw,
        gaps: GAPS,
    };
};

export { CLASSES, BANDS, GAPS, BASE, ANYCAST_NETWORKS };
