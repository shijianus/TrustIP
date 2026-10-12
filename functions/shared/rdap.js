// RDAP lookups behind the `whois` route.
//
// The Express original reaches the same data two ways: the `whoiser` package over
// raw TCP port 43, and common/rdap.js over HTTPS with IANA's bootstrap files to
// find the authoritative server. This runtime has neither TCP nor a filesystem,
// so RDAP is the only transport and rdap.org is the bootstrap — it 302s to the
// registry that answers for the name or the block, and `fetch` follows that, so
// the final URL still names the real provider (which the frontend renders as the
// accordion's provider label).
//
// The public API keeps the shapes the SPA already consumes:
//   rdapDomain(name) → { [host]: { __raw, ...rdapJson } }   (keyed like whoiser.domain())
//   rdapIp(ip)       → { __raw, ...rdapJson }               (flat, like whoiser.ip())
// The `__raw` text is formatted from the RDAP JSON with the same field names port-43
// WHOIS uses, because Whois.vue renders that block verbatim.

import { fetchUpstream } from './fetch-upstream.js';

const RDAP_BASE = 'https://rdap.org';
// One logical lookup pays two round trips — rdap.org's redirect and then the
// registry's own answer — and ARIN measured past a single-hop 8s budget from here.
const LOOKUP_TIMEOUT_MS = 12000;

export class RdapNotFound extends Error {}

const lookup = async (kind, value) => {
    const response = await fetchUpstream(`${RDAP_BASE}/${kind}/${value}`, {
        timeoutMs: LOOKUP_TIMEOUT_MS,
        headers: { Accept: 'application/rdap+json, application/json' },
    });
    if (response.status === 404) throw new RdapNotFound(`${kind} not found: ${value}`);
    if (!response.ok) throw new Error(`RDAP query failed: ${response.status}`);

    const data = await response.json();
    // After the redirect chain this is the registry that actually answered —
    // rdap.verisign.com, rdap.arin.net, and so on.
    const host = new URL(response.url).hostname;
    return { host, data };
};

export const rdapDomain = async (domain) => {
    const { host, data } = await lookup('domain', encodeURIComponent(domain));
    return { [host]: { ...data, __raw: formatDomain(data) } };
};

export const rdapIp = async (ip) => {
    // Literal IP, not percent-encoded: colons are legal in a URL path, the guard
    // already proved the address is well-formed, and %3A makes some delegates 400.
    const { data } = await lookup('ip', ip);
    return { ...data, __raw: formatIpNetwork(data) };
};

// -- Format RDAP JSON into a WHOIS-like text block ------------------------

const extractVcard = (entity) => {
    const props = entity?.vcardArray?.[1] || [];
    const out = {};
    for (const [name, , , value] of props) {
        if (name === 'version') continue;
        if (!out[name]) out[name] = [];
        out[name].push(value);
    }
    return out;
};

const formatEntity = (entity, indent) => {
    const lines = [];
    const pad = ' '.repeat(indent);
    if (entity.handle) lines.push(`${pad}Handle: ${entity.handle}`);
    const v = extractVcard(entity);
    if (v.fn) lines.push(`${pad}Name: ${v.fn[0]}`);
    if (v.org) lines.push(`${pad}Org: ${Array.isArray(v.org[0]) ? v.org[0].join(' ') : v.org[0]}`);
    if (v.email) lines.push(`${pad}Email: ${v.email.join(', ')}`);
    if (v.tel) lines.push(`${pad}Phone: ${v.tel.join(', ')}`);
    if (v.adr) {
        const addr = v.adr[0];
        if (Array.isArray(addr)) {
            const s = addr.filter(Boolean).join(', ');
            if (s) lines.push(`${pad}Address: ${s}`);
        }
    }
    return lines;
};

// Group entities by role and render one section per entity, `order` first,
// leftover roles after. RDAP nests contacts inside their parent entity (e.g.
// abuse/tech inside an ARIN org) — the walk flattens those so nested contacts
// still surface.
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

// WHOIS-like text block for an RDAP IP-network object, field names mirroring what
// RIR port-43 output calls them.
export const formatIpNetwork = (data) => {
    const lines = [];
    lines.push(`NetRange: ${data.startAddress || 'N/A'} - ${data.endAddress || 'N/A'}`);

    const cidrs = (data.cidr0_cidrs || [])
        .map((c) => `${c.v4prefix || c.v6prefix}/${c.length}`)
        .filter((c) => !c.startsWith('undefined'));
    if (cidrs.length) lines.push(`CIDR: ${cidrs.join(', ')}`);

    if (data.name) lines.push(`NetName: ${data.name}`);
    if (data.handle) lines.push(`Handle: ${data.handle}`);
    if (data.parentHandle) lines.push(`Parent: ${data.parentHandle}`);
    if (data.type) lines.push(`NetType: ${data.type}`);
    if (data.country) lines.push(`Country: ${data.country}`);

    const ev = {};
    for (const e of data.events || []) ev[e.eventAction] = e.eventDate;
    if (ev.registration) lines.push(`Created: ${ev.registration}`);
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

export const formatDomain = (data) => {
    const lines = [];
    lines.push(`Domain Name: ${data.ldhName || 'N/A'}`);
    if (data.unicodeName && data.unicodeName !== data.ldhName) {
        lines.push(`Unicode Name: ${data.unicodeName}`);
    }
    if (data.handle) lines.push(`Registry Domain ID: ${data.handle}`);

    const ev = {};
    for (const e of data.events || []) ev[e.eventAction] = e.eventDate;
    if (ev.registration) lines.push(`Created: ${ev.registration}`);
    if (ev['last changed']) lines.push(`Updated: ${ev['last changed']}`);
    if (ev.expiration) lines.push(`Expires: ${ev.expiration}`);
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
};

// The whole registry object for an autonomous system number — what
// `whois?q=AS15169` answers with, keyed like a domain lookup so the page has one
// shape to render. Field names mirror ARIN's port-43 autnum output, so an AS block
// reads like the IP and domain blocks beside it.
//
// The five RIRs agree on `objectClassName`, `handle` (spelled `AS15169`, not the
// bare number), `name`, `startAutnum`/`endAutnum`, `status`, `events` and
// `entities`. They do not agree on `country` — APNIC and LACNIC write it, ARIN does
// not — so every line below is conditional. A field the registry did not write is a
// line that does not appear, never `N/A`, which a reader cannot tell apart from an
// answer of "none".
export const formatAsn = (data) => {
    const lines = [];
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

export const rdapAsnRecord = async (asn) => {
    const { host, data } = await lookup('autnum', asn);
    return { [host]: { ...data, __raw: formatAsn(data) } };
};
