// Regenerates common/timezone-countries.js from the IANA time-zone database.
//
// The table is derived data, not something to hand-edit: it is the union of
// zone.tab and zone1970.tab from the tzdata installed on this machine, and a
// typo in it would silently cost the timezone signal its weight. Run this after
// a tzdata upgrade (or on a machine with a newer one) and commit the diff:
//
//     node scripts/regen-timezone-countries.js
//
// It reads the two tab files and writes the module; nothing here guesses a
// country, and nothing here reaches the network.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CANDIDATES = ['/usr/share/zoneinfo', '/usr/share/lib/zoneinfo', '/usr/local/etc/zoneinfo'];
const ZONEINFO = CANDIDATES.find((dir) => existsSync(`${dir}/zone.tab`));
if (!ZONEINFO) {
    console.error(`No zone.tab found under ${CANDIDATES.join(', ')}. Point this at a tzdata install.`);
    process.exit(1);
}

// `# version 2025c` is the first line of tzdata.zi on a Debian-family install;
// reading it beats shelling out to zdump, and the string only ever labels the
// provenance comment.
const tzVersion = () => {
    try {
        return readFileSync(`${ZONEINFO}/tzdata.zi`, 'utf8').match(/#\s*version\s+(\S+)/)?.[1] || 'unknown';
    } catch {
        return 'unknown';
    }
};

const rows = (file) => readFileSync(`${ZONEINFO}/${file}`, 'utf8')
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('\t'));

const map = new Map();
const add = (zone, codes) => {
    if (!zone) return;
    const current = map.get(zone) || [];
    for (const cc of codes) if (cc && !current.includes(cc)) current.push(cc);
    map.set(zone, current.sort());
};

// zone.tab answers "which countries use this name" one row at a time;
// zone1970.tab merges zones whose civil clocks agreed since 1970 and so carries
// the multi-country rows zone.tab splits apart. Both are needed for the union.
for (const [cc, , zone] of rows('zone.tab')) add(zone?.trim(), [cc?.trim()]);
for (const [cc, , zone] of rows('zone1970.tab')) add(zone?.trim(), (cc || '').split(',').map((s) => s.trim()));

const version = tzVersion();

const table = [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([zone, codes]) => `    ${JSON.stringify(zone)}: ${JSON.stringify(codes.join(' '))},`)
    .join('\n');

const existing = readFileSync('common/timezone-countries.js', 'utf8');
// Everything from the alias table down is hand-written and stays as it is.
const tail = existing.slice(existing.indexOf('// Names an older system'));

const out = `// Which countries each IANA timezone name covers.
//
// The system clock is the strongest single clue about where a person is sitting,
// and it is the one clue a UTC offset cannot give: Asia/Taipei, Asia/Shanghai and
// Asia/Urumqi all read the same eight hours ahead, and three different answers. So
// this table maps the zone *name* to the ISO 3166-1 alpha-2 codes that use it.
//
// Generated from the IANA time-zone database (public domain) rather than from
// \`Intl\`, because ICU differs between engines — Node ships a reduced build where
// \`Intl.supportedValuesOf("region")\` throws, and a signal that quietly resolves to
// "no countries" in half the runtime would be worse than no signal at all. Refresh
// with:
//
//     node scripts/regen-timezone-countries.js
//
// Rows are the union of zone.tab and zone1970.tab, so a zone that spans several
// countries lists all of them and spends its share of the score on each — Pacific
// time in Australia is not the same claim on the answer as Asia/Tehran is.
//
// Source: tzdata ${version} (${ZONEINFO}). The table below is generated; the code
// under it is not.

/** zone name → space-separated alpha-2 codes */
export const ZONE_COUNTRIES = {
${table}
};

${tail}`;

writeFileSync('common/timezone-countries.js', out);
console.log(`📦 wrote common/timezone-countries.js — ${map.size} zones from tzdata ${version}`);
