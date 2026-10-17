// Tests for the local anonymity lists: common/anonymity-lists.js (parsing,
// interval matching, per-capability lookup states, size caps), their two
// dataset rows in common/datasets.js (re-pointed at temp dirs, fetch stubbed:
// no network), the opt-in provider adapter, and the dossier's deep-risk slot.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';

import {
    parseTorExitList, parseCidrList, rangesContain, lookupAnonymity,
    validateTorExitFile, validateCidrFile, LIST_LIMITS,
    TOR_EXIT_FILE, X4BNET_VPN_FILE, X4BNET_DATACENTER_FILE, TOR_EXIT_SOURCE, X4BNET_SOURCE,
    isTorExitListLoaded, isX4bnetLoaded,
} from '../common/anonymity-lists.js';
import { datasets, TOR_EXIT_URL, X4BNET_LISTS } from '../common/datasets.js';
import { updateDataset, isRowEnabled } from '../common/dataset-updater.js';
import { askLocalLists, LOCAL_LISTS_SOURCE } from '../common/providers/local-lists.js';
import { enabledProviders } from '../common/providers/registry.js';
import { deepRiskSlot, SLOTS } from '../common/ip-dossier.js';

const realFetch = globalThis.fetch;
const savedEnv = { ANONYMITY_LISTS: process.env.ANONYMITY_LISTS, TRUST_PROVIDERS: process.env.TRUST_PROVIDERS };
afterEach(() => {
    globalThis.fetch = realFetch;
    for (const [name, value] of Object.entries(savedEnv)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'trustip-anonymity-test-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const v4 = (text) => text.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);

// Synthetic lists above the publish floors.
const torList = (n = LIST_LIMITS.tor.min) => Array.from({ length: n }, (_, i) => `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`).join('\n');
const cidrList = (n, base = 10) => Array.from({ length: n }, (_, i) => `${base + Math.floor(i / 65536)}.${Math.floor(i / 256) % 256}.${i % 256}.0/24`).join('\n');

const tables = () => ({
    tor: { ...parseTorExitList('185.220.101.1\n# comment\n185.220.101.2\n'), updatedAt: '2026-10-17T00:00:00Z' },
    vpn: { ...parseCidrList('203.0.113.0/24\n'), updatedAt: null },
    datacenter: { ...parseCidrList('192.0.2.0/25\n192.0.2.128/25\n'), updatedAt: null },
});

describe('parsing', () => {
    it('reads the Tor bulk list as canonical IPv4 addresses and counts junk', () => {
        const { exits, rejected } = parseTorExitList('1.2.3.4\n\n<html>\n5.6.7.8 # trailing comment\n2001:db8::1\n');
        assert.deepEqual([...exits], ['1.2.3.4', '5.6.7.8']);
        assert.equal(rejected, 2);
    });

    it('folds CIDRs into sorted merged intervals; refuses IPv6 and anything wider than /8', () => {
        const set = parseCidrList('10.0.1.0/24\n10.0.0.0/24\n10.0.0.128/25\n0.0.0.0/0\n2001:db8::/32\n192.0.2.7\nnot-a-cidr\n');
        assert.deepEqual([...set.starts], [v4('10.0.0.0'), v4('192.0.2.7')]);
        assert.deepEqual([...set.ends], [v4('10.0.1.255'), v4('192.0.2.7')]);
        assert.equal(set.accepted, 4);
        assert.equal(set.rejected, 3);
    });

    it('bisects the intervals at their edges', () => {
        const set = parseCidrList('10.0.0.0/24\n10.0.2.0/24\n');
        assert.equal(rangesContain(set, v4('10.0.0.0')), true);
        assert.equal(rangesContain(set, v4('10.0.0.255')), true);
        assert.equal(rangesContain(set, v4('10.0.1.0')), false);
        assert.equal(rangesContain(set, v4('10.0.2.200')), true);
        assert.equal(rangesContain(set, v4('9.255.255.255')), false);
        assert.equal(rangesContain(null, 1), false);
    });
});

describe('lookupAnonymity', () => {
    it('answers listed / not-listed per list, with the list as source', () => {
        const hit = lookupAnonymity('185.220.101.1', tables());
        assert.deepEqual(hit.tor, { status: 'listed', source: TOR_EXIT_SOURCE, updatedAt: '2026-10-17T00:00:00Z' });
        assert.equal(hit.vpn.status, 'not-listed');
        assert.equal(hit.vpn.source, X4BNET_SOURCE);
        assert.equal(lookupAnonymity('203.0.113.9', tables()).vpn.status, 'listed');
        assert.equal(lookupAnonymity('192.0.2.200', tables()).datacenter.status, 'listed');
        assert.equal(lookupAnonymity('8.8.8.8', tables()).tor.status, 'not-listed');
    });

    it('says IPv6 is not covered and a missing list is unavailable — neither is a clearance', () => {
        const v6 = lookupAnonymity('2001:db8::1', tables());
        assert.equal(v6.tor.status, 'not-covered');
        assert.equal(v6.vpn.status, 'not-covered');
        const none = lookupAnonymity('185.220.101.1', { tor: null, vpn: null, datacenter: null });
        assert.equal(none.tor.status, 'unavailable');
        assert.equal(none.datacenter.status, 'unavailable');
    });

    it('ANONYMITY_LISTS=false turns every answer into unavailable', () => {
        process.env.ANONYMITY_LISTS = 'false';
        assert.equal(lookupAnonymity('185.220.101.1', tables()).tor.status, 'unavailable');
    });
});

describe('size caps', () => {
    const write = (name, text) => {
        const file = path.join(root, name);
        fs.writeFileSync(file, text);
        return file;
    };

    it('refuses a truncated Tor list, an HTML page, and accepts one at the floor', () => {
        assert.throws(() => validateTorExitFile(write('t1', '1.2.3.4\n')), /only 1 entries/);
        assert.throws(() => validateTorExitFile(write('t2', `${torList()}\n${'<p>x</p>\n'.repeat(100)}`)), /non-address lines/);
        assert.equal(validateTorExitFile(write('t3', torList())), LIST_LIMITS.tor.min);
    });

    it('refuses a truncated or oversized CIDR list', () => {
        assert.throws(() => validateCidrFile(write('c1', cidrList(10)), 'vpn'), /only 10 entries/);
        assert.equal(validateCidrFile(write('c2', cidrList(LIST_LIMITS.vpn.min)), 'vpn'), LIST_LIMITS.vpn.min);
        const big = write('c3', 'x');
        fs.truncateSync(big, LIST_LIMITS.maxBytes + 1);
        assert.throws(() => validateCidrFile(big, 'vpn'), /over the .* cap/);
    });
});

describe('dataset rows', () => {
    const row = (id) => datasets.find((dataset) => dataset.id === id);
    const tempRow = (id) => {
        const reloads = [];
        return { dataset: { ...row(id), dir: fs.mkdtempSync(path.join(root, `${id}-`)), reload: (r) => reloads.push(r) }, reloads };
    };
    const stub = (routes) => {
        const asked = [];
        globalThis.fetch = async (url, init = {}) => {
            asked.push(`${init.method || 'GET'} ${url}`);
            const [status, body, headers] = routes[String(url)] || [404, 'nope', {}];
            return new Response(init.method === 'HEAD' ? null : body, { status, headers });
        };
        return asked;
    };

    it('are key-free and on by default; ANONYMITY_LISTS=false switches both off', () => {
        delete process.env.ANONYMITY_LISTS;
        assert.equal(isRowEnabled(row('tor-exit')), true);
        assert.equal(isRowEnabled(row('x4bnet')), true);
        process.env.ANONYMITY_LISTS = 'false';
        assert.equal(isRowEnabled(row('tor-exit')), false);
        assert.equal(isRowEnabled(row('x4bnet')), false);
    });

    it('ask their readers whether a usable snapshot loaded', () => {
        assert.equal(row('tor-exit').isLoaded, isTorExitListLoaded);
        assert.equal(row('x4bnet').isLoaded, isX4bnetLoaded);
    });

    it('tor-exit: HEAD for the ETag, download, validate, publish; same ETag is not-modified', async () => {
        const asked = stub({ [TOR_EXIT_URL]: [200, torList(), { etag: '"v1"' }] });
        const { dataset, reloads } = tempRow('tor-exit');
        assert.deepEqual(await updateDataset(dataset), { updated: true, identifier: '"v1"' });
        assert.deepEqual(reloads, ['auto update']);
        assert.ok(fs.existsSync(path.join(dataset.dir, TOR_EXIT_FILE)));
        assert.deepEqual(await updateDataset(dataset), { updated: false, reason: 'not-modified' });
        assert.deepEqual(asked, [`HEAD ${TOR_EXIT_URL}`, `GET ${TOR_EXIT_URL}`, `HEAD ${TOR_EXIT_URL}`]);
    });

    it('tor-exit: a truncated download is refused and nothing is published', async () => {
        stub({ [TOR_EXIT_URL]: [200, '1.2.3.4\n', { etag: '"v2"' }] });
        const { dataset, reloads } = tempRow('tor-exit');
        await assert.rejects(updateDataset(dataset), /refusing to publish/);
        assert.deepEqual(reloads, []);
        assert.equal(fs.existsSync(path.join(dataset.dir, TOR_EXIT_FILE)), false);
    });

    it('x4bnet: both lists published together under one joined identifier', async () => {
        const [vpnList, dcList] = X4BNET_LISTS;
        stub({
            [vpnList.url]: [200, cidrList(LIST_LIMITS.vpn.min, 20), { etag: '"a"' }],
            [dcList.url]: [200, cidrList(LIST_LIMITS.datacenter.min, 30), { etag: '"b"' }],
        });
        const { dataset } = tempRow('x4bnet');
        assert.deepEqual(await updateDataset(dataset), { updated: true, identifier: '"a" | "b"' });
        const files = fs.readdirSync(dataset.dir).filter((f) => !f.startsWith('.')).sort();
        assert.deepEqual(files, [X4BNET_DATACENTER_FILE, X4BNET_VPN_FILE].sort());
    });

    it('x4bnet: one list below its floor refuses the pair', async () => {
        const [vpnList, dcList] = X4BNET_LISTS;
        stub({
            [vpnList.url]: [200, cidrList(LIST_LIMITS.vpn.min, 20), { etag: '"a"' }],
            [dcList.url]: [200, cidrList(10, 30), { etag: '"b"' }],
        });
        const { dataset } = tempRow('x4bnet');
        await assert.rejects(updateDataset(dataset), /datacenter list has only 10 entries/);
        assert.equal(fs.existsSync(path.join(dataset.dir, X4BNET_VPN_FILE)), false);
    });
});

describe('local-lists provider (opt-in scoring)', () => {
    it('is enabled only by TRUST_PROVIDERS=locallists', () => {
        process.env.TRUST_PROVIDERS = '';
        assert.equal(enabledProviders().some((p) => p.id === LOCAL_LISTS_SOURCE), false);
        process.env.TRUST_PROVIDERS = 'locallists';
        assert.deepEqual(enabledProviders().map((p) => p.id), [LOCAL_LISTS_SOURCE]);
    });

    it('votes only on a hit, except the exhaustive Tor list whose miss is false', async () => {
        const lookup = (ip) => lookupAnonymity(ip, tables());
        const tor = await askLocalLists('185.220.101.1', lookup);
        assert.equal(tor.status, 'ok');
        assert.equal(tor.authority, 'list');
        assert.equal(tor.isTor, true);
        assert.equal(tor.isVpn, null);
        const clean = await askLocalLists('8.8.8.8', lookup);
        assert.equal(clean.isTor, false);
        assert.equal(clean.isVpn, null, 'a curated list miss is silence, not a clearance');
        assert.equal(clean.isHosting, null);
        const vpn = await askLocalLists('203.0.113.9', lookup);
        assert.equal(vpn.isVpn, true);
        const v6 = await askLocalLists('2001:db8::1', lookup);
        assert.equal(v6.isTor, null);
    });

    it('answers unavailable when no list is loaded', async () => {
        const answer = await askLocalLists('1.2.3.4', (ip) => lookupAnonymity(ip, { tor: null, vpn: null, datacenter: null }));
        assert.equal(answer.status, 'unavailable');
    });
});

describe('dossier deep-risk slot', () => {
    it('keyed vendors make it ready; lists alone make it partial; nothing keeps the declared gap', () => {
        assert.equal(deepRiskSlot(true, null).status, 'ready');
        const partial = deepRiskSlot(false, lookupAnonymity('185.220.101.1', tables()));
        assert.equal(partial.status, 'partial');
        assert.deepEqual(partial.answered, ['tor', 'vpn', 'datacenter']);
        assert.deepEqual(partial.missing, ['proxy', 'botTrafficRatio']);
        assert.equal(partial.needs, SLOTS.deepRisk.needs);
        assert.equal(deepRiskSlot(false, lookupAnonymity('1.2.3.4', { tor: null, vpn: null, datacenter: null })), SLOTS.deepRisk);
        assert.equal(deepRiskSlot(false, lookupAnonymity('2001:db8::1', tables())), SLOTS.deepRisk);
    });
});
