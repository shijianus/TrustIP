// Who is this network's primary address, and which sites saw somebody else?
//
// The routing table collects one fact per destination — *this* service reported
// seeing *that* address — and on its own the list is only a pile of addresses. This
// turns the pile into an answer, and the answer has two halves that are routinely
// confused for each other, so they get different names:
//
//   **主 IP / primary** — the address that *is* the visitor. Not the busiest route:
//       a proxy exit that forty sites happened to see is still a rented address,
//       while the one a STUN server reflected back is the machine under the desk.
//       So a leak wins outright, and only when nothing leaked does this fall back to
//       counting — the address the most destinations saw is the one this network
//       actually goes out through. The basis is returned either way, because "which
//       ruler decided" is the difference between a finding and a guess.
//   **其它 / 暴露 IP** — every other address on the record, ranked by *how few*
//       destinations were willing to be reached from it. That direction is the point:
//       an address only a couple of sites saw is a leak of something — a second
//       interface, a fallback route, a rule list with holes — whereas an address most
//       sites saw is simply how this network works. A primary determined by a leak and
//       a default route determined by volume are then two different lines on screen,
//       not one line fighting with itself.
//
// Nothing here measures: the rows have already answered. This is the arithmetic over
// them, which is why it is a pure function with a spec — the homepage and a report
// must read the same answers and reach the same primary address on the same visit.

import { isUsablePublicIP } from './valid-ip.js';

const isV6 = (ip) => String(ip).includes(':');

// An IPv4 first, then by how much of the table saw it, then by the address itself,
// so a tie resolves the same way in every browser.
const rankAddresses = (a, b) => (isV6(a.ip) ? 1 : 0) - (isV6(b.ip) ? 1 : 0)
    || b.seenBy - a.seenBy
    || String(a.ip).localeCompare(String(b.ip));

/**
 * Fold the table's answers into one record per egress address.
 *
 * Only a row that *named* an address counts toward `seenBy`. A row that could only be
 * timed — most national services are not behind Cloudflare and never will be — is
 * evidence about the network, not about an address, and is counted separately as
 * `unattributed` rather than silently dropped.
 *
 * Addresses the visitor's own sources resolved, or a STUN server leaked, appear even
 * with `seenBy = 0`. A forty-row table concluding one exit for a network with two is
 * how this page used to reassure people it had not looked.
 */
export const collectEgress = ({ rows = [], ownExits = [], leaks = [] } = {}) => {
    const byIp = new Map();
    const entry = (ip) => {
        if (!byIp.has(ip)) {
            byIp.set(ip, {
                ip,
                seenBy: 0,
                hosts: [],
                leak: false,
                ownExit: false,
                ms: null,
                country_code: '',
                org: '',
            });
        }
        return byIp.get(ip);
    };

    for (const ip of ownExits) if (isUsablePublicIP(ip)) entry(ip).ownExit = true;

    // A STUN answer is a record of its own: the leak also carries the organisation
    // name, which is how "that is the mobile network, not the proxy" gets said.
    const leakByIp = new Map();
    for (const leaked of leaks) {
        if (!isUsablePublicIP(leaked?.ip)) continue;
        leakByIp.set(leaked.ip, leaked);
        entry(leaked.ip).leak = true;
    }

    for (const row of rows) {
        if (!row?.ip || !isUsablePublicIP(row.ip)) continue;
        const seen = entry(row.ip);
        seen.seenBy += 1;
        seen.hosts.push(row.host);
        if (Number.isFinite(row.ms) && (seen.ms == null || row.ms < seen.ms)) seen.ms = row.ms;
        // The echo's own country is a fact from the edge; keep it only where the
        // leak did not already name this address, so one address keeps one answer.
        if (!seen.country_code && !leakByIp.has(seen.ip) && /^[A-Z]{2}$/.test(row.loc || '')) {
            seen.country_code = row.loc;
        }
    }

    for (const [ip, leaked] of leakByIp) {
        const seen = byIp.get(ip);
        seen.country_code = String(leaked.country_code || '').toUpperCase() || seen.country_code;
        seen.org = leaked.org || seen.org;
    }

    return [...byIp.values()].sort(rankAddresses);
};

