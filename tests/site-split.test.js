// Gate for the routing table's destination catalog.
//
// `common/site-packs.js` is contributor-editable and read by both halves of the
// app, so the invariants that matter are spelled out here: a row is only usable
// if the browser can build a URL from its host alone, a country is only listed if
// this repo actually has destinations for it, and the floor of world sites has to
// stay a floor — ten rows, timed, no duplicates anywhere in the catalog.
//
// What cannot be asserted here is the one property that decides whether a row is
// informative: whether the destination answers Cloudflare's echo. That is a fact
// about someone else's infrastructure and it changes, which is why the method is
// resolved against the live host at run time rather than promised in this file.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    SPLIT_GROUPS,
    INTERNATIONAL_PACK,
    COUNTRY_PACKS,
    PACK_COUNTRIES,
    WORLD_RANKING,
    hasPack,
    EXIT_CANARIES,
    buildPlan,
} from '../common/site-packs.js';
import {
    CONNECTIVITY_PROBES,
    PROBE_SAMPLES,
    PROBE_TONES,
    probeTone,
} from '../common/latency-probes.js';
import { parseTrace, mergeEgressIps } from '../frontend/composables/use-site-split.js';

const KINDS = ['international', 'country', 'world'];
const METHODS = ['auto', 'ping'];
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });

const ALL_ROWS = [
    ...INTERNATIONAL_PACK,
    ...EXIT_CANARIES,
    ...Object.values(COUNTRY_PACKS).flat(),
    ...WORLD_RANKING,
];

// The canaries are asked of everyone and carry a `cc` of their own, so a test
// about "the rows of one country's pack" has to leave them out rather than read
// them as the first row of a list that never ordered them.
const CANARY_HOSTS = EXIT_CANARIES.map((row) => row.host);

describe('parseTrace — the cdn-cgi/trace body', () => {
    it('reads a flat key=value body', () => {
        const fields = parseTrace('fl=1407f99\nh=www.cloudflare.com\nip=1.2.3.4\ncolo=LAX\nloc=US\n');
        assert.equal(fields.ip, '1.2.3.4');
        assert.equal(fields.loc, 'US');
        assert.equal(fields.colo, 'LAX');
    });

    it('tolerates CRLF and surrounding whitespace', () => {
        assert.equal(parseTrace('ip=5.6.7.8\r\nts=1791099919.000\r\n').ip, '5.6.7.8');
        assert.equal(parseTrace('  ip = 9.9.9.9  ').ip.trim(), '9.9.9.9');
    });

    it('splits on the first equals only, so a value may contain one', () => {
        assert.equal(parseTrace('uag=a=b').uag, 'a=b');
    });

    it('ignores lines with no value and non-text input', () => {
        assert.deepEqual(parseTrace(''), {});
        assert.deepEqual(parseTrace(null), {});
        assert.deepEqual(parseTrace(undefined), {});
        assert.equal(parseTrace('no-equals-here\nip=1.1.1.1').ip, '1.1.1.1');
    });
});

// The list the homepage prints under "egress addresses seen". Both halves are
// evidence about the same network, and the source half is the one that is easiest
// to lose: it arrives from a card rather than a row, so a table built only from
// what the destinations echoed reports one exit for a network whose sources
// answered with two.
describe('mergeEgressIps — what the page counts as an exit', () => {
    it('keeps an address only a source ever mentioned', () => {
        assert.deepEqual(mergeEgressIps(['1.1.1.1', '2.2.2.2'], ['1.1.1.1']), ['1.1.1.1', '2.2.2.2']);
    });

    it('leads with the sources, so the list does not reshuffle as rows land', () => {
        assert.deepEqual(mergeEgressIps(['2.2.2.2'], ['1.1.1.1', '2.2.2.2']), ['2.2.2.2', '1.1.1.1']);
    });

    it('asks nothing twice and prints no empty cell', () => {
        assert.deepEqual(mergeEgressIps([], []), []);
        assert.deepEqual(mergeEgressIps(['9.9.9.9'], ['9.9.9.9', null, undefined, '']), ['9.9.9.9']);
    });

    it('counts a leaked address as an exit even when no destination ever named it', () => {
        // The third witness. A proxy exit answers every Cloudflare row, so a table
        // built from the echoes alone would report one exit for a machine that also
        // has the mainland address a STUN server reflected back.
        assert.deepEqual(
            mergeEgressIps(['104.16.51.11'], ['58.246.11.22'], ['104.16.51.11', '58.246.11.22']),
            ['104.16.51.11', '58.246.11.22'],
        );
    });
});

