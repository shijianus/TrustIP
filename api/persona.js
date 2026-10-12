// POST /api/persona/evaluate — Persona Check.
//
// Thin proxy to the main IPCheck.ing API, which owns the evaluation this
// deployment deliberately does not carry. One observation in, one graded
// report out; per-visitor, never cached. An allow-list of the caller's headers
// travels upstream (the evaluator needs the request context); results come back as
// ids and enums, and the front end renders its own four-language copy.

import { fetchUpstream } from '../common/fetch-with-timeout.js';
import logger from '../common/logger.js';
import { upstreamHeaders } from '../common/upstream-headers.js';

export default async (req, res) => {
    // Defensive method gate (the route is POST-only) — covered by tests.
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = process.env.IPCHECKING_API_KEY;
    const apiEndpoint = process.env.IPCHECKING_API_ENDPOINT;
    if (!apiKey || !apiEndpoint) {
        return res.status(500).json({ error: 'API key is missing' });
    }

    if (!req.body?.persona?.country) {
        return res.status(400).json({ error: 'No persona provided' });
    }

    const url = new URL(`${apiEndpoint}/persona/evaluate`);
    url.searchParams.set('key', apiKey);

    try {
        const apiResponse = await fetchUpstream(url, {
            method: 'POST',
            headers: upstreamHeaders(req, { 'Content-Type': 'application/json' }),
            body: JSON.stringify(req.body),
        });

        // Status and payload pass through verbatim so the frontend can tell a
        // rejected request from an unreachable evaluator and degrade to its
        // error line rather than a blank report.
        const data = await apiResponse.json().catch(() => ({}));
        return res.status(apiResponse.status).json(data);
    } catch (error) {
        logger.error({ err: error }, 'persona evaluate upstream fetch failed');
        return res.status(502).json({ error: 'Upstream fetch failed' });
    }
};
