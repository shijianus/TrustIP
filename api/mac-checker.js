// /api/macchecker?mac= — MAC Lookup against the local IEEE registries
// (common/oui-db.js). `mac` is a full address or a vendor prefix of 6–12
// hex digits (common/mac-input.js). The answer names the block that covers
// it, its range and the first-octet flags; an address no block covers is
// still a 200 with `found: false`.

import { normalizeMacQuery } from '../common/mac-input.js';
import { lookupMac } from '../common/oui-db.js';

// `lookup` is injectable so tests can run the handler over fixture registries.
export const createMacChecker = (lookup) => async (req, res) => {
    const { mac } = req.query;
    if (!mac) {
        return res.status(400).json({ error: 'No MAC address provided' });
    }
    if (typeof mac !== 'string') {
        // ?mac=a&mac=b arrives as an array (or ?mac[x]=… as an object); answer
        // 400 rather than coercing it — the hardening fix, kept on upstream's
        // local-registry lookup.
        return res.status(400).json({ error: 'Invalid MAC address' });
    }
    const hex = normalizeMacQuery(mac);
    if (!hex) {
        return res.status(400).json({ error: 'Invalid MAC address' });
    }

    // Past the boot window (requireOfflineData) only a failed download leaves this empty.
    const result = lookup(hex);
    if (!result) {
        return res.status(503).json({ error: 'MAC database unavailable' });
    }
    res.json(result);
};

export default createMacChecker(lookupMac);
