// /api/whois — registry record for an IP, a domain or an ASN. IPs and ASNs
// go to RIR RDAP, domains to port-43 WHOIS with an RDAP fallback; every
// path answers with a WHOIS-like `__raw` text block for the Whois tool.

import whoiser from 'whoiser';
import { isValidIP, isUsablePublicIP, parseAsnQuery } from '../common/valid-ip.js';
import { rdapDomain, rdapIp, rdapAsnRecord, RdapNotFound } from '../common/rdap.js';
import logger from '../common/logger.js';

function isValidDomain(domain) {
    const domainPattern = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
    return domainPattern.test(domain);
}

// A whoiser.domain() response is considered usable if at least one of
// its WHOIS-server keys carries a non-empty `__raw` text block. An
// empty object, or one with only metadata but no raw text, means the
// TLD doesn't have a reachable port-43 server (common for newer gTLDs
// like .ing / .app) — that's when we fall back to RDAP.
function domainHasWhoisText(result) {
    if (!result || typeof result !== 'object') return false;
    return Object.values(result).some(
        (v) => v && typeof v === 'object' && typeof v.__raw === 'string' && v.__raw.length > 0,
    );
}

// "There is no such record" reaches this handler two ways: a registry that
// answered 404 (turned into `RdapNotFound`), and a name whose TLD or address has no
// RDAP server at all. Both are the same answer to a reader — nothing to show — and
// neither is a server failure. Before this, an unregistered domain on a newer gTLD
// came back 500, which the page renders as "the lookup broke".
const isNoRecord = (error) => error instanceof RdapNotFound
    || String(error?.message || '').startsWith('No RDAP endpoint for ');

// Port-43 servers answer a refusal or a miss with text, not a status, and whoiser
// hands that text back as if it were a record: `{"whois.nic.io": {…, text:
// ["Malformed request.", …]}}` is a 200 to every layer above it. A reply that
// names no registration (no status, no name server, no registry field) and opens
// with one of these lines is a miss or a refusal, never data to show or cache.
const NO_MATCH_LINE = /^(?:no match\b|no matching record|not found\b|no found\b|no entries found|no data found|no object found|object does not exist|the queried object does not exist|the requested domain was not found\b|domain not found|no such domain|nothing found|status:\s*(?:free|available)\b|error:101\b|\S+ is free$|.*\breturned 0 objects)/i;
const REGISTRY_ERROR_LINE = /^(?:malformed (?:request|query)|invalid (?:request|query|domain name|input)|wrong query|error\b|(?:query )?rate limit|quota exceeded|too many (?:requests|queries|connections)|(?:your )?connection limit exceeded|access denied|requests? limit|limit exceeded|service unavailable|temporarily unavailable)/i;
// Field names that only a real registration carries — IP (RIR) and domain
// (registry / registrar) alike; anything else whoiser parses out of a refusal
// is boilerplate (`>>> Last update of WHOIS database`, notices, terms).
const RECORD_FIELD = /domain|registr|creat|expir|updated date|netrange|inet6?num|cidr|^range$|^route|netname|^asn$|organi[sz]ation|orgname|nic-hdl/i;

// DENIC, .it and EURid answer a free name with a parsed record of its own —
// `Domain: x.de` / `Status: free` — which whoiser turns into a `Domain Name` and
// a `Domain Status` of ['free'] / ['AVAILABLE']. A status list that only says the
// name is available, with no name server, registrar or date beside it, is a miss.
const AVAILABLE_STATUS = /^(?:free|available|not registered|no object found)$/i;
const REGISTRATION_ONLY_FIELD = /name ?server|registrar|creat|expir|updated|changed/i;
const statusSaysUnregistered = (entry) => {
    const statuses = entry['Domain Status'];
    if (!Array.isArray(statuses) || statuses.length === 0) return false;
    if (!statuses.every((status) => AVAILABLE_STATUS.test(String(status).trim()))) return false;
    return !Object.entries(entry).some(([key, value]) => REGISTRATION_ONLY_FIELD.test(key)
        && (Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== ''));
};

const namesARegistration = (entry) => Object.entries(entry).some(([key, value]) => {
    if (key === 'text' || key === '__raw' || key.startsWith('>>>')) return false;
    if (Array.isArray(value)) return value.length > 0;
    return RECORD_FIELD.test(key) && typeof value === 'string' && value.trim() !== '';
});

// Classifies a whoiser reply as 'no-match', 'error', or null when it is a record
// or a shape this does not recognise (shown as before). whoiser.ip() returns the
// RIR's reply itself; whoiser.domain() keys replies by server, and the first is
// the registry it asked before following any referral. RIR replies wrap the
// verdict in `%` comments (`%ERROR:101: no entries found`), so the markers go
// before the patterns run over the opening lines.
const hasRaw = (v) => v && typeof v === 'object' && typeof v.__raw === 'string' && v.__raw.length > 0;

