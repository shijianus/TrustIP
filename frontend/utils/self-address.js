// The visitor's own public address, for pages that answer about "me" when no
// address was given (the IP dossier at bare `/ip`).
//
// An address the homepage probes already found wins — it costs nothing and it is
// the one the IP cards show. Otherwise the same echo chains the IP cards use are
// asked, IPv4 first (every registry and blocklist answers about it), then IPv6.
// The server never guesses from the request: behind a proxy, a CDN or a local
// deployment the socket address is not the visitor's.
import { isUsablePublicIP } from './valid-ip.js';
import { getIPFromCloudflare_V4, getIPFromIPChecking4, getIPFromCloudflare_V6 } from './getips/index.js';

/** The first usable public address among already-collected entries, IPv4 first. */
export const pickKnownAddress = (entries = []) => {
    const ips = entries.map((e) => (typeof e === 'string' ? e : e?.ip)).filter((ip) => isUsablePublicIP(ip));
    return ips.find((ip) => !ip.includes(':')) || ips[0] || null;
};

/**
 * Resolve the visitor's public address; null when every echo failed.
 * `chains` is injectable for tests.
 */
export const resolveSelfAddress = async (known = [], chains = [
    () => getIPFromCloudflare_V4(),
    () => getIPFromIPChecking4(false),
    () => getIPFromCloudflare_V6(),
]) => {
    const fromKnown = pickKnownAddress(known);
    if (fromKnown) return fromKnown;
    for (const chain of chains) {
        try {
            const { ip } = await chain();
            if (isUsablePublicIP(ip)) return ip;
        } catch {
            // next chain
        }
    }
    return null;
};
