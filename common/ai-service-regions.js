// Which countries each AI service says it serves, and what the visitor's exit
// address being in (or outside) that set is actually worth.
//
// The subject is a split tunnel: a visitor whose ChatGPT traffic leaves through a
// Tokyo address while their bank leaves through a Shanghai one needs to know that,
// and the first fact they ask after it is *will ChatGPT serve that exit at all*.
// That question is answerable only from the provider's own published list, so this
// file holds those lists verbatim in ISO 3166-1 alpha-2 and names the page each one
// came from, with the date it was read. Nothing here is measured or inferred: an
// availability policy is a vendor's statement of intent, it changes without notice,
// and a stale copy of it is a confident wrong answer about someone else's product.
//
// Three limits are load-bearing, and the UI has to keep them visible:
//
// 1. **A list is a policy, not a prediction.** OpenAI and Anthropic both write that
//    access from outside the listed set may get the *account* blocked, which is a
//    statement about enforcement, not about whether tonight's request succeeds. And
//    every one of them blocks datacenter-addressed traffic in a supported country
//    too — which is what the trust score beside each exit is for. `supported` here
//    never means "this will work"; it means "this country is on the published list".
// 2. **Absence of a list is not absence of a policy.** Gemini ships `unpublished`
//    because Google's availability pages (`ai.google.dev`, `support.google.com`)
//    could not be read from the network this build was developed on — three timeouts
//    on 2026-10-11 — and inventing a set from secondhand blog roundups would be the
//    one failure mode this file exists to avoid. An unpublished verdict is `unknown`
//    for every address, and the page says so and links the source.
// 3. **`loc` is Cloudflare's geo answer for the address, not the visitor's claim.**
//    It is a country code, and it is also one of the non-country codes below.

// The three states a (service, exit-country) pair can be in. `unknown` is a real
// answer with content: it means this build cannot say, which is not the same
// sentence as "not served", and the copy must never collapse the two.
export const REGION_VERDICT = {
    supported: 'supported',
    unsupported: 'unsupported',
    unknown: 'unknown',
};

// The values `loc` arrives with where no country is meant: Cloudflare's own
// placeholders for "the geo answer is unknown" (`XX`, `ZZ`, `--`, and the empty
// field a blocked request leaves behind), `EU` for the bloc rather than any one
// member, and the single-letter-prefixed annotations (`A1`, `A2`, `A4`, `T1`) that
// describe a property of the address instead of a place. What each one certifies is
// upstream's business; all this file needs is that none of them is a country, so
// whether a *country* is served cannot be answered from it and the verdict stays
// `unknown`.
//
// Every other two-letter value is read as a country — including the ones no
// provider listed, like `XK`. There, `unsupported` is the accurate reading of
// "not on the published list", and it is the list's own claim rather than ours.
export const NON_COUNTRY_LOCS = {
    A1: 'addressAnnotation',
    A2: 'addressAnnotation',
    A4: 'addressAnnotation',
    T1: 'addressAnnotation',
    EU: 'europeUnion',
    XX: 'unknownCountry',
    ZZ: 'unknownCountry',
    '--': 'unknownCountry',
};

// OpenAI, "ChatGPT Supported Countries" — read 2026-10-11. Transcribed by matching
// every published name against the CLDR English region names this runtime already
// renders (see `frontend/data/country-numeric.js` for the code set), with the
// provider's own spellings aliased where they differ; zero names went unmatched, and
// the result is a subset check rather than a hand-typed list.
const CHATGPT_SUPPORTED = [
    'AD', 'AE', 'AF', 'AG', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AW', 'AX',
    'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM',
    'BN', 'BO', 'BR', 'BS', 'BT', 'BW', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH',
    'CI', 'CL', 'CM', 'CO', 'CR', 'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM',
    'DO', 'DZ', 'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FM', 'FO',
    'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GH', 'GL', 'GM', 'GN', 'GP', 'GQ',
    'GR', 'GT', 'GW', 'GY', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IN',
    'IQ', 'IS', 'IT', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN',
    'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT',
    'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML',
    'MM', 'MN', 'MQ', 'MR', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
    'NC', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA', 'PE',
    'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE',
    'RO', 'RS', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ',
    'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SZ', 'TD', 'TF',
    'TG', 'TH', 'TJ', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
    'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VN', 'VU', 'WF', 'WS', 'YE',
    'YT', 'ZA', 'ZM', 'ZW',
];

