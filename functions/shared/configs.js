// `configs` — the feature flags frontend/store.js reads, for a Qoder Sites edge
// deployment. Same key set and same `!!value` semantics as api/configs.js.
//
// A `true` here is a promise that the UI can call the route and get an answer, so
// every flag reports what this deployment actually serves:
//
//   map · ipInfo · ipChecking · ip2location · ipapiis · cloudFlare — keyed
//       upstreams, and this deployment is key-free by contract. Off.
//   reportSharing — needs the platform's KV trio, which an edge function does not
//       get. Off, so the report share button never offers a dead link.
//   maxmind — answers from MMDB files on a filesystem this runtime has no
//       equivalent of. Off; the SPA's ip-databases entry has no other reason to
//       be off, and leaving it on would burn one request per lookup on a route
//       that does not exist here.
//   ipCard — renders a PNG through satori, which needs font bytes this runtime
//       cannot read. Off.
//
// The two key-free geo sources (`ipsb`, `ipapicom`) carry no `configKey` in
// frontend/data/ip-databases.js, so `applyConfigAvailability` keeps them enabled
// whatever this returns — nothing here has to say so.

import { json } from './respond.js';

const ORIGINAL_SITE_HOSTNAMES = [
    'ipcheck.ing', 'www.ipcheck.ing', 'localtest.ipcheck.ing', 'dev.ipcheck.ing', 'test.ipcheck.ing',
];

export default (headers) => {
    const referer = headers.get('referer');
    let hostname = '';
    try {
        hostname = referer ? new URL(referer).hostname : '';
    } catch {
        // An unparseable Referer is simply not the upstream project's site.
    }

    // The answer depends on the Referer and is publicly cached for an hour, so
    // shared caches must key on it.
    const response = json({
        map: false,
        ipInfo: false,
        ipChecking: false,
        ip2location: false,
        originalSite: ORIGINAL_SITE_HOSTNAMES.includes(hostname),
        cloudFlare: false,
        ipapiis: false,
        reportSharing: false,
        maxmind: false,
        ipCard: false,
    }, { cacheSeconds: 60 * 60 });
    response.headers.set('Vary', 'Referer');
    return response;
};
