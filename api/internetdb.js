// GET /api/internetdb?ip=<public ip>
//
// What Shodan's scan archive has observed about one address: the ports it saw
// listening, the products behind them, the hostnames reverse-mapped to the address,
// its tags and the CVEs it was found vulnerable to. Key-free upstream, so this works
// on a blank `.env`.
//
// Three states are reported apart, because they are three different facts and a
// consumer that cannot tell them apart will over-read one of them:
//   `record`     — the archive looked, and here is what it saw;
//   `no-record`  — nobody has looked at this address (the upstream's own 404, which
//                  is an answer, not a failure);
//   500          — the request did not complete.
//
// Nothing here is a statement about the present: the archive is a *history* of
// observations, and an address that answers on 22 today may not have when Shodan
// looked. `seenAt` is therefore absent — the upstream does not publish one, and a
// timestamp we invented would be read as freshness it does not have. That is also
// why the edge TTL is short: this route is the one trust fact a visitor can act on.
//
// Presence, syntax and public routability of `?ip` are guaranteed upstream by
// `requirePublicIP`, so a reserved or malformed address never reaches here — the
// archive answers both the same way, and that way is not "clean".

import { askInternetdb, INTERNETDB_SOURCE } from '../common/providers/internetdb.js';
import logger from '../common/logger.js';

const INTERNETDB_SCHEMA = 'internetdb/v1';

// The fields the archive publishes, and no others. Its `raw` payload stays inside
// the adapter for the same reason the RIR registrant fields stay out of
// `/api/trustscore`: a port list has no use for a hostname's owner.
const FIELDS = ['ports', 'tags', 'vulns', 'hostnames', 'cpes'];

export default async (req, res) => {
    const ipAddress = req.query.ip;

    try {
        const answer = await askInternetdb(ipAddress);
        if (answer.status === 'error') {
            logger.warn({ ip: ipAddress, reason: answer.reason }, 'internetdb: the archive did not answer');
            // `status` first: `res.status()` only sets the code, and the object
            // this handler returns from `.json()` is what a caller can assert on —
            // so a 500 that left the body with no status line would be a state the
            // route cannot describe.
            res.status(500).json({ status: 'failed', error: answer.reason, source: INTERNETDB_SOURCE });
            return;
        }
        res.json({
            ip: ipAddress,
            source: INTERNETDB_SOURCE,
            generatedAt: new Date().toISOString(),
            schema: INTERNETDB_SCHEMA,
            status: answer.found ? 'record' : 'no-record',
            ...(answer.found
                ? Object.fromEntries(FIELDS.map((field) => [field, answer[field]]))
                : {}),
        });
    } catch (e) {
        logger.error({ err: e, ip: ipAddress }, 'internetdb handler failed');
        res.status(500).json({ error: 'Upstream request failed' });
    }
};
