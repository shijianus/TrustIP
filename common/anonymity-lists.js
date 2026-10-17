// Local anonymity / hosting membership lists: whether an address is a current
// Tor exit, inside a range X4BNet attributes to a commercial VPN, or inside a
// range X4BNet attributes to a datacenter / hosting operator. Three key-free
// published lists, downloaded by common/datasets.js into two dataset
// directories and matched here without any network I/O:
//
//   tor-exit   https://check.torproject.org/torbulkexitlist — the Tor
//              Project's own list of addresses exits were seen leaving from
//              (IPv4 only). It is the directory itself, so an IPv4 address
//              absent from a loaded list is "not a current exit".
//   x4bnet     https://github.com/X4BNet/lists_vpn (MIT) — output/vpn and
//              output/datacenter IPv4 CIDR lists. Curated, not exhaustive:
//              a range absent from them is "not listed", never "not a VPN".
//
// Answers are per capability: { status, source } where status is one of
//   listed       the address is in the list
//   not-listed   the list is loaded and the address is not in it
//   not-covered  the list says nothing about this address family (IPv6)
//   unavailable  the list is not on disk (first boot, failed download, or
//                ANONYMITY_LISTS=false)
// Only `listed` is an accusation; the dossier renders `not-listed` of a
// non-exhaustive list as "not on the list", which is not a clearance.
//
// Matching: each CIDR list is folded into sorted, merged [start, end] IPv4
// intervals held in two Uint32Arrays and searched by bisection — ~55k CIDRs
// cost ~0.4 MB and a lookup is ~16 comparisons. The Tor list is a Set.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { parseCidr, parseIPv4, formatIPv4 } from './ip-math.js';
import { STATE_FILE } from './dataset-updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const TOR_EXIT_DB_DIR = path.join(__dirname, 'tor-exit-db');
export const TOR_EXIT_FILE = 'tor-exit-addresses.txt';
export const X4BNET_DB_DIR = path.join(__dirname, 'x4bnet-db');
export const X4BNET_VPN_FILE = 'x4bnet-vpn-ipv4.txt';
export const X4BNET_DATACENTER_FILE = 'x4bnet-datacenter-ipv4.txt';

export const TOR_EXIT_SOURCE = 'check.torproject.org';
export const X4BNET_SOURCE = 'X4BNet/lists_vpn';

// Size caps a download must sit inside before it is published. The floors
// refuse a truncated or emptied answer (a list of zero exits would clear
// every address); the ceilings refuse a runaway one; the prefix floor refuses
// a corrupt line that would accuse a /0 or a whole /4.
export const LIST_LIMITS = {
    tor: { min: 300, max: 100000 },
    vpn: { min: 1000, max: 200000 },
    datacenter: { min: 5000, max: 500000 },
    maxBytes: 20 * 1024 * 1024,
    minPrefix: 8,
};

export const isAnonymityListsEnabled = () => process.env.ANONYMITY_LISTS !== 'false';

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

const dataLines = (text) => String(text || '').split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);

/**
 * The Tor bulk exit list → Set of canonical IPv4 strings. A line that is not
 * an IPv4 address is skipped and counted, so a validator can refuse an HTML
 * error page served with a 200.
 */
export const parseTorExitList = (text) => {
    const exits = new Set();
    let rejected = 0;
    for (const line of dataLines(text)) {
        const parsed = parseIPv4(line);
        if (parsed) exits.add(formatIPv4(parsed.value));
        else rejected++;
    }
    return { exits, rejected };
};

/**
 * An IPv4 CIDR list → { starts, ends } sorted, merged, non-overlapping
 * intervals (Uint32Array each) plus the count of accepted / rejected lines.
 * A bare address is read as a /32.
 */
export const parseCidrList = (text, { minPrefix = LIST_LIMITS.minPrefix } = {}) => {
    const ranges = [];
    let rejected = 0;
    for (const line of dataLines(text)) {
        const cidr = parseCidr(line.includes('/') ? line : `${line}/32`);
        if (!cidr || cidr.family !== 4 || cidr.prefix < minPrefix) {
            rejected++;
            continue;
        }
        const start = Number(cidr.network);
        ranges.push([start, start + 2 ** (32 - cidr.prefix) - 1]);
    }
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const [start, end] of ranges) {
        const last = merged[merged.length - 1];
        if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else merged.push([start, end]);
    }
    return {
        starts: Uint32Array.from(merged, (r) => r[0]),
        ends: Uint32Array.from(merged, (r) => r[1]),
        accepted: ranges.length,
        rejected,
    };
};

/** Whether IPv4 integer `value` falls inside one of the merged intervals. */
export const rangesContain = (set, value) => {
    if (!set?.starts?.length) return false;
    let lo = 0;
    let hi = set.starts.length - 1;
    while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (set.starts[mid] > value) hi = mid - 1;
        else if (set.ends[mid] < value) lo = mid + 1;
        else return true;
    }
    return false;
};

/* ------------------------------------------------------------------ */
/* Validation (used by the dataset rows before publishing)             */
/* ------------------------------------------------------------------ */

