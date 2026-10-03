// Factory for IP-geolocation source handlers.
//
// Every geo source (ipinfo.io, ip-api.com, ipapi.is, ip2location.io, ip.sb)
// shares an identical Express shell: read the (already-validated) ?ip,
// build a source-specific URL, fetch it through fetchUpstream, normalize the
// upstream JSON into the canonical response shape, and respond — with a
// uniform try/catch that logs the error and returns a 500.
//
// makeGeoHandler captures that shell. Each source supplies only:
//   - name        : short id used in the error log message
//   - buildUrl    : (req) => string URL  OR  { url, logContext } when the
//                   handler wants extra fields (e.g. lang) on the error log
//   - normalize   : (json) => canonical response object
//   - requiredEnv : optional name of an env var the upstream cannot be asked
//                   without. Unset → the handler answers the same
//                   "API key is missing" 500 the inline handlers use, before
//                   any URL is built or request leaves the process. Sources
//                   whose key is optional (ipinfo.io, ip.sb, ip-api.com) omit
//                   it and keep working unauthenticated.
//
// buildUrl runs inside the try block: whatever it throws — a malformed URL, a
// key-selection failure — is logged and answered as a JSON 500 exactly like an
// upstream failure, never as an unhandled rejection reaching Express.

import { fetchUpstream } from './fetch-with-timeout.js';
import logger from './logger.js';

export function makeGeoHandler({ name, buildUrl, normalize, requiredEnv }) {
    return async (req, res) => {
        // Presence, validity and public routability guaranteed by the
        // requirePublicIP middleware — a reserved address never reaches here.
        const ipAddress = req.query.ip;

        if (requiredEnv && !process.env[requiredEnv]) {
            return res.status(500).json({ error: 'API key is missing' });
        }

        let logContext = {};
        try {
            const built = buildUrl(req);
            const url = typeof built === 'string' ? built : built.url;
            logContext = typeof built === 'string' ? {} : (built.logContext || {});

            const apiRes = await fetchUpstream(url);
            // Outage / gateway pages come back as HTML — fail on status
            // instead of letting JSON.parse throw on "<html>".
            if (!apiRes.ok) {
                throw new Error(`Upstream responded ${apiRes.status}`);
            }
            const json = await apiRes.json();
            res.json(normalize(json));
        } catch (e) {
            logger.error({ err: e, ip: ipAddress, ...logContext }, `${name} handler failed`);
            res.status(500).json({ error: e.message });
        }
    };
}
