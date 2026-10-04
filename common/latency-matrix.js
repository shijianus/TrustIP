// The plan behind the "global latency" grid: which probe locations measure an
// address, and exactly what the visitor's browser has to send to Globalping to
// fill the cells.
//
// Nothing in this file measures anything, and that is the whole design.
// Globalping's probes are third-party machines, and the integration this app
// already runs (api/globalping-probes.js for the inventory,
// frontend/composables/use-globalping-measurement.js for the tools) has the
// browser create the measurement and poll it. Probing from this server instead
// would report the latency of *this datacenter's* uplink as if it were the
// world's, and would turn a page view into outbound ICMP from a host that has
// no business sending it.
//
// So every cell this returns is `pending`, and the page breathes on each one
// until its own probe answers — which is exactly the state the reader sees
// before the numbers land. The response is a work order, not a result.
//
// No access token is involved: Globalping's public API answers unauthenticated
// measurement creation (POST /v1/measurements → 202) and unauthenticated
// polling (GET /v1/measurements/{id} → 200), with a per-source-IP quota of 250
// probes an hour (`x-ratelimit-limit: 250`). Since the browser makes both
// calls, the quota is spent from the visitor's own address, never from this
// deployment's — one page view costs 8 of the visitor's 250.

import { isIPv6 } from './valid-ip.js';

const GLOBALPING_API_BASE = 'https://api.globalping.io/v1';

// One cell per measurement type the grid can render, in the order the page
// lays them out. `location` is the stable identity the client keys its cells
// by; `city` / `country` are what Globalping's result rows echo back, so the
// client joins measurement results to cells on that pair (it also matches the
// `measurement.body.locations` order, index for index).
//
// The eight cities are fixed, not random, and each is the deepest probe pool
// in its region: at the time of writing Globalping lists 158 datacenter probes
// online in Frankfurt, 142 in Singapore, 126 in Los Angeles and Tokyo, 51 in
// New York, 46 in Sao Paulo, 54 in Sydney and 20 in Johannesburg. Fixed cities
// keep the grid's layout identical between visits, which is what lets the
// dossier that embeds this block be edge-cached for a day — a plan drawn from
// `limit: 8` random probes worldwide would reshuffle the row order on every
// request and make the cached bytes meaningless.
//
// Two consequences are documented rather than fixed:
//   * Globalping has no node-id selection. `limit: 1` inside a fixed city picks
//     one probe at random from that city's pool, so the *machine* varies between
//     runs while the *location* never does; the layout is stable, the millisecond
//     figure is not. Filtering to `datacenter-network` is what keeps the variance
//     small — eyeball/residential probes measure last-mile access links, which
//     differ wildly street to street, and they churn offline.
//   * One city per region. Europe gets Frankfurt only, because Amsterdam,
//     Frankfurt and London measure the same latency neighbourhood to within a
//     few milliseconds and eight cells cannot be spent on the IXs of one
//     continent. Africa gets Johannesburg, the deepest pool there; if its
//     datacenter probes ever all go offline, Globalping simply returns fewer
//     results (documented behaviour of `limit`) and that one cell stays unfilled
//     instead of failing the whole measurement.
export const LATENCY_PROBE_LOCATIONS = [
    { location: 'New York, US', city: 'New York', country: 'US' },
    { location: 'Los Angeles, US', city: 'Los Angeles', country: 'US' },
    { location: 'Frankfurt, DE', city: 'Frankfurt', country: 'DE' },
    { location: 'Johannesburg, ZA', city: 'Johannesburg', country: 'ZA' },
    { location: 'Sao Paulo, BR', city: 'Sao Paulo', country: 'BR' },
    { location: 'Singapore, SG', city: 'Singapore', country: 'SG' },
    { location: 'Tokyo, JP', city: 'Tokyo', country: 'JP' },
    { location: 'Sydney, AU', city: 'Sydney', country: 'AU' },
].map(({ location, city, country }) => ({
    location,
    city,
    country,
    // The location filter Globalping accepts for this cell. `country` is part
    // of it on purpose: city names are matched loosely, and an unqualified
    // `city` can silently resolve to an unrelated town (a bare "Atlantis"
    // matches a probe in South Africa).
    probe: { city, country, limit: 1, tags: ['datacenter-network'] },
}));

// Only the minimum round trip is rendered, so it needs enough packets to be a
// minimum of something. Six is the spec's own example and still finishes well
// inside the page's patience; the API's ceiling is 16 and its default 3.
const PING_PACKETS = 6;

// How the client should read the measurement back. The grid has four states:
// a probe that answered (`ok`), one that sent and got nothing (`timeout`), one
// that could not run at all (`failed`), and a cell waiting for its probe
// (`pending`) — which is the only state this endpoint can ever emit.
const CELL_STATES = ['ok', 'timeout', 'failed', 'pending'];

// Address families Globalping can measure a target of. Both, today: an IPv6
// target is served, and every probe in the fixed plan is a datacenter node,
// which carries an IPv6 uplink in practice (verified: all eight cells answered
// 2001:4860:4860::8888 with real round trips). Globalping's spec still labels
// IPv6 targets experimental, so the flag travels with the answer and the page
// can caveat it — but the honest alternative, marking v6 `unsupported`, would
// hide a measurement that works.
//
// A family that stops being answerable gets `unsupported: true` with an empty
// grid. That is the point of the flag: the reader sees "we do not measure this"
// rather than eight failed cells that read as "this address is unreachable from
// the entire world".
const FAMILY_SUPPORT = {
    4: { supported: true, experimental: false },
    6: { supported: true, experimental: true },
};

export const addressFamilySupport = (ip) => {
    const version = isIPv6(ip) ? 6 : 4;
    const support = FAMILY_SUPPORT[version] || { supported: false, experimental: false };
    return { version, ...support };
};

/**
 * The latency grid for one address, as it stands the moment the page asks:
 * a row per probe location, every one of them waiting.
 *
 * @param {string} ip  validated, publicly routable
 * @returns {object}  `{ ip, version, addressFamily, unsupported, results,
 *                      measurement, source, note }`
 */
export const buildLatencyMatrix = (ip) => {
    const family = addressFamilySupport(ip);
    const results = LATENCY_PROBE_LOCATIONS.map(({ location, city, country }) => ({
        location,
        city,
        country,
        ms: null,
        state: 'pending',
    }));

    if (!family.supported) {
        return {
            ip,
            version: family.version,
            addressFamily: family,
            unsupported: true,
            results: [],
            source: 'Globalping',
        };
    }

    return {
        ip,
        version: family.version,
        addressFamily: family,
        unsupported: false,
        results,
        measurement: {
            method: 'POST',
            url: `${GLOBALPING_API_BASE}/measurements`,
            resultUrl: `${GLOBALPING_API_BASE}/measurements/{id}`,
            // What to send, in the order the cells above are laid out. The
            // browser posts it with no Authorization header and polls
            // `resultUrl` until `status` leaves 'in-progress'.
            body: {
                locations: LATENCY_PROBE_LOCATIONS.map((row) => row.probe),
                target: ip,
                type: 'ping',
                measurementOptions: { packets: PING_PACKETS },
            },
            expect: { probes: results.length, states: CELL_STATES },
            poll: { intervalMs: 1500, maxRetries: 8 },
        },
        source: 'Globalping',
        note: family.experimental
            ? 'Round trip time from eight fixed probe cities, measured by Globalping probes running in this browser. IPv6 targets are still labelled experimental by Globalping.'
            : 'Round trip time from eight fixed probe cities, measured by Globalping probes running in this browser.',
    };
};
