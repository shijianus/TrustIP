// `split` — one work order for the homepage's site-routing table.
//
// Identical arithmetic to api/split.js: the browser posts six signals about the
// machine in front of it, `scoreProfile` judges where that is, `buildPlan` turns
// the picked countries into destinations. No storage, no logging, no network —
// which is why a key-free edge deployment answers it exactly as well as the
// Express original, and nothing here can time it out.
//
// The blackness is the API. The response is `{ rows }` and nothing else: no
// ranking, no weights, no explanation. There is no GET, because publishing the
// packs and the weight table would teach how to place a visitor and how to place
// them wrongly.

import { scoreProfile, PLAN_COUNTRIES_MAX } from './split-profile.js';
import { buildPlan, hasPack } from './site-packs.js';
import { requireSplitSignals } from './guards.js';
import { json } from './respond.js';

export default (body) => {
    const cleaned = requireSplitSignals(body);
    if (cleaned.error) return json({ error: cleaned.error }, { status: 400 });

    const { signals, countries } = cleaned.value;
    const scored = scoreProfile(signals || {});
    // A caller that already knows which countries it wants — a report, a script —
    // asks for that work order directly. Held to the number of packs the judged
    // path could ever have produced; filtering before slicing so a leading unknown
    // code cannot spend the budget on nothing.
    const picked = countries?.length
        ? countries.filter(hasPack).slice(0, PLAN_COUNTRIES_MAX)
        : scored.top;

    return json({ rows: buildPlan(picked).rows });
};
