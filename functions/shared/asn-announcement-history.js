// Prefix → ASN announcement history, read from RIPEstat `routing-history`.
//
// Serves the edge `asn-history` route: every origin that announced the prefix
// with a visible share of RIS peers, plus the relative visibility figure the UI
// draws as a bar.
//
// What counts as an announcement is decided here, once, so the meaning of "this
// AS held this prefix" has one definition.

import { fetchRoutingHistory } from './ripestat.js';

const prefixLength = (prefix) => parseInt((prefix || '').split('/')[1], 10);

// BGP-meaningful prefix floor per family. Shorter prefixes are leaks /
// default routes that happen to cover the IP but don't attribute it.
export const MIN_PREFIX = { v4: 8, v6: 19 };

// Below this peer count an announcement is route noise / brief misconfig.
export const MIN_PEERS = 30;

export const HISTORY_SOURCE = 'RIPEstat routing-history';

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
