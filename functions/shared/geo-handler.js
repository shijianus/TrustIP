// The geo-source shell from common/geo-handler.js, for this runtime.
//
// Same contract as the Express factory: read an already-validated `?ip`, build a
// source-specific URL, fetch it, normalize the upstream JSON into the canonical
// frontend shape, and answer 500 `{ error }` on anything that went wrong — with
// `buildUrl` inside the try, so a throw there is a JSON 500 rather than an
// unhandled rejection.
//
// What it does NOT do is derive a timezone. Express runs `withTimeZone()` over
// every geo response, resolving the IANA zone from the response's own coordinates
// with the `@photostructure/tz-lookup` package; there is no npm here and no
// zone-geometry table, so `normalize` passes the upstream's own `timezone`
// through when it publishes one and leaves the field out when it does not. A
// zone nobody reported is never invented.

import { fetchUpstream } from './fetch-upstream.js';
import { json } from './respond.js';

export const makeGeoHandler = ({ name, buildUrl, normalize, requiredEnv, cacheSeconds = 0 }) => async (params) => {
    const ipAddress = params.get('ip');

    if (requiredEnv) return json({ error: 'API key is missing' }, { status: 500, cacheSeconds });

    try {
        const built = buildUrl(params);
        const url = typeof built === 'string' ? built : built.url;

        const apiRes = await fetchUpstream(url);
        // Outage / gateway pages come back as HTML — fail on status instead of
        // letting JSON.parse throw on "<html>".
        if (!apiRes.ok) throw new Error(`Upstream responded ${apiRes.status}`);

        return json(normalize(await apiRes.json()), { cacheSeconds });
    } catch (error) {
        console.error(`[${name}] handler failed`, { ip: ipAddress, error: error?.message });
        return json({ error: 'Upstream request failed' }, { status: 500, cacheSeconds });
    }
};

// The upstream's own zone name, or nothing. `''`, `'N/A'` and `-` are not values.
export const passThroughTimeZone = (payload, value) => {
    const zone = typeof value === 'string' ? value.trim() : '';
    return zone && zone !== 'N/A' && zone !== '-' ? { ...payload, timezone: zone } : payload;
};
