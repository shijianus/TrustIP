// Single source of truth is common/latency-probes.js. This file exists as a thin
// re-export so front-end code keeps writing `@/utils/latency-probes.js`.
//
// Note what is *not* here: the routing table's destination catalog
// (common/site-packs.js). That module is server-only on purpose — see
// api/AGENTS.md — and a bridge for it would put the whole country pack list into
// the published bundle.
export {
    CONNECTIVITY_PROBES,
    PROBE_SAMPLES,
    PROBE_TONES,
    probeTone,
} from '../../common/latency-probes.js';
