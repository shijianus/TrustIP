// The blocklist zones `common/dnsbl.js` queries, and what each answer code
// means. Contributor-editable static config, in the manner of
// `api/data/dns-resolvers.js` and gated by the same kind of spec
// (tests/dnsbl-zones.test.js): the list is a policy decision, not a bug to be
// discovered at run time.
//
// What a zone answers, per RFC-independent convention: an unlisted address
// returns NXDOMAIN, a listed one returns an A record inside 127.0.0.0/8 whose
// last octet names the sub-list. Codes outside a zone's `listings` map are
// still listings — the zone said yes and we cannot name which of its lists —
// and are reported with the raw code. Codes in `DIAGNOSTICS` are not about the
// address at all: they are the zone refusing *our query*, and reading one as
// "clean" would be a silent pass and reading it as "listed" a false accusation.
//
// Inclusion rules, all four required:
//   * answers a query relayed by a public resolver (no paid entitlement);
//   * free to query, no registration or per-zone key in the name;
//   * a stable operator, so a hit stays attributable years later in a stored row;
//   * specific enough to accuse one address, not a whole netblock.
//
// Excluded on purpose, with the reason recorded so nobody re-adds it:
//   * `zen.spamhaus.org` and its sub-zones — Spamhaus refuses queries relayed by
//     open resolvers and answers 127.255.255.254 instead. The right way to carry
//     it is to query authoritative Spamhaus mirrors from an entitled address,
//     which is a deployment decision, not a code change. Its diagnostic codes
//     are still understood (see `DIAGNOSTICS`), because an operator who adds the
//     zone by configuration must not have those answers read as verdicts.
//   * UCEPROTECT — it lists address ranges on the strength of one member's
//     behaviour, which condemns every clean address in the block. A signal that
//     cannot distinguish the abuser from its neighbours is not evidence.

// Answers that describe the query, never the address.
export const DIAGNOSTICS = {
    '127.255.255.252': 'no-data',        // unrecognized / malformed query
    '127.255.255.253': 'rate-limited',   // too many questions in a row
    '127.255.255.254': 'query-refused',  // not entitled to ask (open resolver)
    '127.255.255.255': 'server-error',
};

export const DNSBL_ZONES = [
    {
        id: 'spamcop',
        label: 'SpamCop BL',
        zone: 'bl.spamcop.net',
        // Spam reported to SpamCop, an operator-submitted feed rather than a
        // crawler's guess.
        category: 'Spam',
        listings: { '127.0.0.2': 'listed' },
    },
    {
        id: 'barracuda',
        label: 'Barracuda BRBL',
        zone: 'b.barracudacentral.org',
        category: 'Reputation',
        listings: { '127.0.0.2': 'listed' },
    },
    {
        id: 'blocklist-de',
        label: 'abuse.ch Blocklist.de',
        zone: 'bl.blocklist.de',
        // Brute-force and botnet C2 hosts observed by abuse.ch: a hit here
        // accuses the address of a specific attack, not of a reputation.
        category: 'Botnet',
        listings: { '127.0.0.2': 'listed' },
    },
    {
        id: 'surriel',
        label: 'Surriel PSBL',
        zone: 'psbl.surriel.com',
        category: 'Spam',
        listings: { '127.0.0.2': 'listed' },
    },
];
