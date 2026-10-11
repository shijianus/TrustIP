// `internetdb?ip=<public ip>` — what Shodan's scan archive observed about one
// address: ports it saw listening, products behind them, reverse-mapped
// hostnames, tags and CVEs.
//
// Three states are reported apart, because they are three different facts and a
// consumer that cannot tell them apart will over-read one of them:
//   `record`     — the archive looked, and here is what it saw;
//   `no-record`  — nobody has looked (the upstream's own 404: an answer, not a failure);
//   500          — the request did not complete.
//
// Nothing here is a statement about the present: the archive is a *history* of
// observations. That is also why the cache is six hours rather than a day.
//
// Presence, syntax and public routability of `?ip` are guaranteed by the guard,
// because the archive answers a reserved address and a malformed one the same way
// — and that way is not "clean".

import { askInternetdb, INTERNETDB_SOURCE } from './internetdb-provider.js';
import { json } from './respond.js';

const INTERNETDB_SCHEMA = 'internetdb/v1';
const SIX_HOURS_CACHE = 6 * 60 * 60;

// The fields the archive publishes, and no others: a port list has no use for a
// hostname's owner.
const FIELDS = ['ports', 'tags', 'vulns', 'hostnames', 'cpes'];

export default async (params) => {
    const ipAddress = params.get('ip');

    try {
        const answer = await askInternetdb(ipAddress);
        if (answer.status === 'error') {
            console.warn('[internetdb] the archive did not answer', { ip: ipAddress, reason: answer.reason });
            // `status` first: a 500 whose body carries no status line would be a
            // state this route cannot describe.
            return json({ status: 'failed', error: answer.reason, source: INTERNETDB_SOURCE }, { status: 500, cacheSeconds: SIX_HOURS_CACHE });
        }
        return json({
            ip: ipAddress,
            source: INTERNETDB_SOURCE,
            generatedAt: new Date().toISOString(),
            schema: INTERNETDB_SCHEMA,
            status: answer.found ? 'record' : 'no-record',
            ...(answer.found
                ? Object.fromEntries(FIELDS.map((field) => [field, answer[field]]))
                : {}),
        }, { cacheSeconds: SIX_HOURS_CACHE });
    } catch (e) {
        console.error('[internetdb] handler failed', { ip: ipAddress, error: e?.message });
        return json({ error: e?.message || String(e) }, { status: 500, cacheSeconds: SIX_HOURS_CACHE });
    }
};
