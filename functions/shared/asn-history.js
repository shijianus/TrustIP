// `asn-history?prefix=<cidr>` — RIPEstat routing history for one prefix.
//
// Faithful to api/asn-history.js, including the three statuses it distinguishes:
// 502 when RIPEstat answered badly, 504 when it did not answer in time (a prefix
// with years of history routinely takes 10–20s), 500 when the request itself
// broke. The frontend's timeline can only be honest about "no history" if those
// stay apart. Org-name enrichment is best-effort as it is there: a failed
// as-overview leaves `org: null` and the ASN-keyed timeline still ships.
//
// The prefix arrives validated by `requireValidPrefix`; the frontend quantizes to
// the BGP DFZ floor (/24 v4, /48 v6) first, which is what makes the 30-day edge
// cache worth anything.

import { fetchRoutingHistory, resolveAsnOrgName } from './ripestat.js';
import { MIN_PEERS, rankOrigins, attachOrgNames } from './asn-announcement-history.js';
import { json } from './respond.js';

const THIRTY_DAYS_CACHE = 30 * 24 * 60 * 60;

// `AbortSignal.timeout` rejects with a TimeoutError; an explicit abort surfaces
// as AbortError. Both mean "the upstream did not answer in time".
const isTimeout = (error) => error?.name === 'AbortError' || error?.name === 'TimeoutError';

const resolveOrgName = (asn) => resolveAsnOrgName(asn, {
    onError: (error) => console.warn('[asn-history] as-overview lookup failed', { asn, error: error?.message }),
});

export default async (params) => {
    const prefix = params.get('prefix');
    const family = prefix.includes(':') ? 'v6' : 'v4';

    try {
        const apiRes = await fetchRoutingHistory(prefix, { minPeersSeeing: MIN_PEERS });
        if (!apiRes.ok) {
            console.warn('[asn-history] RIPEstat non-2xx', { prefix, status: apiRes.status });
            return json({ error: 'Upstream error' }, { status: 502, cacheSeconds: THIRTY_DAYS_CACHE });
        }
        const payload = await apiRes.json();
        const history = rankOrigins(payload?.data?.by_origin, family);

        await attachOrgNames(history, resolveOrgName, {
            onError: (error) => console.warn('[asn-history] as-overview batch failed', { prefix, error: error?.message }),
        });

        return json({ prefix, history }, { cacheSeconds: THIRTY_DAYS_CACHE });
    } catch (error) {
        if (isTimeout(error)) {
            console.warn('[asn-history] upstream timeout', { prefix });
            return json({ error: 'Upstream timeout' }, { status: 504, cacheSeconds: THIRTY_DAYS_CACHE });
        }
        console.error('[asn-history] handler failed', { prefix, error: error?.message });
        return json({ error: 'Upstream request failed' }, { status: 500, cacheSeconds: THIRTY_DAYS_CACHE });
    }
};