const checkSize = (filePath) => {
    const { size } = fs.statSync(filePath);
    if (size > LIST_LIMITS.maxBytes) throw new Error(`${path.basename(filePath)} is ${size} bytes; over the ${LIST_LIMITS.maxBytes} cap`);
};

const checkCount = (label, count, { min, max }) => {
    if (count < min) throw new Error(`Staged ${label} list has only ${count} entries; refusing to publish`);
    if (count > max) throw new Error(`Staged ${label} list has ${count} entries; over the ${max} cap`);
};

export const validateTorExitFile = (filePath) => {
    checkSize(filePath);
    const { exits, rejected } = parseTorExitList(fs.readFileSync(filePath, 'utf8'));
    checkCount('Tor exit', exits.size, LIST_LIMITS.tor);
    // A few odd lines are tolerated; a page that is mostly not addresses is not a list.
    if (rejected > exits.size / 10) throw new Error(`Staged Tor exit list has ${rejected} non-address lines`);
    return exits.size;
};

export const validateCidrFile = (filePath, kind) => {
    checkSize(filePath);
    const { accepted, rejected } = parseCidrList(fs.readFileSync(filePath, 'utf8'));
    checkCount(`X4BNet ${kind}`, accepted, LIST_LIMITS[kind]);
    if (rejected > accepted / 10) throw new Error(`Staged X4BNet ${kind} list has ${rejected} unusable lines`);
    return accepted;
};

/* ------------------------------------------------------------------ */
/* Load + lookup                                                       */
/* ------------------------------------------------------------------ */

let tor = null;
let vpn = null;
let datacenter = null;

const readStateTime = (dir) => {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8')).updatedAt || null;
    } catch {
        return null;
    }
};

const readIfPresent = (dir, file, parse) => {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) return null;
    try {
        return { ...parse(fs.readFileSync(filePath, 'utf8')), updatedAt: readStateTime(dir) };
    } catch (error) {
        logger.warn({ err: error, path: filePath }, '⚠️  Failed to parse anonymity list');
        return null;
    }
};

const loadTor = () => {
    tor = readIfPresent(TOR_EXIT_DB_DIR, TOR_EXIT_FILE, parseTorExitList);
    if (tor) logger.info(`📦 Tor exit list loaded — ${tor.exits.size} exits`);
    else logger.info({ dir: TOR_EXIT_DB_DIR }, '⚠️  Tor exit list not present; the dossier Tor row reads "no data"');
};

const loadX4bnet = () => {
    vpn = readIfPresent(X4BNET_DB_DIR, X4BNET_VPN_FILE, parseCidrList);
    datacenter = readIfPresent(X4BNET_DB_DIR, X4BNET_DATACENTER_FILE, parseCidrList);
    if (vpn && datacenter) {
        logger.info(`📦 X4BNet lists loaded — ${vpn.starts.length} VPN ranges, ${datacenter.starts.length} datacenter ranges`);
    } else {
        logger.info({ dir: X4BNET_DB_DIR }, '⚠️  X4BNet lists not present; the dossier VPN / hosting-list rows read "no data"');
    }
};

loadTor();
loadX4bnet();

export const reloadTorExitList = (reason = 'reload') => {
    logger.info(`🔄 Reloading Tor exit list (${reason})`);
    loadTor();
};

export const reloadX4bnetLists = (reason = 'reload') => {
    logger.info(`🔄 Reloading X4BNet lists (${reason})`);
    loadX4bnet();
};

export const isTorExitListLoaded = () => tor !== null;
export const isX4bnetLoaded = () => vpn !== null && datacenter !== null;

const answer = (status, source, updatedAt) => ({ status, source, updatedAt: updatedAt || null });

/**
 * Membership of one address in the three lists. Pure lookups over what is
 * loaded; `tables` is injectable for tests.
 *
 * @param {string} ip  a validated address
 * @returns {{ tor: object, vpn: object, datacenter: object }}
 */
export const lookupAnonymity = (ip, tables = { tor, vpn, datacenter }) => {
    const v4 = parseIPv4(String(ip || ''));
    const enabled = isAnonymityListsEnabled();
    const torAnswer = !enabled || !tables.tor ? answer('unavailable', TOR_EXIT_SOURCE)
        : !v4 ? answer('not-covered', TOR_EXIT_SOURCE, tables.tor.updatedAt)
            : answer(tables.tor.exits.has(formatIPv4(v4.value)) ? 'listed' : 'not-listed', TOR_EXIT_SOURCE, tables.tor.updatedAt);
    const rangeAnswer = (set) => (!enabled || !set ? answer('unavailable', X4BNET_SOURCE)
        : !v4 ? answer('not-covered', X4BNET_SOURCE, set.updatedAt)
            : answer(rangesContain(set, Number(v4.value)) ? 'listed' : 'not-listed', X4BNET_SOURCE, set.updatedAt));
    return { tor: torAnswer, vpn: rangeAnswer(tables.vpn), datacenter: rangeAnswer(tables.datacenter) };
};
