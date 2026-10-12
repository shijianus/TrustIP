// RDAP lookups for the WHOIS tool.
//
//   - Domains: fallback. whoiser covers legacy gTLDs well through
//     port 43, but newer ones (.ing / .app / .dev / …) expose RDAP only
//     and return no WHOIS at all — rdapDomain() fills that gap.
//   - IPs: primary. RIR RDAP is plain HTTPS + JSON from the
//     authoritative registry, with none of port-43's referral quirks
//     (rwhois:// endpoints speak a protocol WHOIS clients can't follow).
//
// Public API:
//   rdapDomain(name)  →  { [host]: { __raw, ...rdapJson } }
//     Same outer shape as whoiser.domain() so the handler can splice
//     the result in without any frontend change.
//   rdapIp(ip)        →  { __raw, ...rdapJson }
//     Flat, like whoiser.ip() — the frontend only reads `__raw`.
//   rdapAsn(asn)      →  { registered, name }
//     The AS object's allocation date and holder name, for the IP dossier's
//     ASN card. Nothing in a BGP dataset says when a number was allocated.
//   rdapAsnRecord(asn) →  { [host]: { __raw, ...rdapJson } }
//     The whole registry object for an autonomous system, keyed like a domain
//     lookup — what `whois?q=AS15169` answers with.
//
// A 404 from any registry arrives as `RdapNotFound`, because "no such object" is
// an answer the page can show, not a failure it should report as an outage.
//
// Bootstrap (IANA's TLD / address-space → RDAP endpoint maps) is cached
// in-memory for 24h per file. Upstream calls go through `fetchUpstream`
// so they inherit the project's timeout convention.

import { fetchUpstream } from './fetch-with-timeout.js';
import { isIPv6 } from './valid-ip.js';
import { ipToBigInt, parseCidr, prefixContains } from './ip-math.js';
import logger from './logger.js';

// The registry answered "there is no such object". That is data, not an outage:
// the WHOIS page renders it as *no record*, and a caller that lumps it with a 500
// tells the visitor the lookup broke instead of the name being unregistered —
// which is the single most common reason anyone queries a WHOIS endpoint.
export class RdapNotFound extends Error {}

const BOOTSTRAP_BASE = 'https://data.iana.org/rdap/';
const CACHE_TTL_MS   = 24 * 60 * 60 * 1000;
const bootstrapCache = new Map(); // file → { data, expiresAt }

const loadBootstrap = async (file) => {
    const cached = bootstrapCache.get(file);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }
    const res = await fetchUpstream(BOOTSTRAP_BASE + file);
    if (!res.ok) {
        logger.error({ file, status: res.status }, 'RDAP bootstrap failed');
        throw new Error(`RDAP bootstrap failed: ${res.status}`);
    }
    const data = await res.json();
    bootstrapCache.set(file, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
};

function findEndpoint(services, tld) {
    const needle = tld.toLowerCase();
    for (const [tlds, urls] of services) {
        if (tlds.some(t => t.toLowerCase() === needle)) return urls[0];
    }
    return null;
}

const trimSlash = (u) => u.replace(/\/$/, '');

export async function rdapDomain(domain, { timeoutMs = 5000 } = {}) {
    const bootstrap = await loadBootstrap('dns.json');
    const tld = domain.split('.').pop();
    const base = findEndpoint(bootstrap.services, tld);
    if (!base) {
        throw new Error(`No RDAP endpoint for .${tld}`);
    }

    const host = new URL(base).hostname;
    const url  = `${trimSlash(base)}/domain/${encodeURIComponent(domain)}`;
    const res  = await fetchUpstream(url, { timeoutMs });
    if (res.status === 404) {
        throw new RdapNotFound(`Domain not found: ${domain}`);
    }
    if (!res.ok) {
        logger.error({ domain, status: res.status }, 'RDAP query failed');
        throw new Error(`RDAP query failed: ${res.status}`);
    }
    const data = await res.json();

    return { [host]: { ...data, __raw: formatDomain(data) } };
}

// -- IP lookup -------------------------------------------------------------

