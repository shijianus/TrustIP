// The shape a commercial IP-intelligence provider answers in, and the parsing
// every one of them needs.
//
// One flat answer per (provider, address). `null` means the vendor did not tell
// us, which is not the same fact as `false` — the vendor saying it cleared the
// address. That difference is the whole of this file's reason to exist: an
// adapter that writes `false` for an absent flag hands the ladder in
// common/trust-score.js a clean bill of health that nobody issued, and the free
// tiers do exactly that, routinely, by answering without the detection fields.
//
// `status` separates the three ways an answer can be missing, because they are
// charged differently:
//   `unavailable` — this deployment never configured the provider, so nothing
//                   was asked: a declared capability gap, kept out of the
//                   confidence denominator (see `FEED_GAPS`).
//   `error`       — it was asked and did not answer: an `unknown` signal, which
//                   does shrink confidence.
//   `ok`          — it answered, possibly with nothing in the fields.
//
// `authority` says what kind of claim a `yes` is, and the merge in vote.js weighs
// the two kinds differently:
//   `list`        — somebody's anonymiser database (proxycheck.io, ipapi.is,
//                   ipinfo's privacy block);
//   `observation` — a service was seen listening on the address (a Shodan
//                   InternetDB tag). An open proxy answering on port 3128 and a
//                   visitor anonymising through an address are different facts,
//                   and a rule that cannot tell them apart lets one port scan
//                   accuse a whole hosting range.
//
// `raw` is kept so a spec can pin a parser against the vendor's actual JSON. It
// never reaches the evidence object or an HTTP response — it is dropped at the
// merge — for the same reason `api/trust-score.js` refuses to copy out a
// registrant's name, address and phone number: a trust verdict has no use for
// them, and passing them through would turn this endpoint into a people-search
// proxy over public registries.

// The per-provider budget. `fetchUpstream` defaults to 8s, which is right for a
// registry that is the only answer to a question; these are redundant sources
// whose value arrives with the fastest of them, and one vendor's slow minute
// should not hold up a page that four others can answer.
export const PROVIDER_TIMEOUT_MS = 5000;

export const STATUS = { ok: 'ok', unavailable: 'unavailable', error: 'error' };

const EMPTY = {
    isProxy: null, isVpn: null, isTor: null, isHosting: null, isMobile: null,
    isAbuser: null, abuseScore: null, abuseReports: null, riskScore: null,
    asn: null, asName: null, country: null, usageType: null,
    lat: null, lon: null,
};

/**
 * A provider that answered. Absent fields stay `null`, so the caller never has
 * to know which spelling this vendor uses for "not applicable".
 *
 * @param {string} source  the vendor id, as it will appear in `signals[].matched`
 * @param {object} [fields]
 * @returns {object}
 */
export const answered = (source, fields = {}) => ({
    source,
    status: STATUS.ok,
    authority: null,
    ...EMPTY,
    ...fields,
});

/** @param {string} reason  `missing_key` is the one a blank `.env` produces */
export const unavailable = (source, reason) => ({
    source, status: STATUS.unavailable, reason, ...EMPTY,
});

export const errored = (source, reason) => ({
    source, status: STATUS.error, reason, ...EMPTY,
});

// The `true` a vendor can write. Each of these dialects is real: proxycheck.io
// answers the strings `yes`/`no`, IP2Location `True`/`False`, ipapi.is and
// AbuseIPDB plain JSON booleans, and a `0`/`1` shows up in anything derived from
// a legacy API. Anything else is not an answer, so it becomes `null` rather than
// the `false` that a bare `=== 'yes'` chain would have produced.
export const toFlag = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
    if (typeof value !== 'string') return null;
    const text = value.trim().toLowerCase();
    if (text === 'yes' || text === 'true' || text === '1') return true;
    if (text === 'no' || text === 'false' || text === '0') return false;
    return null;
};

// A number the vendor actually sent. `Number('')` is 0 and `Number('N/A')` is
// NaN, and both are answers these APIs really give.
export const toNumber = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

// A non-empty string, trimmed; `''`, `'-'` and `'N/A'` — which is what the
// geo handlers in `api/` normalise a missing field into — are not values.
export const toText = (value) => {
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text !== '-' && text !== 'N/A' ? text : null;
};

// `AS15169`, `15169`, `AS15169 - Google LLC`, 15169. Anything that is not a
// plain number after the optional prefix is absent, never `ASNaN`: the same rule
// `parseAsNumber` holds for the RIR's origin field.
export const toAsn = (value) => {
    const m = /^\s*(?:as)?\s*(\d{1,7})\b/i.exec(String(value ?? ''));
    if (!m) return null;
    const n = Number(m[1]);
    return n >= 1 && n <= 4294967294 ? n : null;
};

// A registration `usageType` is registry data about what a block was allocated
// for — not an anonymiser list — so it arrives at the merge with `observation`
// authority and cannot accuse on its own. Matched on words because every vendor
// writes its own compound: `Data Center/Web Hosting/Transit`, `Mobile DSL`,
// `Fixed Line ISP`, `ISP, Cable/DSL`. A phrase is matched against the joined
// words so `data center` survives the vendor's separators.
const HOSTING_WORDS = [
    'hosting', 'data center', 'datacenter', 'data centre', 'server room',
    'content delivery', 'search engine robot', 'cloud',
];
const MOBILE_WORDS = ['mobile', 'wireless', 'cellular', 'gsm', '4g', '5g'];

const wordsOf = (text) => (toText(text) || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * The two claims a usage-type label supports, and nothing else.
 *
 * @param {string|null} usageType
 * @returns {{isHosting: boolean|null, isMobile: boolean|null}}  `null` when the
 *   vendor published no label at all
 */
export const usageFlags = (usageType) => {
    const words = wordsOf(usageType);
    if (!words.length) return { isHosting: null, isMobile: null };
    const phrase = words.join(' ');
    const has = (list) => list.some((w) => (w.includes(' ') ? phrase.includes(w) : words.includes(w)));
    return { isHosting: has(HOSTING_WORDS), isMobile: has(MOBILE_WORDS) };
};

/**
 * One key from a comma-separated pool, at random.
 *
 * The list is a quota-spreading device, and the rule has to be the same wherever
 * a key is read (`common/ipapi-key.js` is the precedent for one vendor). Two
 * implementations of "pick a key" is how half a deployment ends up starving one
 * credential while the others sit idle.
 *
 * An unset variable is a supported configuration, so this answers `null` instead
 * of throwing — every caller has an early "not configured" branch before a
 * request leaves the process.
 */
export const pickKey = (...names) => {
    for (const name of names) {
        const keys = (process.env[name] || '')
            .split(',')
            .map((key) => key.trim())
            .filter(Boolean);
        if (keys.length) return keys[Math.floor(Math.random() * keys.length)];
    }
    return null;
};

// The legacy spelling of ipinfo's token is read wherever its geo handler reads
// it, so a deployment that never renamed the variable keeps its configuration.
export const ipinfoToken = () => pickKey('IPINFO_API_KEY', 'IPINFO_API_TOKEN');
