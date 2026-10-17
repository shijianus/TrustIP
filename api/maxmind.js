import { lookupMaxMind } from '../common/maxmind-service.js';
import logger from '../common/logger.js';

// What a failed lookup tells the client: a fixed string per status, never the
// thrown error's own text (a reader or file-system error can carry paths and
// library internals). The full error stays in the server log.
const PUBLIC_ERRORS = {
    503: 'MaxMind database is not ready',
};

// `lookup` is injectable so the error path can be exercised without a broken
// database on disk.
export const createMaxMindHandler = (lookup = lookupMaxMind) => (req, res) => {
    // Presence, validity and public routability guaranteed by the
    // requirePublicIP middleware — a reserved address never reaches here.
    const ip = req.query.ip;

    // The raw tag goes straight in: the service owns the language set and
    // normalizes onto it.
    const lang = req.query.lang;

    try {
        res.json(lookup(ip, lang));
    } catch (e) {
        logger.error({ err: e, ip, lang }, 'maxmind handler failed');
        const status = e?.statusCode === 503 ? 503 : 500;
        res.status(status).json({ error: PUBLIC_ERRORS[status] || 'Internal Server Error' });
    }
};

export default createMaxMindHandler();
