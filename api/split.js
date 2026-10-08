// POST /api/split — one work order for the homepage's site-routing table.
//
// The browser reads what it can read about the machine in front of it — a clock,
// a keyboard, a language preference, the operating system its user agent names,
// the countries its own addresses and leaks resolve to — posts that description
// here, and gets back the list of destinations to probe. Nothing else.
//
// That round trip is deliberate, and it is the reason the scoring lives on this
// side of the wire rather than in `common/` where the rest of the shared logic
// sits. The ranking is a judgement about where a person is sitting, made from
// signals that look like fingerprinting even though they are not, and publishing
// the weights would teach two audiences at once: how to place a visitor, and how
// to place them wrongly. So the derivation is not in the bundle, not in the
// response, and not in the public API — the response says which sites to test and
// stops there.
//
// What this handler does not do: store anything, log the body, or reach the
// network. It is arithmetic on data the caller already has, which also means a
// deployment with a blank `.env` answers it exactly as well as one with every key
// set, and no upstream can time it out.
//
// The privacy trade-off is the other way round and worth stating plainly: the
// signals used to be read and discarded inside the visitor's own browser. Now
// they cross to this origin. Same-origin only, no persistence, no body logging —
// but if a deployment ever adds request-body capture, this route is the one that
// must stay out of it.

import { scoreProfile, PLAN_COUNTRIES_MAX } from '../common/split-profile.js';
import { buildPlan, hasPack } from '../common/site-packs.js';

export default async (req, res) => {
    // Defensive method gate (the route is POST-only) — covered by tests. A GET
    // would be a catalog read, and the catalog is not published: it is the shape
    // of the answer, and knowing which countries have packs narrows what the
    // ranking can ever say.
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // `requireSplitSignals` has already reduced the body to the six slices it
    // knows, with every list and string inside its ceiling.
    const { signals, countries } = req.body || {};
    const scored = scoreProfile(signals || {});
    // A caller that already knows which countries it wants — a report, a script —
    // asks for that work order directly; the page leaves `countries` empty and
    // takes the ranking. The explicit list is held to the number of packs the
    // judged path could ever have produced: `requireSplitSignals` bounds the body's
    // size, not the table's, and twelve codes in the door used to mean a
    // hundred-row order. Filtering before slicing so a leading unknown code cannot
    // spend the budget on nothing.
    const picked = countries?.length
        ? countries.filter(hasPack).slice(0, PLAN_COUNTRIES_MAX)
        : scored.top;

    return res.status(200).json({ rows: buildPlan(picked).rows });
};
