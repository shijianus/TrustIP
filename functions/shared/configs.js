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
//   trust · dossier — not a credential but a route table: handler.ts serves
//       neither, and six of the ten trust signals ride HTTPS while the other four
//       speak raw DNS or read local files. Off, so the panels state the gap in
//       their own voice instead of showing a 404 as a runtime failure.
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
        // No MaxMind-format reader runs here, DB-IP's included, so no attribution line.
        dbipLite: false,
        ipCard: false,
        // The keyless geolocation routes (ipinfo / ipapiis / ip2location) are
        // Express-only, so their cards stay keyed here.
        keylessGeo: false,
        // Not a credential — a route table. `trustscore` and `dossier` are not in
        // handler.ts, and cannot be ported as-is: the blocklist pass speaks raw DNS
        // over UDP, and CAIDA's AS maps and MaxMind's databases are files this
        // runtime has no filesystem for. Six of the ten signals are HTTPS-only and
        // would port, so the honest end state here is a *reduced* score, not a
        // permanent no — but until that work lands the panels have to say they are
        // not served rather than call a route that answers 404 and show a failure.
        trust: false,
        dossier: false,
        // /api/asn-profile is Express-only (it reads the CAIDA files on disk).
        asnProfile: false,
        // POST /api/globalping/measurements (the GLOBALPING_TOKEN proxy) is
        // Express-only; the browser creates measurements anonymously here.
        globalpingProxy: false,
    }, { cacheSeconds: 60 * 60 });
    response.headers.set('Vary', 'Referer');
    return response;
};
