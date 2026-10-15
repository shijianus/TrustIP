// Shared client-side MaxMind lookup for components that need to enrich a
// raw IP with country + ISP + ASN.
// Returns `{ country_code, country, org, asn }` on success. Returns `null` on
// every failure path (no MaxMind source, network error, malformed
// upstream payload) so callers don't have to disambiguate.
// MaxMind answers from a local database a key-free deployment usually does not
// have; when `/api/configs` says it is absent the lookup goes to the first
// enabled key-free source instead (`pickLookupSource`), so the WebRTC, DNS-leak
// and rule tests still name each address's country and network rather than
// spending a request per address on a route that can only answer 503.
// Lookups are deduped module-wide by ip+lang: the WebRTC test resolves the
// same public IP from several STUN servers and each one triggers a lookup —
// they all share one request, and successful results are cached for the
// session (geo data doesn't change mid-visit). Failures are not cached, so a
// transient error stays retryable.

// Relative imports (not the @ alias) keep this file importable from the Node
// test runner, same as the other spec-covered composables.
import { useMainStore } from '../store.js';
import { useI18n } from 'vue-i18n';
import { fetchWithTimeout } from '../utils/fetch-with-timeout.js';
import { transformDataFromIPapi } from '../utils/transform-ip-data.js';
import getCountryName from '../data/country-name.js';
import { toApiTag } from '../utils/locale-registry.js';

// key → resolved result (successes only) / key → in-flight promise.
const lookupCache = new Map();
const pendingLookups = new Map();

// Pure dedup wrapper (exported for tests): concurrent calls with the same key
// await the same doLookup() run; non-null results are cached permanently.
export const dedupedLookup = async (key, doLookup) => {
    if (lookupCache.has(key)) return lookupCache.get(key);
    const pending = pendingLookups.get(key);
    if (pending) return pending;

    const promise = (async () => {
        const result = await doLookup();
        if (result !== null) lookupCache.set(key, result);
        return result;
    })();
    pendingLookups.set(key, promise);
    try {
        return await promise;
    } finally {
        pendingLookups.delete(key);
    }
};

// The source a leaked / echoed address is enriched from: MaxMind when its
// database is installed, else the key-free sources in the order the IP card's
// own fallback uses (IP.sb names the city and carries the AS organisation).
const LOOKUP_FALLBACK = ['IP.sb', 'IPinfo.io', 'IP2Location.io', 'IPAPI.is', 'IP-API.com'];

export const pickLookupSource = (ipDBs = []) => {
    const maxmind = ipDBs.find((s) => s.text === 'MaxMind');
    if (maxmind?.enabled) return maxmind;
    for (const text of LOOKUP_FALLBACK) {
        const source = ipDBs.find((s) => s.text === text && s.enabled);
        if (source) return source;
    }
    // No enabled entry at all (configs not loaded yet): keep the old behaviour.
    return maxmind || null;
};

export function useMaxmind() {
    const store = useMainStore();
    const { t } = useI18n();

    const lookupMaxmind = async (ip) => {
        const source = pickLookupSource(store.ipDBs);
        if (!source) return null;

        const lang = store.lang;
        // ip-api.com style locale tag.
        const apiLang = toApiTag(lang);

        // `country` below is localized, so the cache key must carry the lang.
        return dedupedLookup(`${ip}|${lang}|${source.id}`, async () => {
            try {
                const url = store.getDbUrl(source.id, ip, apiLang);
                const response = await fetchWithTimeout(url);
                const data = await response.json();
                const ipData = transformDataFromIPapi(data, source.id, t, lang);
                if (!ipData) return null;
                const country_code = (ipData.country_code || '').toLowerCase();
                const country = country_code
                    ? getCountryName(ipData.country_code, lang)
                    : '';
                // Upstream reports unknown ASN as the literal 'N/A' — normalize to ''.
                const asn = ipData.asn && ipData.asn !== 'N/A' ? ipData.asn : '';
                return { country_code, country, org: ipData.isp || '', asn };
            } catch (error) {
                // warn, not error: a single-source lookup failure is routine
                // visitor-side noise (Sentry only captures console.error);
                // a real /api/maxmind outage reports from the backend itself.
                console.warn('useMaxmind lookup failed', error);
                return null;
            }
        });
    };

    return { lookupMaxmind };
}