export const registryReplyFault = (result) => {
    if (!result || typeof result !== 'object') return null;
    const entry = hasRaw(result) ? result : Object.values(result).find(hasRaw);
    if (!entry) return null;
    if (statusSaysUnregistered(entry)) return 'no-match';
    if (namesARegistration(entry)) return null;
    const lines = entry.__raw.split('\n')
        .map((line) => line.trim().replace(/^[%#]+\s*/, ''))
        .filter((line) => line && !line.startsWith('>>>'))
        .slice(0, 8);
    if (lines.some((line) => NO_MATCH_LINE.test(line))) return 'no-match';
    if (lines.some((line) => REGISTRY_ERROR_LINE.test(line))) return 'error';
    return null;
};

// A failed or refused upstream is the registry's problem, not this server's:
// 502, and the reason stays in the log — the page renders any 5xx as "the lookup
// broke" and never shows the text. Error responses go out `no-store` (the
// global /api default; cacheable() only stamps a 2xx).
const upstreamFailed = (res) => res.status(502).json({ error: 'Upstream request failed' });

export default async (req, res) => {
    const query = req.query.q;
    // typeof check also rejects the array form (?q=a&q=b) express produces.
    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'No address provided' });
    }
    // A number is valid as neither an IP nor a domain, so the three forms cannot
    // collide and the order the branches run in does not have to be defended.
    const asn = parseAsnQuery(query);
    if (!isValidIP(query) && !isValidDomain(query) && asn === null) {
        return res.status(400).json({ error: 'Invalid IP or address' });
    }
    // Only publicly routable addresses have a registry record — asking RDAP
    // or WHOIS about anything else burns an upstream call to earn a
    // guaranteed failure. Visitors paste their LAN address routinely.
    if (isValidIP(query) && !isUsablePublicIP(query)) {
        return res.status(400).json({ error: 'Not a public IP address' });
    }

    // IP path: RDAP first — authoritative-RIR HTTPS + JSON, immune to the
    // port-43 referral mess (rwhois://host:port referrals point at a
    // protocol WHOIS clients can't speak). whoiser stays as fallback,
    // pinned to one hop (`follow: 1`) so it never chases a referral.
    if (isValidIP(query)) {
        try {
            return res.json(await rdapIp(query));
        } catch (e) {
            logger.warn({ err: e, query }, 'whois: RDAP IP lookup failed, trying WHOIS');
        }
        try {
            const ipinfo = await whoiser.ip(query, { timeout: 5000, follow: 1, raw: true });
            const fault = registryReplyFault(ipinfo);
            if (fault === 'no-match') return res.status(404).json({ error: `IP not found: ${query}` });
            if (fault === 'error') {
                logger.warn({ query }, 'whois: registry refused the IP query');
                return upstreamFailed(res);
            }
            return res.json(ipinfo);
        } catch (e) {
            logger.error({ err: e, query }, 'Failed to get IP info');
            return upstreamFailed(res);
        }
    }

    // AS path: the registry object for an autonomous system number. Port-43 WHOIS
    // has no such query — the `whois.cymru.com` DNS trick is a different service and
    // `whoiser` does not speak it — so IANA's asn.json bootstrap is the only channel
    // here, on this server and on the edge function alike.
    if (asn !== null) {
        try {
            return res.json(await rdapAsnRecord(asn));
        } catch (e) {
            if (isNoRecord(e)) return res.status(404).json({ error: `AS${asn} not found` });
            logger.error({ err: e, query }, 'Failed to get AS record');
            return upstreamFailed(res);
        }
    }

    // Domain path: whoiser first (rich port-43 data for legacy gTLDs),
    // fall back to RDAP only when whoiser returned nothing useful.
    let domaininfo = null;
    try {
        domaininfo = await whoiser.domain(query, {
            ignorePrivacy: false,
            timeout: 5000,
            follow: 2,
            raw: true,
        });
    } catch {
        // Swallow — we'll attempt RDAP next; only bubble up if that
        // fails too.
    }

    // The registry's own "no match" is authoritative; its refusal is not an
    // answer at all, so RDAP gets the question — and if RDAP cannot answer either,
    // the result is an upstream failure rather than "no record".
    const fault = domainHasWhoisText(domaininfo) ? registryReplyFault(domaininfo) : null;
    if (fault === 'no-match') {
        return res.status(404).json({ error: `Domain not found: ${query}` });
    }
    if (domainHasWhoisText(domaininfo) && fault === null) {
        return res.json(domaininfo);
    }
    if (fault === 'error') logger.warn({ query }, 'whois: registry refused the domain query, trying RDAP');

    try {
        const rdap = await rdapDomain(query);
        return res.json(rdap);
    } catch (e) {
        if (e instanceof RdapNotFound || (fault === null && isNoRecord(e))) {
            logger.warn({ query }, 'whois: no registry record for this name');
            return res.status(404).json({ error: `Domain not found: ${query}` });
        }
        logger.error({ err: e, query }, 'Failed to get RDAP info');
        return upstreamFailed(res);
    }
};
