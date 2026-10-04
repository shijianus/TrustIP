// Validate environment variables exist to enable/disable frontend features
import { isReportSharingConfigured } from './share-report.js';
import { isMaxMindReady } from '../common/maxmind-service.js';

export default (req, res) => {
    // defensive; app.get() in backend-server.js already gates method, but a
    // dedicated smoke test asserts this branch directly against the handler.
    if (req.method !== 'GET') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // Referer has already been validated by requireReferer middleware. Here we
    // just read it to classify whether the caller is the canonical ipcheck.ing
    // deployment ("originalSite") or someone self-hosting a fork.
    const referer = req.headers.referer;
    const hostname = referer ? new URL(referer).hostname : '';
    const allowedHostnames = ['ipcheck.ing', 'www.ipcheck.ing', 'localtest.ipcheck.ing', 'dev.ipcheck.ing', 'test.ipcheck.ing'];
    const originalSite = allowedHostnames.includes(hostname);

    // IPINFO_API_TOKEN / CLOUDFLARE_API are the pre-rename spellings — keep
    // reading them so existing deployments keep their features on upgrade.
    const envConfigs = {
        map: process.env.GOOGLE_MAP_API_KEY,
        ipInfo: process.env.IPINFO_API_KEY || process.env.IPINFO_API_TOKEN,
        ipChecking: process.env.IPCHECKING_API_KEY,
        ip2location: process.env.IP2LOCATION_API_KEY,
        originalSite,
        cloudFlare: process.env.CLOUDFLARE_API_KEY || process.env.CLOUDFLARE_API,
        ipapiis: process.env.IPAPIIS_API_KEY,
        // Share-link feature gate: all three CLOUDFLARE_* KV variables present.
        reportSharing: isReportSharingConfigured(),
        // The one gate that is not about a credential: MaxMind answers from a
        // local database, so it is ready when the files exist, whatever the
        // environment says. Without this the front end treats MaxMind as a
        // key-free source (its entry has no other reason to be off) and burns
        // a request per lookup on a deployment that will never answer.
        maxmind: isMaxMindReady(),
    };
    let result = {};
    for (const key in envConfigs) {
        result[key] = !!envConfigs[key];
    }
    res.status(200).json(result);
};