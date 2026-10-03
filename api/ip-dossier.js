// GET /api/dossier?ip=<public ip>[&lang=<bcp47>]
//
// One request that answers the whole IP page: the trust assessment, the
// geolocation opinions and how far apart they are, the ASN and its BGP
// neighbourhood, the RIR allocation record, reverse DNS, RPKI, and a
// `slots` map saying which sections have real data behind them and which are
// declared gaps.
//
// Assembled by common/ip-dossier.js; this file only shapes the response and
// answers failures. Presence, syntax and public routability of `?ip` are
// guaranteed by `requirePublicIP` upstream.

import { buildDossier } from '../common/ip-dossier.js';
import logger from '../common/logger.js';

export default async (req, res) => {
    const ipAddress = req.query.ip;
    // The raw tag goes straight through: the geo sources own their own
    // language sets, and an allow-list here would silently downgrade visitors.
    const lang = req.query.lang;

    try {
        const dossier = await buildDossier(ipAddress, { lang });
        res.json(dossier);
    } catch (e) {
        logger.error({ err: e, ip: ipAddress }, 'dossier handler failed');
        res.status(500).json({ error: e.message });
    }
};
