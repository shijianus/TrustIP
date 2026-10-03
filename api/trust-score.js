// GET /api/trustscore?ip=<public ip>
//
// TrustMy.IP's own IP trust assessment: gathers public registry evidence about
// one address (reverse DNS, RIR allocation record, AS description, BGP
// announcement shape and RPKI state) and returns a 0–100
// score with the per-signal breakdown that produced it.
//
// Everything is derived from open registries — no API key, no subscription
// feed, and no active probing of the address. `common/trust-signals.js` does
// the asking, `common/trust-score.js` does the arithmetic; this file only
// shapes the response.
//
// Presence, syntax and public routability of `?ip` are guaranteed upstream by
// `requirePublicIP`, so a reserved or malformed address never reaches here.

import { gatherTrustEvidence } from '../common/trust-signals.js';
import { assessTrust } from '../common/trust-score.js';
import logger from '../common/logger.js';

// Only the fields the UI actually renders. Abuse contacts and other registrant
// personal data are deliberately not passed through — a trust verdict does not
// need them, and echoing them would turn our endpoint into a people-search
// proxy over public registries.
const RIR_FIELDS = ['netType', 'status', 'descr', 'netName', 'cidr', 'regDate', 'country', 'originAs'];

const pick = (source, keys) => {
    if (!source) return null;
    const out = {};
    for (const key of keys) {
        if (source[key]) out[key] = source[key];
    }
    return Object.keys(out).length ? out : null;
};

export default async (req, res) => {
    const ipAddress = req.query.ip;

    try {
        const evidence = await gatherTrustEvidence(ipAddress);
        const result = assessTrust(evidence);

        res.json({
            ip: ipAddress,
            ...result,
            evidence: {
                geo: evidence.geo?.asn || evidence.geo?.country_code
                    ? {
                        country_code: evidence.geo.country_code ?? null,
                        region: evidence.geo.region ?? null,
                        city: evidence.geo.city ?? null,
                        asn: evidence.geo.asn ?? null,
                        org: evidence.geo.org ?? null,
                        isp: evidence.geo.isp ?? null,
                    }
                    : null,
                asOrg: evidence.asOrg || null,
                asName: evidence.asName || null,
                rdns: evidence.rdns || null,
                rir: pick(evidence.rir, RIR_FIELDS),
                announce: evidence.announce || null,
                rpki: evidence.rpki || null,
            },
            sources_failed: evidence.failed,
        });
    } catch (e) {
        logger.error({ err: e, ip: ipAddress }, 'trustscore handler failed');
        res.status(500).json({ error: e.message });
    }
};