// Longest-prefix match of `ip` against an IANA ipv4/ipv6 bootstrap
// `services` array (entries: [[cidr, …], [url, …]]). Exported for tests.
export const findIpEndpoint = (services, ip) => {
    const v6 = isIPv6(ip);
    const ipBig = ipToBigInt(ip);
    if (ipBig === null) return null;

    let best = null;
    let bestLen = -1;
    for (const [cidrs, urls] of services) {
        for (const cidr of cidrs) {
            const block = parseCidr(cidr);
            if (!block || (block.family === 6) !== v6) continue;
            if (block.prefix <= bestLen
                || !prefixContains(block.network, block.prefix, block.family, ipBig)) continue;
            bestLen = block.prefix;
            best = urls.find((u) => u.startsWith('https://')) || urls[0];
        }
    }
    return best;
};

export const rdapIp = async (ip, { timeoutMs = 5000 } = {}) => {
    const bootstrap = await loadBootstrap(isIPv6(ip) ? 'ipv6.json' : 'ipv4.json');
    const base = findIpEndpoint(bootstrap.services, ip);
    if (!base) {
        throw new Error(`No RDAP endpoint for ${ip}`);
    }

    // Literal IP, not encodeURIComponent: colons are legal in a URL path,
    // the guard layer already ensures a well-formed IP, and some RIR
    // delegates (e.g. IDNIC behind APNIC's redirect) reject %3A with a 400.
    const url = `${trimSlash(base)}/ip/${ip}`;
    const res = await fetchUpstream(url, { timeoutMs });
    if (res.status === 404) {
        throw new RdapNotFound(`IP not found: ${ip}`);
    }
    if (!res.ok) {
        logger.error({ ip, status: res.status }, 'RDAP IP query failed');
        throw new Error(`RDAP IP query failed: ${res.status}`);
    }
    const data = await res.json();

    return { ...data, __raw: formatIpNetwork(data) };
};

// -- Autonomous system number --------------------------------------------

// IANA's `asn.json` maps inclusive `lo-hi` ranges (a lone number is both
// bounds) to the RIR that answers for them. Exported for tests.
export const findAsnEndpoint = (services, asn) => {
    const num = Number(asn);
    if (!Number.isFinite(num)) return null;
    for (const [ranges, urls] of services) {
        for (const range of ranges || []) {
            const [lo, hi] = String(range).split('-').map(Number);
            if (!Number.isFinite(lo)) continue;
            if (num >= lo && num <= (Number.isFinite(hi) ? hi : lo)) {
                return urls.find((u) => u.startsWith('https://')) || urls[0];
            }
        }
    }
    return null;
};

// The two facts an AS's own registry object carries that no BGP dataset does:
// when it was allocated, and what its holder calls it. `registration` is the
// allocation event; a missing one means the RIR never wrote it, which is
// reported as null rather than guessed from the handle.
export const rdapAsn = async (asn, { timeoutMs = 5000 } = {}) => {
    const bootstrap = await loadBootstrap('asn.json');
    const base = findAsnEndpoint(bootstrap.services, asn);
    if (!base) throw new Error(`No RDAP endpoint for AS${asn}`);

    const res = await fetchUpstream(`${trimSlash(base)}/autnum/${Number(asn)}`, { timeoutMs });
    if (res.status === 404) throw new RdapNotFound(`AS${asn} not found at ${base}`);
    if (!res.ok) {
        logger.error({ asn, status: res.status }, 'RDAP ASN query failed');
        throw new Error(`RDAP ASN query failed: ${res.status}`);
    }
    const data = await res.json();
    const registered = (data.events || [])
        .find((e) => e.eventAction === 'registration')?.eventDate || null;

    return { registered, name: data.name || null };
};

// -- The full autonomous system record ----------------------------------

