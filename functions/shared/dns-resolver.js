// `dnsresolver` — resolve a hostname against every public resolver this runtime
// can actually reach, in parallel.
//
// api/dns-resolver.js runs two transports: raw UDP DNS through `node:dns`, and
// DoH over HTTPS. A web-standard runtime has no UDP sockets, so only the DoH
// entries survive and the UDP-only providers are dropped from the list rather
// than reported as a fake `N/A` timeout — a row that says "this resolver gave no
// answer" when nobody asked it is a lie the table would then rank.
//
// The rows keep the Express handler's exact shape (`{ hostname, results }` with
// `{ id, provider, country, type, result }` per row), because
// frontend/components/advanced-tools/DnsResolver.vue groups by `country` and puts
// `entry.type === 'doh' ? 'DoH 🔒' : 'DNS'` on the provider label: every row here
// is DoH, and it renders as such.

import { fetchUpstream } from './fetch-upstream.js';
import { json, serverError } from './respond.js';
import { NAME_VALUED_TYPES } from './dns-record-types.js';

const DOH_TIMEOUT_MS = 5000;

// { id, name, country, doh } — `doh` is a prefix ending in '?' or '&'; the
// handler appends `name=<host>&type=<type>` directly.
export const DNS_RESOLVERS = [
    { id: 'google', name: 'Google', country: 'US', doh: 'https://dns.google/resolve?' },
    { id: 'cloudflare', name: 'Cloudflare', country: 'US', doh: 'https://cloudflare-dns.com/dns-query?ct=application/dns-json&' },
    { id: 'dnssb', name: 'DNS.SB', country: 'EU', doh: 'https://doh.dns.sb/dns-query?' },
    { id: 'adguard', name: 'AdGuard', country: 'CY', doh: 'https://dns.adguard.com/resolve?' },
    { id: 'alidns', name: 'AliDNS', country: 'CN', doh: 'https://dns.alidns.com/resolve?' },
];

// Presentation form carries the root dot; a DoH endpoint may or may not send it,
// and one provider's row differing from another's on punctuation alone reads as
// a real disagreement.
export const withRootDot = (name) => (name.endsWith('.') ? name : `${name}.`);

const SOA_RECORD_TYPE = 6;

// A SOA query for a name below the zone apex carries the zone's own SOA in the
// authority section instead, so fall back to it — otherwise any hostname that
// isn't itself a zone reports N/A on every DoH row. Filtered by type because a
// CNAME name puts the chain in Answer and the SOA in Authority, and the CNAME
// target must not render as the SOA result.
export const dohRecords = (data, type) => {
    if (type !== 'SOA') return data.Answer ?? [];
    const answers = (data.Answer ?? []).filter((record) => record.type === SOA_RECORD_TYPE);
    if (answers.length) return answers;
    return (data.Authority ?? []).filter((record) => record.type === SOA_RECORD_TYPE);
};

// One resolver. Never throws: a non-2xx, a timeout or an unparseable answer all
// collapse to 'N/A', the same way the Express transport degrades, so the flat row
// list always has one entry per provider.
export const resolveDoh = async (hostname, type, name, url) => {
    try {
        const response = await fetchUpstream(`${url}name=${hostname}&type=${type}`, {
            timeoutMs: DOH_TIMEOUT_MS,
            headers: { Accept: 'application/dns-json' },
        });
        if (!response.ok) return 'N/A';
        const records = dohRecords(await response.json(), type);
        if (records.length === 0) return 'N/A';
        const addresses = records.map((record) => record.data);
        return NAME_VALUED_TYPES.has(type) ? addresses.map(withRootDot) : addresses;
    } catch {
        return 'N/A';
    }
};

export default async (params) => {
    // Presence, shape, lowercasing and the record-type whitelist are guaranteed by
    // the guards in handler.ts.
    const hostname = params.get('hostname');
    const type = params.get('type');

    try {
        const results = await Promise.all(DNS_RESOLVERS.map((server) =>
            resolveDoh(hostname, type, server.name, server.doh).then((result) => ({
                id: server.id,
                provider: server.name,
                country: server.country,
                type: 'doh',
                result,
            }))));
        return json({ hostname, results });
    } catch (error) {
        // The error text stays in the platform log; the client gets a fixed one.
        console.error('[dnsresolver] handler failed', { hostname, type, error: error?.message });
        return serverError('Internal Server Error');
    }
};
