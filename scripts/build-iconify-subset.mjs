// Regenerates frontend/data/iconify-subset.json: the ri / simple-icons / bxl
// glyphs the app names (scanned from frontend/ and common/), fetched once from
// the Iconify API at dev time so the browser never has to. Run with network:
//   node scripts/build-iconify-subset.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PREFIXES = ['ri', 'simple-icons', 'bxl'];
const walk = (dir) => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.(vue|js)$/.test(f) ? [p] : [];
});
const names = Object.fromEntries(PREFIXES.map((p) => [p, new Set()]));
for (const file of [...walk('frontend'), ...walk('common')]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/["'`](ri|simple-icons|bxl):([a-z0-9-]+)["'`]/g)) names[m[1]].add(m[2]);
}
const out = [];
for (const prefix of PREFIXES) {
    const list = [...names[prefix]].sort();
    if (!list.length) continue;
    const res = await fetch(`https://api.iconify.design/${prefix}.json?icons=${list.join(',')}`);
    const set = await res.json();
    delete set.lastModified;
    out.push(set);
}
writeFileSync('frontend/data/iconify-subset.json', JSON.stringify(out));
console.log(Object.fromEntries(PREFIXES.map((p) => [p, names[p].size])));
