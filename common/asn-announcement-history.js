// Prefix → ASN announcement history, read from RIPEstat `routing-history`.
//
// Two consumers, one set of accept rules:
//
//   * `/api/asn-history` (api/asn-history.js) answers the whole list — every
//     origin that announced the prefix with a visible share of RIS peers, plus
//     the relative visibility figure its UI draws as a bar.
//   * The IP dossier embeds a short list under `asnHistory` so the page needs
//     no second request; `buildAsnHistoryBlock` is that presentation.
//
// What counts as an announcement is decided here, once, so the two can never
// drift apart on the meaning of "this AS held this prefix". Only the shape of
// the answer differs at the callers.

import { fetchRoutingHistory } from './ripestat.js';
import { lookupAsOrgName } from './as-org-db.js';
import logger from './logger.js';

const prefixLength = (prefix) => parseInt((prefix || '').split('/')[1], 10);

// BGP-meaningful prefix floor per family. Shorter prefixes are leaks /
// default routes that happen to cover the IP but don't attribute it.
export const MIN_PREFIX = { v4: 8, v6: 19 };

// Below this peer count an announcement is route noise / brief misconfig.
export const MIN_PEERS = 30;

export const HISTORY_SOURCE = 'RIPEstat routing-history';

// One row per announcing AS, over a grid that shows a handful at a time.
//
// The cap is set against what the upstream actually returns for a DFZ-floor
// prefix: a well-behaved block has a single announcer (8.8.8.0/24 → 1 row,
// 142.250.4.0/24 → 1 row), and only a historically mis-announced block reaches
// double digits (1.1.1.0/24, which 29 separate ASNs have announced as /24 at
// some point since 2000). So eight rows never truncates an honest answer and
// only ever trims the leak case — where the newest half a dozen tell the story
// and the rest is noise a reader cannot act on. `truncated` says which it was.
export const HISTORY_ENTRY_CAP = 8;

// Measured from this deployment: ~7.5–8.2s for a /24 or /48 on a warm RIPEstat
// cache, longer for a block with years of history. The route's own 25s budget
// suits a page that waits on nothing else; the dossier answers twelve sections
// in one request and its page allows 30s, so history gets the shorter leash —
// an absent history row beats a dossier that never lands.
export const HISTORY_TIMEOUT_MS = 12000;

/**
 * Collapse one RIPEstat `by_origin` entry into a single row: the span during
 * which the origin announced any accepted prefix of the queried block, and the
 * peak number of RIS peers that saw it.
 */
export const summarizeOrigin = (entry, minLen) => {
    const acceptedPrefixes = (entry.prefixes || []).filter((p) => prefixLength(p.prefix) >= minLen);
    if (acceptedPrefixes.length === 0) return null;

    const allTimes = [];
    for (const p of acceptedPrefixes) {
        for (const t of p.timelines || []) allTimes.push(t);
    }
    if (allTimes.length === 0) return null;

    let firstSeen = allTimes[0].starttime;
    let lastSeen = allTimes[0].endtime;
    let maxPeers = 0;
    for (const t of allTimes) {
        if (t.starttime < firstSeen) firstSeen = t.starttime;
        if (t.endtime > lastSeen) lastSeen = t.endtime;
        if ((t.full_peers_seeing || 0) > maxPeers) maxPeers = t.full_peers_seeing;
    }

    if (maxPeers < MIN_PEERS) return null;

    return {
        asn: String(entry.origin),
        org: null,
        firstSeen,
        lastSeen,
        peers: Math.round(maxPeers),
        prefixes: acceptedPrefixes.map((p) => p.prefix),
    };
};

/**
 * Rows for an upstream payload: accepted, ordered newest first, and carrying
 * `peersPct` — each row's peers normalized by the response's max, so the UI
 * shows relative visibility instead of an absolute count a reader might mistake
 * for "the whole internet". Max-of-response is a fair proxy for "active RIS
 * peers" since well-propagated announcements typically saturate the panel.
 */
export const rankOrigins = (byOrigin, family) => {
    const minLen = MIN_PREFIX[family];
    const rows = (Array.isArray(byOrigin) ? byOrigin : [])
        .map((entry) => summarizeOrigin(entry, minLen))
        .filter(Boolean)
        .sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    const peersMax = rows.reduce((m, r) => Math.max(m, r.peers), 0);
    for (const row of rows) {
        row.peersPct = peersMax > 0 ? Math.round((row.peers / peersMax) * 100) : 0;
    }
    return rows;
};