// `rdapAsn()` above answers two questions for the dossier's ASN card. This
// answers the page: the whole registry object, formatted into the same `__raw`
// text block an IP or domain lookup produces, so Whois.vue renders an AS without
// needing a third shape.
//
// What the RIRs agree on, verified against all five: `objectClassName: autnum`,
// `handle` carrying the `AS` prefix (`"AS15169"`, not the bare number), `name`,
// `startAutnum`/`endAutnum`, `status`, `events`, `entities`. What they do not:
// APNIC and LACNIC add `country`, ARIN omits it; `type` is absent everywhere
// except RIPE's older objects. So every line below is conditional, and a field a
// registry did not write is a line that does not appear — never `N/A`, which a
// reader cannot tell apart from a registry that answered "none".
export const formatAsn = (data) => {
    const lines = [];
    // Field names mirror what ARIN's port-43 autnum output uses, so an AS block
    // reads the same as the IP and domain blocks beside it. The number is taken
    // from the range when there is one; the handle is printed as the registry
    // spells it (`AS15169`), which is why the two lines are not one.
    const number = data.startAutnum ?? Number(String(data.handle || '').replace(/^AS/i, ''));
    if (Number.isFinite(number) && number > 0) lines.push(`ASNumber: ${number}`);
    if (data.handle) lines.push(`ASHandle: ${data.handle}`);
    if (data.startAutnum != null && data.endAutnum != null && data.endAutnum !== data.startAutnum) {
        lines.push(`ASRange: ${data.startAutnum} - ${data.endAutnum}`);
    }

    if (data.name)    lines.push(`ASName: ${data.name}`);
    if (data.type)    lines.push(`Type: ${data.type}`);
    if (data.country) lines.push(`Country: ${data.country}`);

    const ev = {};
    for (const e of data.events || []) ev[e.eventAction] = e.eventDate;
    if (ev.registration)    lines.push(`Created: ${ev.registration}`);
    if (ev['last changed']) lines.push(`Updated: ${ev['last changed']}`);

    if (data.status?.length) {
        lines.push('Status:');
        for (const s of data.status) lines.push(`  ${s}`);
    }

    lines.push(...formatEntitySections(
        data.entities,
        ['registrant', 'administrative', 'technical', 'abuse', 'noc', 'peering coordinator'],
    ));

    for (const remark of data.remarks || []) {
        lines.push('');
        lines.push(`${remark.title || 'Remarks'}:`);
        for (const d of remark.description || []) lines.push(`  ${d}`);
    }

    if (data.port43) lines.push('', `Ref: ${data.port43}`);
    return lines.join('\n');
};

export const rdapAsnRecord = async (asn, { timeoutMs = 5000 } = {}) => {
    const bootstrap = await loadBootstrap('asn.json');
    const base = findAsnEndpoint(bootstrap.services, asn);
    if (!base) throw new Error(`No RDAP endpoint for AS${asn}`);

    const res = await fetchUpstream(`${trimSlash(base)}/autnum/${Number(asn)}`, { timeoutMs });
    // A 404 is the registry answering "no such allocation", which is data the page
    // can show, not an outage. RIPE is the exception worth naming: it answers 404
    // too, but returns 400 for a number it does not hold at all — a bad path or a
    // bad argument — and both belong in the same "nothing to report" bucket from a
    // reader's point of view. Anything else stays a failure.
    if (res.status === 404 || res.status === 400) throw new RdapNotFound(`AS${asn} not found`);
    if (!res.ok) {
        logger.error({ asn, status: res.status }, 'RDAP ASN record query failed');
        throw new Error(`RDAP ASN query failed: ${res.status}`);
    }
    const data = await res.json();
    const host = new URL(base).hostname;
    return { [host]: { ...data, __raw: formatAsn(data) } };
};

// -- Format RDAP JSON into a WHOIS-like text block ------------------------

function extractVcard(entity) {
    const props = entity?.vcardArray?.[1] || [];
    const out = {};
    for (const [name, , , value] of props) {
        if (name === 'version') continue;
        if (!out[name]) out[name] = [];
        out[name].push(value);
    }
    return out;
}

function formatEntity(entity, indent) {
    const lines = [];
    const pad = ' '.repeat(indent);
    if (entity.handle) lines.push(`${pad}Handle: ${entity.handle}`);
    const v = extractVcard(entity);
    if (v.fn)    lines.push(`${pad}Name: ${v.fn[0]}`);
    if (v.org)   lines.push(`${pad}Org: ${Array.isArray(v.org[0]) ? v.org[0].join(' ') : v.org[0]}`);
    if (v.email) lines.push(`${pad}Email: ${v.email.join(', ')}`);
    if (v.tel)   lines.push(`${pad}Phone: ${v.tel.join(', ')}`);
    if (v.adr) {
        const addr = v.adr[0];
        if (Array.isArray(addr)) {
            const s = addr.filter(Boolean).join(', ');
            if (s) lines.push(`${pad}Address: ${s}`);
        }
    }
    return lines;
}