// Anthropic, "Supported countries and regions" — read 2026-10-11, twice, from two
// vantages, with identical results. The page's own rule is the reason `unsupported`
// is derivable from this list rather than needing its own: "Any country or region
// not listed is unsupported." It also carves four oblasts out of Ukraine and does
// not resolve that to a country code — `UA` is listed, so a Ukrainian exit reads
// `supported` here and the caveat below is what tells the reader that is coarse.
const CLAUDE_SUPPORTED = [
    'AD', 'AE', 'AG', 'AL', 'AM', 'AO', 'AR', 'AT', 'AU', 'AZ', 'BA', 'BB',
    'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BN', 'BO', 'BR', 'BS', 'BT',
    'BW', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CL', 'CM', 'CO', 'CR',
    'CV', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG',
    'ER', 'ES', 'ET', 'FI', 'FJ', 'FM', 'FR', 'GA', 'GB', 'GD', 'GE', 'GH',
    'GM', 'GN', 'GQ', 'GR', 'GT', 'GW', 'GY', 'HN', 'HR', 'HT', 'HU', 'ID',
    'IE', 'IL', 'IN', 'IQ', 'IS', 'IT', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH',
    'KI', 'KM', 'KN', 'KR', 'KW', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR',
    'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MG', 'MH', 'MK',
    'ML', 'MN', 'MR', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NE',
    'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NZ', 'OM', 'PA', 'PE', 'PG', 'PH',
    'PK', 'PL', 'PS', 'PT', 'PW', 'PY', 'QA', 'RO', 'RS', 'RW', 'SA', 'SB',
    'SC', 'SD', 'SE', 'SG', 'SI', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
    'ST', 'SV', 'SZ', 'TD', 'TG', 'TH', 'TJ', 'TL', 'TM', 'TN', 'TO', 'TR',
    'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VN',
    'VU', 'WS', 'ZA', 'ZM', 'ZW',
];

const asSet = (codes) => new Set(codes);

// [id, name, host, regions]
//
// `regions.mode` is `supported` when a published list is held, `unpublished` when
// this build could not read one. `caveat` is the sentence that keeps a precise-
// looking answer from being read as more precise than it is.
export const AI_EGRESS_SERVICES = [
    {
        id: 'chatgpt',
        name: 'ChatGPT',
        host: 'chatgpt.com',
        regions: {
            mode: 'supported',
            codes: asSet(CHATGPT_SUPPORTED),
            source: 'https://help.openai.com/en/articles/7947663-chatgpt-supported-countries',
            asOf: '2026-10-11',
            caveat: 'OpenAI states that access from outside the listed set may get the account blocked or suspended — a policy about the account, not a prediction about this request.',
        },
    },
    {
        id: 'claude',
        name: 'Claude',
        host: 'claude.ai',
        regions: {
            mode: 'supported',
            codes: asSet(CLAUDE_SUPPORTED),
            source: 'https://www.anthropic.com/supported-countries',
            asOf: '2026-10-11',
            caveat: 'The list is exhaustive by the page\'s own rule — anything not named is unsupported. It also excludes four Ukrainian oblasts, which no country code can express.',
        },
    },
    {
        id: 'gemini',
        name: 'Gemini',
        host: 'gemini.google.com',
        regions: {
            mode: 'unpublished',
            codes: null,
            source: 'https://ai.google.dev/gemini-api/docs/available-regions',
            asOf: null,
            caveat: 'Google publishes availability per product (consumer app, AI Studio, Gemini API) and none of those pages could be read from the network this build was developed on. No list is encoded, so no address is called supported or unsupported here.',
        },
    },
];

// The control row. Not a service the visitor came to check: one destination whose
// answer the homepage *already* treats as the visitor's own address — the IP card
// at `frontend/utils/getips/cloudflare-v4.js` asks `1.0.0.1` for nothing but the
// echo, and so does this row. Choosing it over `www.cloudflare.com` is the whole
// reason the comparison means something: a service row that disagrees with this one
// disagrees with 首頁 IP, measured by the same request to the same anycast network,
// so the difference is a routing fact rather than an artefact of two methods.
// `www.cloudflare.com` would answer the same question; it just would not be the
// same measurement.
export const EGRESS_CONTROL = {
    id: 'cloudflare',
    name: 'Cloudflare',
    host: '1.0.0.1',
};

export const AI_EGRESS_ALL = [...AI_EGRESS_SERVICES, EGRESS_CONTROL];

const isAlpha2 = (value) => typeof value === 'string' && /^[A-Z]{2}$/.test(value);

/**
 * Whether this build can say anything about an exit country for one service.
 *
 * @param {object} service  an `AI_EGRESS_SERVICES` entry
 * @param {string|null|undefined} loc  the trace's `loc` value, as it arrived
 * @returns {'supported'|'unsupported'|'unknown'}
 */
export const regionVerdict = (service, loc) => {
    const code = typeof loc === 'string' ? loc.trim().toUpperCase() : '';
    // A non-country annotation (`A1`, `XX`, …) or nothing at all is not a country
    // that failed to make a list. Answering `unsupported` for it would turn
    // Cloudflare's own labelling into an accusation against the address.
    if (!isAlpha2(code) || code in NON_COUNTRY_LOCS) return REGION_VERDICT.unknown;
    if (service?.regions?.mode !== 'supported' || !service.regions.codes) return REGION_VERDICT.unknown;
    return service.regions.codes.has(code) ? REGION_VERDICT.supported : REGION_VERDICT.unsupported;
};

/**
 * What a `loc` value that names no country means, or null when it does name one.
 *
 * @param {string|null|undefined} loc
 * @returns {string|null}  a stable key for the UI to resolve an i18n label from
 */
export const nonCountryLoc = (loc) => {
    const code = typeof loc === 'string' ? loc.trim().toUpperCase() : '';
    return code && code in NON_COUNTRY_LOCS ? NON_COUNTRY_LOCS[code] : null;
};
