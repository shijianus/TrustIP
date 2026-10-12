// GET /api/dnsbl?ip=<public ip>
//
// What the public blocklists say about one address, zone by zone. This is the
// only route in the API that asks third parties to accuse someone, so the
// response carries the machinery of that accusation rather than a bare
// yes/no: which recursor the answers came through, what each zone returned
// including the raw 127.0.0.x code, and how many zones were able to speak at
// all. A stored "listed" that cannot name its source is not evidence.
//
// `common/dnsbl.js` does the asking and the interception canary that keeps a
// fabricating resolver from reporting every address as listed; this file only
// shapes the response. Presence, syntax and public routability of `?ip` are
// guaranteed upstream by `requirePublicIP`.

import { checkBlocklists } from '../common/dnsbl.js';
import logger from '../common/logger.js';

const DNSBL_SCHEMA = 'dnsbl/v1';

export default async (req, res) => {
    const ipAddress = req.query.ip;

    try {
        const pass = await checkBlocklists(ipAddress);
        // How old the answer is decides what it is worth: a listing is delisted
        // within days, so a stored row must be able to tell a fresh "clean" from
        // one the 30-minute cache has been repeating.
        res.json({ generatedAt: new Date().toISOString(), schema: DNSBL_SCHEMA, ...pass });
    } catch (e) {
        logger.error({ err: e, ip: ipAddress }, 'dnsbl handler failed');
        res.status(500).json({ error: 'Upstream request failed' });
    }
};
