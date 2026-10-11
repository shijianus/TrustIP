// The service-status read endpoints, from api/service-status.js.
//
//   overview  → status light per provider
//   detail    → one provider's sub-services + recent incidents, in one response,
//               because a visitor who expands a card looks at both.
//
// Both answer from the snapshot in shared/service-status-store.js, so request
// volume never reaches the upstream status pages directly.

import { json } from './respond.js';
import { getServiceStatusOverview, getProviderDetail } from './service-status-store.js';

const FIVE_MIN_CACHE = 5 * 60;

export const overview = async () =>
    json(await getServiceStatusOverview(), { cacheSeconds: FIVE_MIN_CACHE });

export const detail = async (params) => {
    // The provider slug is whitelisted against STATUS_PROVIDER_IDS by the guard.
    const id = params.get('id');
    const provider = await getProviderDetail(id);
    return json({
        id,
        components: provider ? provider.components : [],
        incidents: provider ? provider.incidents : [],
    }, { cacheSeconds: FIVE_MIN_CACHE });
};
