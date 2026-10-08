// IP database definitions
//
// Each item: { id, text, url, enabled, configKey? }
// - id    numeric identifier, referenced elsewhere in the app (e.g. userPreferences.ipGeoSource)
// - text  UI display name, also lookup key (e.g. `WebRtcTest.vue` looks for "MaxMind")
// - url   template string, {{ip}} and {{lang}} will be replaced by buildDbUrl()
// - enabled   availability, derived from /api/configs (runtime failures never touch it)
// - configKey /api/configs flag gating this source; absent = key-free, always available

export const IP_DATABASES = [
  { id: 0, text: 'IPCheck.ing', url: '/api/ipchecking?ip={{ip}}&lang={{lang}}', enabled: true, configKey: 'ipChecking' },
  { id: 1, text: 'IPinfo.io', url: '/api/ipinfo?ip={{ip}}', enabled: true, configKey: 'ipInfo' },
  { id: 2, text: 'IP-API.com', url: '/api/ipapicom?ip={{ip}}&lang={{lang}}', enabled: true },
  { id: 3, text: 'IPAPI.is', url: '/api/ipapiis?ip={{ip}}', enabled: true, configKey: 'ipapiis' },
  { id: 4, text: 'IP2Location.io', url: '/api/ip2location?ip={{ip}}', enabled: true, configKey: 'ip2location' },
  { id: 5, text: 'IP.sb', url: '/api/ipsb?ip={{ip}}', enabled: true },
  { id: 6, text: 'MaxMind', url: '/api/maxmind?ip={{ip}}&lang={{lang}}', enabled: true, configKey: 'maxmind' },
];

/**
 * Returns a fresh ipDBs array (store state initial value), not sharing references with exported IP_DATABASES.
 */
export function createInitialIpDBs() {
  return IP_DATABASES.map((db) => ({ ...db }));
}

/**
 * Pure function: render the final request URL based on the data source record and IP/lang.
 * Extracted to data layer for convenience of unit tests, avoiding dependency on Pinia store.
 */
export function buildDbUrl(db, ip, lang) {
  if (!db || !db.url) return null;
  return db.url.replace('{{ip}}', ip).replace('{{lang}}', lang || 'en');
}

/**
 * Pure function: derive availability from /api/configs — keyed sources follow
 * their flag, key-free sources stay enabled. Returns a fresh array.
 */
export const applyConfigAvailability = (dbs, configs) =>
  dbs.map((db) => ({
    ...db,
    enabled: db.configKey ? !!configs?.[db.configKey] : true,
  }));

/**
 * Pure function: the best source to fall back to, among the enabled ones.
 *
 * Called only when the stored preference names a source this deployment cannot
 * serve (its key is unset), which is the ordinary state of a blank `.env`. It
 * used to walk the list forward from the preferred id and take the first
 * enabled one — which on a keyless deployment means IP-API.com, the one free
 * source here that reports the ASN's registered city rather than the address's
 * own. That is a visible wrong answer ("Santa Clara" for a Los Angeles exit),
 * and a fallback that lands on the weakest available source is not a fallback
 * worth having, so the order is declared instead of positional.
 *
 * Unknown ids and an all-disabled set fall back to `preferredId` unchanged.
 */
const FALLBACK_PREFERENCE = [
  5, // IP.sb — key-free, names the city, carries the ASN organisation
  1, // IPinfo.io
  6, // MaxMind
  4, // IP2Location.io
  3, // IPAPI.is
  2, // IP-API.com
  0, // IPCheck.ing
];

export const nearestEnabledId = (preferredId, dbs) => {
  if (!dbs.length) return preferredId;
  const enabled = new Set(dbs.filter((db) => db.enabled).map((db) => db.id));
  if (!enabled.size) return preferredId;
  if (enabled.has(preferredId)) return preferredId;
  return FALLBACK_PREFERENCE.find((id) => enabled.has(id)) ?? preferredId;
};
