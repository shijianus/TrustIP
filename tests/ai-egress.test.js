// The AI-egress page's data half: the published availability lists, and the
// measurement rules that decide what may be said about an exit address.
//
// What is under test is the honesty of the failure states, not the rendering: a row
// that could not be measured must not acquire a country, a verdict or a score, and
// a control that did not answer must withhold the split marker from every row.
// Vue rendering and real browser APIs are out of scope for this runner (see
// frontend/AGENTS.md), so `fetch` is stubbed and `performance.now` is Node's.

import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';

import {
    AI_EGRESS_SERVICES, AI_EGRESS_ALL, EGRESS_CONTROL, REGION_VERDICT,
    regionVerdict, nonCountryLoc,
} from '../common/ai-service-regions.js';
import {
    EGRESS_STATE, TRUST_STATE, traceFailureState, readTrace, readTrust,
    judgeSplit, judgeRow, useAiEgress,
} from '../frontend/composables/use-ai-egress.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// Answer by host: `responder(host)` returns a Response-shaped object, or throws.
const stubFetch = (responder) => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const host = new URL(url, 'https://trustmy.ip.example').host;
        calls.push({ url: String(url), host, init });
        const result = await responder(String(url), host);
        if (result instanceof Error) throw result;
        return result;
    };
    return calls;
};

const traceBody = (ip, extra = '') => `ip=${ip}\nloc=US\ncolo=LAX\nwarp=off${extra ? `\n${extra}` : ''}\nhttp=h2`;
const okResponse = (text, status = 200) => ({
    ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text),
});

// --- the availability lists ---------------------------------------------------

