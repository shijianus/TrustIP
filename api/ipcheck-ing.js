import { fetchUpstream } from '../common/fetch-with-timeout.js';
import logger from '../common/logger.js';
import { upstreamHeaders } from '../common/upstream-headers.js';
import { normalizeLang } from '../common/lang-param.js';

export default async (req, res) => {
    // Presence, validity and public routability guaranteed by the
    // requirePublicIP middleware — a reserved address never reaches here.
    const ipAddress = req.query.ip;

    const key = process.env.IPCHECKING_API_KEY;
    const apiEndpoint = process.env.IPCHECKING_API_ENDPOINT;

    // Both halves are needed: the endpoint has no default here, so a key
    // without it would reach `new URL()` as "undefined/ipinfo" and throw.
    if (!key || !apiEndpoint) {
        return res.status(500).json({ error: 'API key is missing' });
    }

    // Build request
    // Every value goes through searchParams: `lang` used to be pasted in raw,
    // so `lang=en%26ip%3D10.0.0.1` smuggled a second ip= (or key=) upstream.
    const lang = normalizeLang(req.query.lang);
    const url = new URL(`${apiEndpoint}/ipinfo`);
    url.searchParams.set('key', key);
    url.searchParams.set('ip', ipAddress);
    url.searchParams.set('lang', lang);

    try {
        const apiResponse = await fetchUpstream(url, {
            headers: upstreamHeaders(req),
        });

        if (!apiResponse.ok) {
            throw new Error(`API responded with status: ${apiResponse.status}`);
        }

        const data = await apiResponse.json();
        res.json(data);
    } catch (error) {
        logger.error({ err: error, ip: ipAddress, lang }, 'ipcheck-ing handler failed');
        res.status(500).json({ error: 'Upstream request failed' });
    }
}