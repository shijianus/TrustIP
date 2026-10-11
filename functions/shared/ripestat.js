// RIPEstat client, as common/ripestat.js is, minus the part this runtime cannot do.
//
// `sourceapp` is fixed to `trustip`: an edge function reads no environment, and
// RIPEstat's fair-use guidance is one request per second per source app, so the
// identifier has to be a constant rather than a deployment's choice.
//
// The original's `resolveAsnOrgName` is two-tier — a local CAIDA as2org snapshot
// first, RIPEstat as-overview only on a miss. There is no filesystem here, so
// every org-name request goes to RIPEstat. That is strictly more upstream load
// than the Node deployment makes, bounded by the per-ASN dedupe in
// `attachOrgNames` and the 30-day edge cache on the route that calls it.

import { fetchUpstream } from './fetch-upstream.js';

const BASE_URL = 'https://stat.ripe.net/data';
const SOURCE_APP = 'trustip';

const fetchRipestat = (endpoint, resource, { timeoutMs = 8000, params = {} } = {}) => {
    const search = new URLSearchParams({ resource, sourceapp: SOURCE_APP, ...params });
    return fetchUpstream(`${BASE_URL}/${endpoint}/data.json?${search}`, { timeoutMs });
};

/** as-overview: AS metadata including `holder` (org name w/ handle prefix). */
export const fetchAsOverview = (asn, { timeoutMs = 3000 } = {}) =>
    fetchRipestat('as-overview', `AS${asn}`, { timeoutMs });

/**
 * routing-history: historical AS announcements for a prefix or IP. Slow
 * analytical endpoint — scans years of BGP data, regularly 10–20s for a prefix
 * with long history.
 *
 * `minPeersSeeing` pushes the caller's peer floor down to RIPEstat: rows seen by
 * fewer RIS peers are route noise the caller discards anyway, so dropping them
 * during the scan trims the response without changing the result.
 */
export const fetchRoutingHistory = (resource, { timeoutMs = 25000, minPeersSeeing } = {}) => {
    const params = minPeersSeeing != null ? { min_peers_seeing: minPeersSeeing } : {};
    return fetchRipestat('routing-history', resource, { timeoutMs, params });
};

/**
 * Strip RIPEstat's "<HANDLE> - " prefix from a `holder` field so the UI sees just
 * the readable company name.
 */
export const extractOrgFromHolder = (holder) => {
    if (!holder || typeof holder !== 'string') return null;
    const dash = holder.indexOf(' - ');
    return dash > 0 ? holder.slice(dash + 3).trim() : holder.trim();
};

/**
 * AS org name from RIPEstat as-overview. Best-effort — any failure yields null
 * so the caller can fall back to ASN-only display. `onError` is the caller's
 * observability hook.
 */
export const resolveAsnOrgName = async (asn, { onError } = {}) => {
    try {
        const res = await fetchAsOverview(asn);
        if (!res.ok) return null;
        return extractOrgFromHolder((await res.json())?.data?.holder);
    } catch (error) {
        if (onError) onError(error, asn);
        return null;
    }
};
