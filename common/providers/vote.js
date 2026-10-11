// Folding several providers' answers into the one verdict the ladder reads.
//
// Two questions have to be answered before a vendor's JSON can be scored, and
// both are about *who said it* rather than *what they said*:
//
// 1. **Can one source accuse on its own?** No. A list vendor's own database
//    (proxycheck.io, ipapi.is, ipinfo's privacy block) is built for exactly this
//    claim, so one `yes` from it is the answer to the question. A source that
//    merely *observed* a service listening — a Shodan InternetDB `open_proxy`
//    tag, an abuse feed's `usageType` word — is evidence of a different thing,
//    and hosts a great many honest addresses by accident. So an observation
//    needs a second source to agree before it can decide anything. Without that
//    split, one scanned port on a hosting range turns every address in it into
//    an anonymiser, which is the false-accusation failure this module's whole
//    design is built against.
//
// 2. **What does silence mean?** Not "clean". A flag no vendor carried stays
//    `null`, which the scorer reads as `unknown` and charges against confidence.
//    A `false` appears only when somebody actually said no. That is the same
//    inversion `common/trust-score.js` holds the optional abuse feed to, and it
//    is why a free tier that answers with none of the detection fields must not
//    be read as an all-clear.
//
// A `false` is therefore not the absence of a `yes` and never derived from one:
// two vendors clearing an address while a third was unreachable reads as clean,
// and one vendor clearing it while another *observed* a proxy — which is not
// enough to decide — reads as clean too, with the dissent kept in `votes` so the
// page can show that it was a close call rather than a certainty.
//
// The abuse numbers arrive in whatever unit each vendor chose. `abuseScore`
// leaves here as a 0–1 fraction, per vendor rung, so the one ladder in
// `common/trust-score.js` is not asked to guess units per source.
//
// The gatherer in `common/trust-signals.js` owns the calling; nothing here touches
// the network.

import { STATUS } from './answer.js';

// A `yes` on its own is enough to decide only from a vendor whose product *is*
// the anonymiser list. Everything else needs company.
const LIST_AUTHORITIES = new Set(['list']);

const CAPABILITIES = ['proxy', 'vpn', 'tor', 'hosting', 'mobile'];

// The one number each vendor publishes about abuse, in the unit that vendor uses.
// Two spell "percent" outright; ipapi.is publishes a small decimal with no stated
// unit at all, so anything above 1 is read as a percentage — the same reading
// `common/trust-score.js` already applies to it.
const ABUSE_SCALE = {
    'abuseipdb.com': (n) => n / 100,
    'proxycheck.io': (n) => n / 100,
    'ipapi.is': (n) => (n > 1 ? n / 100 : n),
    'ipinfo.io': (n) => n / 100,
};

const asAnswer = (a) => (a && typeof a === 'object' ? a : null);

// `1` and `0` are answers; `null` and `undefined` are the vendor staying silent.
const carried = (value) => value === true || value === false;

const flagKey = (cap) => `is${cap[0].toUpperCase()}${cap.slice(1)}`;

/**
 * Merge any number of provider answers into one verdict per capability.
 *
 * @param {Array<object|null>} answers  `answered()`/`unavailable()`/`errored()` shapes
 * @returns {object} `{ flags, by, votes, abuse, sources, unavailable, failed }` —
 *   `flags` and `abuse` carry `null` for anything nobody answered, `by` names the
 *   sources that decided each one, and `votes` keeps the dissent a count rather
 *   than a dropped fact.
 */
export const mergeProviders = (answers) => {
    const list = answers.map(asAnswer).filter(Boolean);

    const out = {
        flags: {},
        by: {},
        votes: {},
        sources: [],
        unavailable: [],
        failed: [],
        // Every source that was consulted at all, with the state it ended in.
        // This is what the HTTP response reports as `sources`: "three asked, one
        // of them over quota" is a different fact from "three cleared it", and a
        // stored row has to be able to tell them apart.
        status: list.map((a) => ({ source: a.source, status: a.status, reason: a.reason || null })),
    };

    for (const answer of list) {
        if (answer.status === STATUS.unavailable) {
            out.unavailable.push({ source: answer.source, reason: answer.reason || 'not-configured' });
            continue;
        }
        if (answer.status === STATUS.error) {
            out.failed.push(answer.source);
            continue;
        }
        if (answer.status === STATUS.ok) out.sources.push(answer.source);
    }

    for (const cap of CAPABILITIES) {
        const key = flagKey(cap);
        const yes = [];
        const no = [];
        for (const answer of list) {
            if (answer.status !== STATUS.ok || !carried(answer[key])) continue;
            (answer[key] === true ? yes : no).push(answer);
        }

        // Counted whatever decides, because the panel shows the tally beside the
        // verdict and "3 of 4 sources" is the evidence a stored row needs.
        out.votes[cap] = { yes: yes.length, no: no.length };
        if (!yes.length && !no.length) {
            out.flags[cap] = null;
            out.by[cap] = null;
            continue;
        }

        const listYes = yes.filter((a) => LIST_AUTHORITIES.has(a.authority));
        const decided = listYes.length ? listYes : yes.length >= 2 ? yes : null;
        if (decided) {
            out.flags[cap] = true;
            out.by[cap] = decided.map((a) => a.source).join(' + ');
        } else if (no.length) {
            out.flags[cap] = false;
            out.by[cap] = no.map((a) => a.source).join(' + ');
        } else {
            // One observation said yes and nobody corroborated it. Reporting that
            // as clean would be a second lie on top of the first one.
            out.flags[cap] = null;
            out.by[cap] = null;
        }
    }

    // The worst number any vendor published, in its own unit, plus a vendor's own
    // yes/no on being an abuser — a flag is charged harder than a score, and the
    // two are different claims about different things.
    const scored = list
        .filter((a) => a.status === STATUS.ok && Number.isFinite(a.abuseScore))
        .map((a) => ({ source: a.source, value: (ABUSE_SCALE[a.source] || ((n) => n))(a.abuseScore) }))
        .filter((a) => a.value >= 0 && a.value <= 1);
    const worst = scored.length ? scored.reduce((best, a) => (a.value > best.value ? a : best)) : null;

    const answeredAbuse = list.filter((a) => a.status === STATUS.ok && carried(a.isAbuser));
    const reported = list
        .filter((a) => a.status === STATUS.ok && Number.isFinite(a.abuseReports))
        .map((a) => a.abuseReports);

    out.abuse = {
        // A flag decides in either direction; an absent one is not a false.
        flag: answeredAbuse.some((a) => a.isAbuser === true) ? true
            : answeredAbuse.length ? false : null,
        flaggedBy: answeredAbuse.filter((a) => a.isAbuser === true).map((a) => a.source).join(' + ') || null,
        score: worst ? worst.value : null,
        by: worst ? worst.source : null,
        // A report count is one vendor's census, so the largest is the one that
        // saw the most — not a sum, which would add two overlapping windows.
        reports: reported.length ? Math.max(...reported) : null,
    };

    return out;
};

export { CAPABILITIES };