/**
 * Fill `row.org` from a caller-supplied resolver. Strictly best-effort:
 * anything that goes wrong leaves rows with org=null and the ASN-keyed
 * timeline still shipping. `onError` is the caller's observability hook.
 */
export const attachOrgNames = async (rows, resolveOrg, { onError } = {}) => {
    try {
        const uniqueAsns = [...new Set(rows.map((row) => row.asn))];
        const orgPairs = await Promise.all(uniqueAsns.map(async (asn) => [asn, await resolveOrg(asn)]));
        const orgByAsn = Object.fromEntries(orgPairs);
        for (const row of rows) {
            row.org = orgByAsn[row.asn] || null;
        }
    } catch (error) {
        if (onError) onError(error);
    }
    return rows;
};

// The most specific announcement a row carries — how closely that AS described
// the block being asked about.
const announcementPrecision = (row) => {
    const lengths = (row.prefixes || []).map(prefixLength).filter(Number.isFinite);
    return lengths.length ? Math.max(...lengths) : -1;
};

const mostSpecific = (prefixes) => (prefixes || [])
    .slice()
    .sort((a, b) => prefixLength(b) - prefixLength(a))[0] || null;

/**
 * The dossier's history block: `{ prefix, entries, source }`, or
 * `{ prefix, entries: [], failed: true }`.
 *
 * Ordered by specificity first and recency second, unlike the route's newest
 * first. The section answers "who announced *this* prefix", and an origin that
 * announced a broad aggregate covering it (Level3 announcing 8.0.0.0/8 is a
 * real, permanent fact about BGP) is making a different claim — left unsorted
 * by recency it would sit at the top of the list and misattribute the block to
 * a transit provider. Aggregates are kept rather than dropped because that is
 * all RIPEstat reports for most /24s: Hetzner announces 65.21.0.0/16 and never
 * the /24 inside it, so a filter on the queried length would empty the section
 * for nearly every address on the internet.
 *
 * Two further differences from the route, both because this is one of twelve
 * sections in a single request: org names come from the local CAIDA snapshot
 * only, so no per-ASN RIPEstat round trip is added, and every upstream failure
 * path is swallowed. A dead source must not sink the dossier.
 */
export const buildAsnHistoryBlock = async (prefix, {
    timeoutMs = HISTORY_TIMEOUT_MS,
    cap = HISTORY_ENTRY_CAP,
} = {}) => {
    const failed = { prefix, entries: [], failed: true, source: HISTORY_SOURCE };
    if (!prefix) return failed;

    try {
        // Push our peer floor down to RIPEstat so it drops sub-threshold rows
        // during the scan — same MIN_PEERS we filter on below, single source.
        const res = await fetchRoutingHistory(prefix, { timeoutMs, minPeersSeeing: MIN_PEERS });
        if (!res.ok) {
            logger.warn({ prefix, status: res.status }, 'dossier: RIPEstat routing-history non-2xx');
            return failed;
        }
        const payload = await res.json();
        const rows = rankOrigins(payload?.data?.by_origin, prefix.includes(':') ? 'v6' : 'v4')
            .sort((a, b) => announcementPrecision(b) - announcementPrecision(a)
                || (b.lastSeen || '').localeCompare(a.lastSeen || ''));
        const entries = rows.slice(0, cap).map((row) => ({
            asn: row.asn,
            org: lookupAsOrgName(row.asn),
            // The narrowest announcement that origin made of this space — what
            // the row's date actually describes.
            prefix: mostSpecific(row.prefixes),
            first: row.firstSeen,
            last: row.lastSeen,
        }));

        return { prefix, entries, source: HISTORY_SOURCE, truncated: rows.length > entries.length };
    } catch (error) {
        // routing-history is RIPEstat's slowest analytical endpoint; a timeout
        // here is the normal outcome for a block with years of history, so it
        // is a warning about a missing section, not a failed request.
        logger.warn({ err: error, prefix }, 'dossier: asn history unavailable');
        return failed;
    }
};
