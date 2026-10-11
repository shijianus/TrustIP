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
//
// `?profile=audit` returns the same verdict with the per-signal weights removed,
// for a consumer that stores conclusions rather than reproducing the ladder.
// Both shapes carry `schema` and `weights`, so a stored row says which version
// produced it.

import { gatherTrustEvidence } from '../common/trust-signals.js';
import { assessTrust, auditView } from '../common/trust-score.js';
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

// `?profile=audit` answers the same question with the arithmetic taken out. A
// programmatic consumer stores the verdict; it has no use for — and must not be
// handed — the weight each signal carries, because that is the recipe for
// getting a high score.
const isAuditProfile = (req) => String(req.query.profile || '').toLowerCase() === 'audit';

export default async (req, res) => {
    const ipAddress = req.query.ip;

    try {
        const evidence = await gatherTrustEvidence(ipAddress);
        const result = assessTrust(evidence);

        res.json({
            ip: ipAddress,
            // When the evidence was assembled, not merely when this response was
            // served. `/api/trustscore` sits behind a 24h edge cache, so a stored
            // row that records only its own write time cannot tell a fresh
            // verdict from one the edge has been repeating for a day — and the
            // blocklist half of it goes stale within hours.
            generatedAt: new Date().toISOString(),
            ...(isAuditProfile(req) ? auditView(result) : result),
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
                blocklists: evidence.blocklists || null,
                // The keyed feed's answer, when it was consulted. Names and
                // contact details from the upstream are never copied out.
                privacy: evidence.privacy || null,
            },
            // One spelling across the trust endpoints: /api/dossier already
            // reports `sourcesFailed`, and a stored row must not have to know
            // which of the two produced it.
            sourcesFailed: evidence.failed,
            // Every keyed vendor this deployment asked, and how each one ended.
            // "four asked, one over quota" is a different fact from "four cleared
            // it", and a consumer storing the verdict needs the roster beside the
            // number. Empty means nothing keyed was enabled — a configuration,
            // not an outage. Vendor payloads are never copied out.
            sources: evidence.privacy?.status ?? [],
        });
    } catch (e) {
        logger.error({ err: e, ip: ipAddress }, 'trustscore handler failed');
        res.status(500).json({ error: e.message });
    }
};
