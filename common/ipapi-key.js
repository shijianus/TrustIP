// Picking one of the comma-separated api.ipapi.is keys.
//
// The list is a quota-spreading device, so the rule has to be the same wherever
// a key is read: `api/ipapi-is.js` rotates it for the geolocation card and
// `common/trust-signals.js` for the abuse feed. Two implementations of
// "pick a random key" is how one half of the deployment quietly starves one key
// while the other spreads across them.
//
// An unset variable is a supported configuration, so this returns null rather
// than throwing — callers answer "not configured" before any request leaves the
// process.

export const pickIpApiIsKey = () => {
    const keys = (process.env.IPAPIIS_API_KEY || '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean);
    if (!keys.length) return null;
    return keys[Math.floor(Math.random() * keys.length)];
};