// Group entities by role and render one section per entity, `order`
// first, leftover roles after. RDAP nests contacts inside their parent
// entity (e.g. abuse/tech inside an ARIN org) — the walk flattens those
// so nested contacts still surface.
const formatEntitySections = (entities, order) => {
    const byRole = new Map();
    const collect = (list) => {
        for (const e of list || []) {
            for (const role of (e.roles?.length ? e.roles : ['unknown'])) {
                if (!byRole.has(role)) byRole.set(role, []);
                byRole.get(role).push(e);
            }
            collect(e.entities);
        }
    };
    collect(entities);

    const lines = [];
    const seen = new Set();
    for (const role of order) {
        for (const e of byRole.get(role) || []) {
            seen.add(e);
            lines.push('');
            lines.push(`${role[0].toUpperCase()}${role.slice(1)}:`);
            lines.push(...formatEntity(e, 2));
        }
    }
    for (const [role, es] of byRole) {
        if (order.includes(role)) continue;
        for (const e of es) {
            if (seen.has(e)) continue;
            lines.push('');
            lines.push(`${role}:`);
            lines.push(...formatEntity(e, 2));
        }
    }
    return lines;
};

// WHOIS-like text block for an RDAP IP-network object, field names
// mirroring what RIR port-43 output calls them. Exported for tests.
export const formatIpNetwork = (data) => {
    const lines = [];
    lines.push(`NetRange: ${data.startAddress || 'N/A'} - ${data.endAddress || 'N/A'}`);

    const cidrs = (data.cidr0_cidrs || [])
        .map((c) => `${c.v4prefix || c.v6prefix}/${c.length}`)
        .filter((c) => !c.startsWith('undefined'));
    if (cidrs.length) lines.push(`CIDR: ${cidrs.join(', ')}`);

    if (data.name)         lines.push(`NetName: ${data.name}`);
    if (data.handle)       lines.push(`Handle: ${data.handle}`);
    if (data.parentHandle) lines.push(`Parent: ${data.parentHandle}`);
    if (data.type)         lines.push(`NetType: ${data.type}`);
    if (data.country)      lines.push(`Country: ${data.country}`);

    const ev = {};
    for (const e of data.events || []) ev[e.eventAction] = e.eventDate;
    if (ev.registration)    lines.push(`Created: ${ev.registration}`);
    if (ev['last changed']) lines.push(`Updated: ${ev['last changed']}`);

    if (data.status?.length) {
        lines.push('Status:');
        for (const s of data.status) lines.push(`  ${s}`);
    }

    lines.push(...formatEntitySections(
        data.entities,
        ['registrant', 'administrative', 'technical', 'abuse', 'noc', 'routing'],
    ));

    for (const remark of data.remarks || []) {
        lines.push('');
        lines.push(`${remark.title || 'Remarks'}:`);
        for (const d of remark.description || []) lines.push(`  ${d}`);
    }

    return lines.join('\n');
};

function formatDomain(data) {
    const lines = [];
    lines.push(`Domain Name: ${data.ldhName || 'N/A'}`);
    if (data.unicodeName && data.unicodeName !== data.ldhName) {
        lines.push(`Unicode Name: ${data.unicodeName}`);
    }
    if (data.handle) lines.push(`Registry Domain ID: ${data.handle}`);

    const ev = {};
    for (const e of data.events || []) ev[e.eventAction] = e.eventDate;
    if (ev.registration)                    lines.push(`Created: ${ev.registration}`);
    if (ev['last changed'])                 lines.push(`Updated: ${ev['last changed']}`);
    if (ev.expiration)                      lines.push(`Expires: ${ev.expiration}`);
    if (ev['last update of RDAP database']) lines.push(`RDAP Last Refresh: ${ev['last update of RDAP database']}`);

    if (data.status?.length) {
        lines.push('Status:');
        for (const s of data.status) lines.push(`  ${s}`);
    }

    lines.push(...formatEntitySections(
        data.entities,
        ['registrar', 'registrant', 'administrative', 'technical', 'abuse', 'reseller'],
    ));

    if (data.nameservers?.length) {
        lines.push('');
        lines.push('Name Servers:');
        for (const ns of data.nameservers) lines.push(`  ${ns.ldhName || 'N/A'}`);
    }
    if (data.secureDNS) {
        lines.push('');
        lines.push(`DNSSEC: ${data.secureDNS.delegationSigned ? 'signed' : 'unsigned'}`);
    }
    return lines.join('\n');
}
