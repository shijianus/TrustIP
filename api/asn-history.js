// /api/asn-history — RIPEstat routing-history for a CIDR prefix (the
// frontend quantizes the user's IP to /24 v4 or /48 v6 first, so all IPs
// in the same prefix collapse to one CF edge cache entry). Org names per
// ASN come from RIPEstat as-overview, fetched in parallel, best-effort.
//
// What counts as an announcement, how a row is summarised and how visibility
// is normalized all live in common/asn-announcement-history.js, which the IP
// dossier reads too; this file only answers for the route — its status codes
// and its `{ prefix, history }` shape.

import {
    fetchRoutingHistory,
    resolveAsnOrgName,
} from '../common/ripestat.js';
import {
    MIN_PEERS,
    rankOrigins,
    attachOrgNames,
} from '../common/asn-announcement-history.js';
import logger from '../common/logger.js';

// Two-tier resolver lives in common/ripestat.js. Here we pass a warn hook so
// a failed as-overview fallback stays observable (asn-connectivity omits it
// and stays silent — keep that difference).
const resolveOrgName = (asn) =>
    resolveAsnOrgName(asn, {
        onError: (error) => logger.warn({ err: error, asn }, 'as-overview lookup failed'),
    });

export default async (req, res) => {
    // Prefix presence + validity guaranteed by requireValidPrefix middleware.
    const prefix = req.query.prefix;
    const family = prefix.includes(':') ? 'v6' : 'v4';

    try {
        // Push our peer floor down to RIPEstat so it drops sub-threshold rows
        // during the scan — same MIN_PEERS we filter on below, single source.
        const apiRes = await fetchRoutingHistory(prefix, { minPeersSeeing: MIN_PEERS });
        if (!apiRes.ok) {
            logger.warn({ prefix, status: apiRes.status }, 'RIPEstat routing-history non-2xx');
            return res.status(502).json({ error: 'Upstream error' });
        }
        const payload = await apiRes.json();

        // Relative visibility: each row's peers / max peers in this response.
        // Most-propagated row is 100%; sparse ones surface as low percentages.
        const history = rankOrigins(payload?.data?.by_origin, family);

        // Org enrichment is strictly best-effort: anything that goes wrong here
        // leaves rows with org=null, but the ASN-keyed timeline still ships.
        await attachOrgNames(history, resolveOrgName, {
            onError: (error) => logger.warn({ err: error, prefix }, 'as-overview batch failed; returning ASN-only history'),
        });

        res.json({ prefix, history });
    } catch (error) {
        // RIPEstat routing-history can exceed our timeout for prefixes with long
        // history — surface that as 504 so it's distinguishable from real 5xx.
        if (error?.name === 'AbortError') {
            logger.warn({ prefix }, 'asn-history upstream timeout');
            return res.status(504).json({ error: 'Upstream timeout' });
        }
        logger.error({ err: error, prefix }, 'asn-history handler failed');
        res.status(500).json({ error: error.message });
    }
};
