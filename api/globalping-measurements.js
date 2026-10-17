// POST /api/globalping/measurements — creates a Globalping measurement with
// this server's GLOBALPING_TOKEN (Bearer), for deployments that hold one. The
// browser otherwise creates measurements anonymously, on the visitor's own
// per-IP quota; with a token the quota is the token's, shared by every visitor
// of this deployment — which is why it is opt-in, and why the route keeps its
// own per-IP limiter (backend-server.js).
//
// Only the create goes through here: polling GET /v1/measurements/:id needs no
// token and stays browser → api.globalping.io. The body is re-built from the
// fields the tools send (type, target, limit, locations, measurementOptions,
// inProgressUpdates), so this is not an open relay for arbitrary payloads. A
// 429 is passed through with Retry-After / X-RateLimit-Reset so the client's
// shared back-off reads the same numbers it would have read upstream.
//
// No token: 500 { error: 'API key is missing' } before any request leaves, and
// /api/configs.globalpingProxy is false so the client never calls this route.

import { fetchUpstream } from '../common/fetch-with-timeout.js';
import logger from '../common/logger.js';

export const GLOBALPING_CREATE_URL = 'https://api.globalping.io/v1/measurements';
const TYPES = new Set(['ping', 'mtr', 'http', 'traceroute', 'dns']);
const MAX_LIMIT = 50;
const PASSED_HEADERS = ['retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-credits-remaining'];

export const hasGlobalpingToken = () => Boolean(process.env.GLOBALPING_TOKEN);

/**
 * The create body this route forwards, or null when it is not one of ours.
 * Exported for tests.
 */
export const sanitizeMeasurement = (raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!TYPES.has(raw.type)) return null;
    if (typeof raw.target !== 'string' || !raw.target || raw.target.length > 255 || /\s/.test(raw.target)) return null;
    const body = { type: raw.type, target: raw.target };
    if (raw.limit !== undefined) {
        if (!Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > MAX_LIMIT) return null;
        body.limit = raw.limit;
    }
    if (raw.locations !== undefined) {
        if (!Array.isArray(raw.locations) || raw.locations.length > MAX_LIMIT) return null;
        if (!raw.locations.every((l) => l && typeof l === 'object' && !Array.isArray(l))) return null;
        body.locations = raw.locations;
    }
    if (raw.measurementOptions !== undefined) {
        if (!raw.measurementOptions || typeof raw.measurementOptions !== 'object' || Array.isArray(raw.measurementOptions)) return null;
        body.measurementOptions = raw.measurementOptions;
    }
    if (typeof raw.inProgressUpdates === 'boolean') body.inProgressUpdates = raw.inProgressUpdates;
    return JSON.stringify(body).length > 16 * 1024 ? null : body;
};

export default async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    if (!hasGlobalpingToken()) return res.status(500).json({ error: 'API key is missing' });
    const body = sanitizeMeasurement(req.body);
    if (!body) return res.status(400).json({ error: 'Invalid measurement request' });
    try {
        const upstream = await fetchUpstream(GLOBALPING_CREATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GLOBALPING_TOKEN}` },
            body: JSON.stringify(body),
            timeoutMs: 10000,
        });
        for (const name of PASSED_HEADERS) {
            const value = upstream.headers.get(name);
            if (value !== null) res.setHeader(name, value);
        }
        res.setHeader('Cache-Control', 'no-store');
        const text = await upstream.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch {
            json = { error: 'Upstream answered without JSON' };
        }
        return res.status(upstream.status).json(json);
    } catch (err) {
        logger.error({ err }, 'globalping-measurements: create failed');
        return res.status(502).json({ error: 'Upstream request failed' });
    }
};