/**
 * Decide which address is the primary one and which are the others.
 *
 * `primary.basis` is one of:
 *   `webrtc`  — a STUN server reflected it back. The strongest claim available, and
 *               the only one that survives a proxy: this is the machine, whatever the
 *               traffic says.
 *   `volume`  — nothing leaked, so the address the most destinations saw is taken to
 *               be how this network goes out.
 *   `source`  — nothing leaked and nothing echoed either (every destination refused,
 *               or the plan failed): the visitor's own resolved IPv4 is all there is.
 *
 * `defaultEgress` is the `volume` answer whichever rule won, and `conflict` says
 * whether it names a different address than the primary does. That pair is the
 * Chinese split-tunnel case in two fields: the machine is in the mainland, the road
 * goes overseas, and a page that picked one of the two to display would be lying
 * about the other.
 */
export const classifyEgress = ({ rows = [], ownExits = [], leaks = [], geolocations = {} } = {}) => {
    const entries = collectEgress({ rows, ownExits, leaks });
    if (!entries.length) {
        return {
            primary: null, defaultEgress: null, conflict: false,
            entries, others: [], foreignRouted: [], unattributed: 0, attributed: 0,
        };
    }

    const leaked = entries.filter((e) => e.leak);
    const busiest = [...entries].sort((a, b) => b.seenBy - a.seenBy || rankAddresses(a, b))[0];

    let primary;
    let basis;
    if (leaked.length) {
        // Several leaks is itself a finding, but the primary is still one address:
        // the leaked one the table saw most, because that is the leak the rows below
        // it are about.
        primary = [...leaked].sort((a, b) => b.seenBy - a.seenBy || rankAddresses(a, b))[0];
        basis = 'webrtc';
    } else if (busiest.seenBy > 0) {
        primary = busiest;
        basis = 'volume';
    } else {
        primary = entries.find((e) => e.ownExit) || entries[0];
        basis = 'source';
    }

    // The page's one answer per address: the visitor's own cards win over a later
    // lookup, so this fills gaps and never overwrites what the card already said.
    for (const e of entries) {
        if (!e.country_code) e.country_code = String(geolocations[e.ip]?.country_code || '').toUpperCase();
        if (!e.org) e.org = geolocations[e.ip]?.org || geolocations[e.ip]?.isp || '';
    }

    return {
        primary: { ...primary, basis },
        defaultEgress: busiest.seenBy ? busiest : null,
        conflict: Boolean(busiest.seenBy && busiest.ip !== primary.ip),
        leakedCountries: [...new Set(leaked.map((e) => e.country_code).filter(Boolean))],
        entries,
        // Fewest destinations first: the address two sites saw is the one worth a
        // second look, and the one forty saw is just the road.
        others: entries
            .filter((e) => e.ip !== primary.ip)
            .sort((a, b) => a.seenBy - b.seenBy || rankAddresses(a, b)),
        foreignRouted: rows
            .filter((row) => row?.ip && row.ip !== primary.ip)
            .map((row) => ({
                host: row.host,
                name: row.name,
                ip: row.ip,
                country_code: String(geolocations[row.ip]?.country_code || row.loc || '').toUpperCase(),
            })),
        unattributed: rows.filter((row) => row?.state === 'ok' && !row.ip).length,
        // The denominator the counts should actually be read against: the
        // destinations that *named* an address. Two thirds of a real table answers a
        // timed request without ever saying whose address it saw, so "18 of 48" would
        // leave 29 sites unaccounted for next to an "other exit" row reading "1 of 48"
        // — and a reader who adds the column up and finds it short blames the network.
        attributed: entries.reduce((total, e) => total + e.seenBy, 0),
    };
};