describe('ai-service-regions: the published lists', () => {
    it('carries three services and a control, each with a unique host', () => {
        assert.equal(AI_EGRESS_SERVICES.length, 3);
        const hosts = AI_EGRESS_ALL.map((row) => row.host);
        assert.equal(new Set(hosts).size, hosts.length);
        assert.equal(AI_EGRESS_ALL.at(-1).host, EGRESS_CONTROL.host);
    });

    // The transcription is the risky part of this file: two vendor lists of
    // human-written country names, matched against CLDR. A silently dropped name
    // would read as "this country is unsupported", so the size floor is the guard
    // against a partial transcription, and every code has to be a code.
    it('transcribed every list rather than most of it', () => {
        for (const service of AI_EGRESS_SERVICES) {
            if (service.regions.mode !== 'supported') continue;
            const codes = [...service.regions.codes];
            assert.ok(codes.length > 150, `${service.id}: ${codes.length} codes reads like a dropped tail`);
            assert.deepEqual(codes, [...codes].sort(), `${service.id}: codes are not sorted`);
            for (const code of codes) {
                assert.match(code, /^[A-Z]{2}$/, `${service.id}: ${code} is not alpha-2`);
            }
            assert.match(service.regions.source, /^https:\/\//, `${service.id}: no source to cite`);
            assert.match(service.regions.asOf, /^\d{4}-\d{2}-\d{2}$/, `${service.id}: an undated list is a stale list`);
        }
    });

    // Both providers exclude these by policy; a transcription that "supported" any
    // of them would be the more confident wrong answer.
    it('leaves the excluded countries out of both lists', () => {
        for (const code of ['CN', 'RU', 'IR', 'KP', 'SY', 'CU']) {
            for (const service of AI_EGRESS_SERVICES.filter((s) => s.regions.mode === 'supported')) {
                assert.ok(!service.regions.codes.has(code), `${service.id} lists ${code}`);
            }
        }
    });

    // The switch is a deployment fact, not a measurement: it is what makes the
    // difference between "not served" and "we could not read a list" meaningful.
    it('names its source even where it holds no list', () => {
        const gemini = AI_EGRESS_SERVICES.find((s) => s.id === 'gemini');
        assert.equal(gemini.regions.mode, 'unpublished');
        assert.equal(gemini.regions.codes, null);
        assert.match(gemini.regions.caveat, /Google/, 'the caveat should say whose policy this is');
    });
});

describe('regionVerdict', () => {
    const chatgpt = AI_EGRESS_SERVICES.find((s) => s.id === 'chatgpt');

    it('answers a listed country', () => {
        assert.equal(regionVerdict(chatgpt, 'US'), REGION_VERDICT.supported);
    });

    it('answers an unlisted country with the list, not with an inference', () => {
        assert.equal(regionVerdict(chatgpt, 'CN'), REGION_VERDICT.unsupported);
    });

    // The two `unknown`s are different facts and both have to stay sayable.
    it('stays unknown for a service that publishes no readable list', () => {
        const gemini = AI_EGRESS_SERVICES.find((s) => s.id === 'gemini');
        assert.equal(regionVerdict(gemini, 'US'), REGION_VERDICT.unknown);
        assert.equal(regionVerdict(gemini, 'CN'), REGION_VERDICT.unknown);
    });

    it('stays unknown for a value that names no country', () => {
        for (const loc of [null, undefined, '', '--', 'XX', 'ZZ', 'A1', 'T1', 'EU', 'x']) {
            assert.equal(regionVerdict(chatgpt, loc), REGION_VERDICT.unknown, `${JSON.stringify(loc)} is not a country`);
        }
    });

    it('tolerates the case a trace may arrive in', () => {
        assert.equal(regionVerdict(chatgpt, ' us '), REGION_VERDICT.supported);
    });

    it('separates an address annotation from an unknown country', () => {
        assert.equal(nonCountryLoc('A1'), 'addressAnnotation');
        assert.equal(nonCountryLoc('XX'), 'unknownCountry');
        assert.equal(nonCountryLoc('DE'), null, 'a real country is not a note');
        assert.equal(nonCountryLoc(null), null);
    });
});

// --- the trace ----------------------------------------------------------------

describe('readTrace', () => {
    it('reports the address, the country and the round trip', async () => {
        const calls = stubFetch(() => okResponse(traceBody('203.0.113.9')));
        const result = await readTrace('claude.ai');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://claude.ai/cdn-cgi/trace');
        assert.equal(result.state, EGRESS_STATE.answered);
        assert.equal(result.ip, '203.0.113.9');
        assert.equal(result.loc, 'US');
        assert.equal(result.colo, 'LAX');
    });

    it('asks for no cached answer', async () => {
        const calls = stubFetch(() => okResponse(traceBody('203.0.113.9')));
        await readTrace('chatgpt.com');
        assert.equal(calls[0].init.cache, 'no-store');
    });

    // A non-Cloudflare host is the ordinary case, and it is a structural fact about
    // the site rather than a failure of this lookup.
    it('calls a refusal no-endpoint', async () => {
        stubFetch(() => okResponse('not found', 404));
        assert.equal((await readTrace('gemini.google.com')).state, EGRESS_STATE.noEndpoint);
    });

    it('calls a 200 that names no address no-endpoint too', async () => {
        stubFetch(() => okResponse('colo=LAX\nwarp=off'));
        assert.equal((await readTrace('chatgpt.com')).state, EGRESS_STATE.noEndpoint);
        stubFetch(() => okResponse('ip=definitely-not-an-ip\nloc=US'));
        assert.equal((await readTrace('chatgpt.com')).state, EGRESS_STATE.noEndpoint);
    });

    it('keeps a timeout apart from a refusal', async () => {
        const abort = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
        stubFetch(() => abort);
        assert.equal((await readTrace('chatgpt.com')).state, EGRESS_STATE.timeout);
        assert.equal(traceFailureState(abort), EGRESS_STATE.timeout);
    });

    // A browser hands back the same opaque TypeError for a CORS refusal, a blocked
    // path and a dead NIC, so the state names the ambiguity instead of picking one.
    it('does not guess at why a fetch threw', async () => {
        const opaque = new TypeError('Failed to fetch');
        stubFetch(() => opaque);
        const result = await readTrace('chatgpt.com');
        assert.equal(result.state, EGRESS_STATE.blocked);
        assert.equal(traceFailureState(opaque), EGRESS_STATE.blocked);
    });
});

// --- the trust lookup ---------------------------------------------------------

describe('readTrust', () => {
    it('keeps only the fields the panel renders', async () => {
        const calls = stubFetch(() => okResponse(JSON.stringify({
            ip: '203.0.113.9', score: 61, band: 3, cls: 'datacenter',
            confidence: { measured: 7, total: 9, level: 'high' },
            generatedAt: '2026-10-11T00:00:00.000Z',
            signals: [{ id: 'registryClass', effect: -34 }],
        })));
        const trust = await readTrust('203.0.113.9');
        assert.equal(calls[0].url, '/api/trustscore?ip=203.0.113.9');
        assert.deepEqual(Object.keys(trust).sort(), ['band', 'cls', 'confidence', 'generatedAt', 'score']);
        assert.equal(trust.score, 61);
        assert.equal(trust.confidence, 'high');
        assert.equal(trust.signals, undefined, 'the weight table is not this page to ship');
    });

    it('answers null rather than zero when the score is unavailable', async () => {
        stubFetch(() => okResponse('{"error":"boom"}', 500));
        assert.equal(await readTrust('203.0.113.9'), null);
        stubFetch(() => Object.assign(new Error('aborted'), { name: 'AbortError' }));
        assert.equal(await readTrust('203.0.113.9'), null);
        stubFetch(() => okResponse(JSON.stringify({ score: null, band: null })));
        assert.equal((await readTrust('203.0.113.9')).score, null);
    });
});

// --- what may be said about a row --------------------------------------------

describe('judgeSplit', () => {
    it('withholds the verdict without a control address', () => {
        assert.equal(judgeSplit('203.0.113.9', null), null);
        assert.equal(judgeSplit(null, '203.0.113.9'), null);
        assert.equal(judgeSplit(null, null), null);
    });

    it('names a different address, and the same one', () => {
        assert.equal(judgeSplit('203.0.113.9', '203.0.113.10'), true);
        assert.equal(judgeSplit('203.0.113.9', '203.0.113.9'), false);
    });
});

describe('judgeRow', () => {
    const chatgpt = AI_EGRESS_SERVICES.find((s) => s.id === 'chatgpt');
    const trace = { state: EGRESS_STATE.answered, ip: '203.0.113.9', loc: 'US', colo: 'LAX', warp: 'off', ms: 12 };

    it('refuses to invent a country or a verdict for a row that did not answer', () => {
        for (const state of [EGRESS_STATE.noEndpoint, EGRESS_STATE.timeout, EGRESS_STATE.blocked, EGRESS_STATE.pending]) {
            const row = judgeRow(chatgpt, { state }, '203.0.113.1');
            assert.equal(row.state, state);
            assert.equal(row.ip, undefined);
            assert.equal(row.verdict, null);
            assert.equal(row.split, null);
        }
    });

    it('answers the availability verdict and the split marker together', () => {
        const row = judgeRow(chatgpt, trace, '203.0.113.1');
        assert.equal(row.verdict, REGION_VERDICT.supported);
        assert.equal(row.split, true);
    });

    // The control is a measurement, not a service: it has no availability list and
    // cannot be split from itself.
    it('gives the control row no verdict and no split claim', () => {
        const control = judgeRow(EGRESS_CONTROL, trace, '203.0.113.9');
        assert.equal(control.verdict, null);
        assert.equal(control.split, false);
        assert.equal(control.ip, '203.0.113.9');
    });

    it('carries the non-country note through', () => {
        const row = judgeRow(chatgpt, { ...trace, loc: 'A1' }, '203.0.113.9');
        assert.equal(row.locNote, 'addressAnnotation');
        assert.equal(row.verdict, REGION_VERDICT.unknown);
    });
});

// --- the run ------------------------------------------------------------------

describe('useAiEgress', () => {
    const score = (ip) => okResponse(JSON.stringify({
        score: 44, band: 2, cls: 'datacenter', confidence: { level: 'medium' }, generatedAt: 'now', ip,
    }));

    it('measures every row, scores each distinct exit once, and marks the split', async () => {
        const exits = {
            'chatgpt.com': '203.0.113.20',
            'claude.ai': '203.0.113.20',
            'gemini.google.com': null,
            '1.0.0.1': '203.0.113.21',
        };
        const calls = stubFetch((url, host) => {
            if (url.startsWith('/api/trustscore')) return score(url);
            const ip = exits[host];
            return ip === null ? okResponse('nope', 404) : okResponse(traceBody(ip));
        });

        const { rows, run, controlIp, splitSeen } = useAiEgress();
        await run();

        assert.equal(controlIp.value, '203.0.113.21');
        const byId = Object.fromEntries(rows.value.map((row) => [row.id, row]));
        assert.equal(byId.chatgpt.split, true);
        assert.equal(byId.claude.split, true);
        assert.equal(byId.gemini.state, EGRESS_STATE.noEndpoint);
        assert.equal(byId.gemini.verdict, null, 'a row with no address gets no verdict');
        assert.equal(byId.cloudflare.verdict, null, 'the control is not a service');
        assert.equal(splitSeen.value, true);

        // Two services on one exit are one address: the score is asked per distinct
        // echo, not per row, and the control's own exit is the third one.
        const scored = calls.filter((c) => c.url.startsWith('/api/trustscore')).map((c) => c.url);
        assert.equal(scored.length, 2, `expected one lookup per distinct address, saw ${scored.join(' ')}`);
        assert.ok(byId.chatgpt.trustState === TRUST_STATE.ready);
        assert.equal(byId.chatgpt.trust.score, 44);
    });

    // The whole point of the control row: without it there is no statement about
    // splitting, and "not comparable" must not degrade into "same exit".
    it('withholds every split marker when the control cannot be asked', async () => {
        stubFetch((url, host) => (host === '1.0.0.1'
            ? Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })
            : okResponse(traceBody('203.0.113.30'))));

        const { rows, run, controlIp, splitSeen } = useAiEgress();
        await run();

        assert.equal(controlIp.value, null);
        assert.equal(splitSeen.value, false);
        for (const row of rows.value) {
            if (row.state !== EGRESS_STATE.answered) continue;
            assert.equal(row.split, null, `${row.id}: split asserted without a ruler`);
        }
    });

    it('does not start a second pass while one is running', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const calls = stubFetch(async (url) => { await gate; return okResponse(traceBody('203.0.113.40')); });

        const { run, running } = useAiEgress();
        const first = run();
        const second = run();
        assert.equal(running.value, true);
        release();
        await Promise.all([first, second]);
        assert.equal(calls.filter((c) => c.url.endsWith('/cdn-cgi/trace')).length, AI_EGRESS_ALL.length);
    });
});
