// frontend/utils/ai-service-regions.js
//
// Thin re-export of common/ai-service-regions.js — the published availability
// lists the AI-egress page reads. The data lives in `common/` because it is
// provider policy rather than presentation, and a test imports it without a
// Vite alias; consumers keep writing `@/utils/ai-service-regions.js`.
export {
    AI_EGRESS_SERVICES,
    AI_EGRESS_ALL,
    EGRESS_CONTROL,
    REGION_VERDICT,
    NON_COUNTRY_LOCS,
    regionVerdict,
    nonCountryLoc,
} from '../../common/ai-service-regions.js';