describe('probeTone — the latency colour bands', () => {
    it('bands fast, middling and slow', () => {
        assert.equal(probeTone(12), 'ok-fast');
        assert.equal(probeTone(99), 'ok-fast');
        assert.equal(probeTone(100), 'ok-slow');
        assert.equal(probeTone(299), 'ok-slow');
        assert.equal(probeTone(300), 'fail');
        assert.equal(probeTone(9000), 'fail');
    });

    it('always resolves, because every probe result must be colourable', () => {
        assert.equal(PROBE_TONES[PROBE_TONES.length - 1].ceiling, Infinity);
        assert.equal(typeof probeTone(0), 'string');
    });
});

describe('site-packs data — the destination catalog', () => {
    it('stores bare hostnames, because the probe builds the URL itself', () => {
        for (const row of ALL_ROWS) {
            assert.doesNotMatch(row.host, /^https?:\/\//, row.host);
            assert.doesNotMatch(row.host, /\//, `${row.host} carries a path`);
            assert.doesNotMatch(row.host, /\s/, `${row.host} carries whitespace`);
            assert.match(row.host, /^[a-z0-9.-]+$/i, `${row.host} is not a plain hostname`);
        }
    });

    it('names every row and asks each host at most once', () => {
        const hosts = ALL_ROWS.map((r) => r.host);
        assert.equal(new Set(hosts).size, hosts.length, 'duplicate host across the catalog');
        for (const row of ALL_ROWS) assert.ok(row.name?.length > 0, `${row.host} is unnamed`);
    });

    it('declares a known kind, method and group on every row', () => {
        for (const row of ALL_ROWS) {
            assert.ok(KINDS.includes(row.kind), `${row.host}: kind ${row.kind}`);
            assert.ok(METHODS.includes(row.method), `${row.host}: method ${row.method}`);
            assert.ok(SPLIT_GROUPS.includes(row.group), `${row.host}: group ${row.group}`);
        }
    });

    // The routing table draws each destination's own icon, committed as a PNG
    // under public/favicons/ and named by `row.icon`. Two invariants make that
    // safe: the name has to be a usable file name, and two different brands must
    // not be pointed at the same file — a collision would silently show Telegram
    // wearing WhatsApp's logo, which is worse than showing no logo.
    //
    // The three ids with no icon on file are listed rather than asserted away:
    // their sources hand back something that is not a decodable image, and the
    // frontend falls back to a letter tile for them. Adding a fourth gap fails
    // here instead of turning into a broken image on someone's homepage.
    const ICONS_WITHOUT_A_COMMITTED_PNG = ['hkma', 'irctc', 'ptv'];

    it('gives each destination a distinct, usable icon name', () => {
        const byIcon = new Map();
        for (const row of ALL_ROWS) {
            assert.ok(row.icon, `${row.host}: no icon id`);
            assert.match(row.icon, /^[a-z0-9][a-z0-9-]{0,30}$/, `${row.host}: icon ${row.icon} is not a file name`);
            const seen = byIcon.get(row.icon);
            if (seen) assert.equal(seen, row.host, `${row.icon} names both ${seen} and ${row.host}`);
            else byIcon.set(row.icon, row.host);
        }
    });

    it('ships a committed PNG for every icon but the documented gaps', () => {
        const dir = fileURLToPath(new URL('../public/favicons/', import.meta.url));
        for (const row of ALL_ROWS) {
            const present = existsSync(join(dir, `${row.icon}.png`));
            if (ICONS_WITHOUT_A_COMMITTED_PNG.includes(row.icon)) {
                assert.ok(!present, `${row.icon} now has a PNG — drop it from the gap list`);
            } else {
                assert.ok(present, `${row.host}: missing public/favicons/${row.icon}.png — run pnpm fetch-favicons`);
            }
        }
    });

    it('keeps country rows attached to a country this repo has a pack for', () => {
        for (const row of Object.values(COUNTRY_PACKS).flat()) {
            assert.match(row.cc, /^[A-Z]{2}$/, `${row.host}: cc ${row.cc}`);
            assert.ok(hasPack(row.cc), `${row.host}: cc ${row.cc} has no pack`);
        }
        for (const row of [...INTERNATIONAL_PACK, ...WORLD_RANKING]) {
            assert.equal(row.cc, undefined, `${row.host} must not claim a country`);
        }
    });

    it('lists pack countries as codes Intl can name', () => {
        assert.deepEqual(PACK_COUNTRIES, Object.keys(COUNTRY_PACKS));
        for (const cc of PACK_COUNTRIES) {
            assert.match(cc, /^[A-Z]{2}$/);
            assert.ok(regionNames.of(cc), `${cc} is not a region Intl.DisplayNames knows`);
        }
        assert.ok(PACK_COUNTRIES.length >= 12, `${PACK_COUNTRIES.length} packs is too few to be adaptive`);
    });

    it('gives every pack enough rows to be worth a section', () => {
        for (const [cc, rows] of Object.entries(COUNTRY_PACKS)) {
            assert.ok(rows.length >= 3, `${cc}: ${rows.length} rows`);
        }
    });

    it('covers the general-interest categories with more than one destination each', () => {
        // The 国际 block is the half of the table every visitor sees, so a
        // category with a single row is a category that can fail alone.
        const byGroup = {};
        for (const row of INTERNATIONAL_PACK) (byGroup[row.group] ||= []).push(row);
        assert.ok(Object.keys(byGroup).length >= 8, `${Object.keys(byGroup).length} categories`);
        for (const [group, rows] of Object.entries(byGroup)) {
            assert.ok(rows.length >= 2, `${group}: ${rows.length} rows`);
        }
    });

    it('labels the general block as international rather than as some country', () => {
        // The point of the 国际 tag: a developer service belongs to no visitor's
        // nation, and stamping one with a flag would describe paperwork, not
        // anyone's routing.
        assert.ok(INTERNATIONAL_PACK.every((r) => r.kind === 'international'));
        assert.ok(INTERNATIONAL_PACK.length >= 12, `${INTERNATIONAL_PACK.length} international rows`);
    });
});

describe('the world floor', () => {
    it('is exactly ten rows, ranked, and timed only', () => {
        assert.equal(WORLD_RANKING.length, 10, `${WORLD_RANKING.length} rows`);
        for (const row of WORLD_RANKING) {
            assert.equal(row.kind, 'world', `${row.host} must sit in the floor`);
            assert.equal(row.method, 'ping', `${row.host} is not a trace row — the floor measures latency`);
            assert.ok(Number.isInteger(row.rank) && row.rank >= 1 && row.rank <= 20, `${row.host}: rank ${row.rank}`);
        }
        assert.deepEqual(
            WORLD_RANKING.map((r) => r.rank),
            [...WORLD_RANKING.map((r) => r.rank)].sort((a, b) => a - b),
            'ranks must run in order down the list',
        );
        assert.equal(new Set(WORLD_RANKING.map((r) => r.rank)).size, 10, 'duplicate rank');
    });
});

describe('buildPlan — the work order', () => {
    it('ignores countries with no destinations and keeps the order it was given', () => {
        // The two-country cap lives in the scorer, not here: this is the part
        // that turns a list into rows, and it should not second-guess the ranking.
        assert.deepEqual(buildPlan(['ZZ', 'CN', 'QQ', 'TW', 'IR']).countries, ['CN', 'TW', 'IR']);
    });

    it('drops duplicates and copes with nothing at all', () => {
        assert.deepEqual(buildPlan(['CN', 'CN']).countries, ['CN']);
        const empty = buildPlan([]);
        assert.deepEqual(empty.countries, []);
        assert.equal(empty.rows.length, INTERNATIONAL_PACK.length + WORLD_RANKING.length + EXIT_CANARIES.length);
    });

    // The canary is the row that finds a leak the visitor's own signals are
    // busy hiding, so being guessed into a country is not a precondition for
    // asking it — and asking it twice in one table would be one row wasted.
    it('asks the canaries whoever they are, once', () => {
        for (const countries of [[], ['US'], ['CN', 'US'], ['ZZ']]) {
            const hosts = buildPlan(countries).rows.map((r) => r.host);
            for (const canary of EXIT_CANARIES) {
                assert.equal(hosts.filter((h) => h === canary.host).length, 1,
                    `${canary.host} exactly once for ${JSON.stringify(countries)}`);
            }
        }
    });

    it('probes a pack for every country it is given, not two', () => {
        // The cap on how many countries get tested is the scorer's business and is
        // measured in *addresses*; this function's job is to turn the list it gets
        // into rows, all of them. Silently keeping two would recreate the bug where
        // a mainland IPv4 and an overseas IPv6 each lost half the table.
        const { rows, countries } = buildPlan(['CN', 'US', 'JP', 'KR']);
        assert.deepEqual(countries, ['CN', 'US', 'JP', 'KR']);
        for (const cc of countries) {
            const shown = rows.filter((r) => r.cc === cc && !CANARY_HOSTS.includes(r.host));
            assert.deepEqual(shown.map((r) => r.host), COUNTRY_PACKS[cc].map((r) => r.host), `${cc} pack`);
        }
    });

    it('keeps a national pack in the order its people use it', () => {
        // Written order *is* the ranking for these rows: the table renders the
        // catalog's order, so re-sorting by category would file 百度 behind
        // whatever heading happened to lead.
        const cn = buildPlan(['CN']).rows
            .filter((r) => r.cc === 'CN' && !CANARY_HOSTS.includes(r.host))
            .map((r) => r.host);
        assert.deepEqual(cn.slice(0, 3), ['www.baidu.com', 'weixin.qq.com', 'www.douyin.com']);
        assert.ok(!cn.includes('www.qualcomm.cn'), 'a chipmaker is not what this pack is for');
    });

    it('orders the table: the ranking leads, then the shared block, then the guess', () => {
        const { rows } = buildPlan(['IR', 'CN']);
        const kinds = rows.map((r) => r.kind);
        // The ten biggest sites lead the table: they are the part that means the
        // same thing to every visitor, and the rest of the table can only be read
        // once the page knows the network answers at all.
        assert.deepEqual(kinds.slice(0, WORLD_RANKING.length), WORLD_RANKING.map(() => 'world'),
            'the ranking is one contiguous block at the front');
        // The shared block and the national rows stay in two blocks after it: they
        // answer different questions, and a row interleaved between them would read
        // as belonging to whichever block it happened to land in. The canaries sit
        // at the end of the shared side for the same reason — they are not part of
        // anyone's guess.
        assert.ok(kinds.lastIndexOf('international') < kinds.indexOf('country'),
            '国际 first, then the guess');
        const canaryHosts = EXIT_CANARIES.map((r) => r.host);
        assert.ok(kinds.lastIndexOf('international') < kinds.findIndex((k, i) => k === 'country' && canaryHosts.includes(rows[i].host)),
            'the canary is not left among the guessed rows');
        assert.deepEqual([...new Set(rows.filter((r) => r.kind === 'country' && !canaryHosts.includes(r.host)).map((r) => r.cc))], ['IR', 'CN']);
    });

    it('leads with the group this profile came for, not the catalog order', () => {
        // AI is the reason the test gets run on a Chinese network, and the order
        // behind it is a different question on an American one.
        const sequence = (countries) => buildPlan(countries).rows
            .filter((r) => r.kind === 'international')
            .map((r) => r.group);
        const cn = sequence(['CN']);
        assert.ok(cn.slice(0, 6).every((g) => g === 'AI'),
            'the AI pack leads for a Chinese profile');
        assert.notDeepEqual(sequence(['US']), cn,
            'the same pack in the same order for every visitor would not be a profile');
        // A profile that matched no override still gets the whole pack, in the
        // base order — the order is a preference about precedence, not a filter.
        const base = sequence([]);
        assert.equal(base.length, cn.length, 'no group is dropped for an unknown profile');
        assert.ok(base.every((g) => cn.includes(g)));
    });
});

describe('connectivity probes', () => {
    it('names a bare host per destination and a country to flag it with', () => {
        for (const probe of CONNECTIVITY_PROBES) {
            assert.doesNotMatch(probe.host, /^https?:\/\//, probe.host);
            assert.match(probe.country, /^[A-Z]{2}$/, `${probe.name}: country must be alpha-2`);
            assert.ok(regionNames.of(probe.country), `${probe.name}: ${probe.country} is not a known region`);
        }
    });

    // The homepage's strip and the routing table are the same idea at two
    // densities, so they render the same way: each probe names a committed
    // icon, and the file has to exist. A probe added without one silently
    // downgrades to a letter tile on the most-visited block of the page.
    it('names a committed icon per destination', () => {
        const dir = fileURLToPath(new URL('../public/favicons/', import.meta.url));
        for (const probe of CONNECTIVITY_PROBES) {
            assert.ok(probe.icon, `${probe.name}: no icon id`);
            assert.match(probe.icon, /^[a-z0-9][a-z0-9-]{0,30}$/, `${probe.name}: icon ${probe.icon} is not a file name`);
            assert.ok(existsSync(join(dir, `${probe.icon}.png`)),
                `${probe.name}: missing public/favicons/${probe.icon}.png — run pnpm fetch-favicons`);
        }
    });

    it('samples enough times to show variance, and few enough to finish', () => {
        assert.ok(PROBE_SAMPLES >= 6 && PROBE_SAMPLES <= 20, `${PROBE_SAMPLES} samples`);
    });
});

// The routing test's whole design rests on the browser not knowing how it was
// placed: the weights, the OS-era table, the zone index and the country packs are
// the reasoning, and a bundle is a published document. These three modules are
// therefore server-only, and nothing under `frontend/` may reach them — not even
// through a `utils/` bridge, which is the shape a future "just expose it" change
// would take. Asserted against the import graph rather than a built bundle so it
// fails on the commit that would have caused the leak, not on someone's CI build.
describe('the frontend must not be able to read the reasoning', () => {
    const SERVER_ONLY = ['site-packs', 'split-profile', 'timezone-countries'];
    const IMPORTS = /(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

    const sources = [];
    const walk = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(path); }
            else if (/\.(js|vue)$/.test(entry.name)) sources.push(path);
        }
    };
    walk(fileURLToPath(new URL('../frontend/', import.meta.url)));

    it('scans a real tree, so an empty list cannot pass by accident', () => {
        assert.ok(sources.length > 100, `only ${sources.length} frontend files found`);
    });

    it('has no import of a server-only module anywhere under frontend/', () => {
        const offenders = [];
        for (const file of sources) {
            const text = readFileSync(file, 'utf8');
            for (const [, specifier] of text.matchAll(IMPORTS)) {
                if (SERVER_ONLY.some((name) => specifier.includes(name))) offenders.push(`${file} → ${specifier}`);
            }
        }
        assert.deepEqual(offenders, [], 'the frontend can read the reasoning');
    });

    it('ships no bridge file for them', () => {
        for (const name of SERVER_ONLY) {
            assert.ok(!existsSync(new URL(`../frontend/utils/${name}.js`, import.meta.url)),
                `frontend/utils/${name}.js re-exports a server-only module`);
        }
    });
});
