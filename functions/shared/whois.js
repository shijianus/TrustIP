// `whois?q=<domain|ip>` — the registry record for one name or one address.
//
// Input validation is the Express handler's own, not the shared guard: this route
// takes a single `q` that is either an IP or a domain, and api/get-whois.js keeps
// a stricter local domain pattern (no leading-underscore service names) because a
// WHOIS record for `_dmarc.example.com` does not exist.
//
// Transport differs: the original prefers port-43 WHOIS via the `whoiser` package
// and falls back to RDAP. There is no TCP here, so RDAP is the only source — see
// shared/rdap.js for the shapes, which are unchanged.

import { isValidIP, isUsablePublicIP } from './valid-ip.js';
import { rdapDomain, rdapIp, RdapNotFound } from './rdap.js';
import { json } from './respond.js';

const isValidDomain = (domain) => /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i.test(domain);

export default async (params) => {
    const query = params.get('q');
    if (!query || typeof query !== 'string') {
        return json({ error: 'No address provided' }, { status: 400 });
    }
    if (!isValidIP(query) && !isValidDomain(query)) {
        return json({ error: 'Invalid IP or address' }, { status: 400 });
    }
    // Only publicly routable space has a registry record; visitors paste their LAN
    // address routinely and asking a registry about it earns a guaranteed failure.
    if (isValidIP(query) && !isUsablePublicIP(query)) {
        return json({ error: 'Not a public IP address' }, { status: 400 });
    }

    const cacheSeconds = 24 * 60 * 60;

    try {
        return json(isValidIP(query) ? await rdapIp(query) : await rdapDomain(query), { cacheSeconds });
    } catch (error) {
        // The upstream answering "there is no such record" is data the UI can show
        // as *no data*, not an outage — Whois.vue renders `noData` for any 4xx and a
        // fetch error for a 5xx, and an unregistered domain is the common case.
        if (error instanceof RdapNotFound) {
            return json({ error: error.message }, { status: 404, cacheSeconds });
        }
        console.error('[whois] lookup failed', { query, error: error?.message });
        return json({ error: 'Upstream request failed' }, { status: 500, cacheSeconds });
    }
};
