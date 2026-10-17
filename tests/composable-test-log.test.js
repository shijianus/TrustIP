// The test-process log (frontend/composables/use-test-log.js): record building
// with an injected clock, the verdict rules every test page leans on, the text
// and JSON exports, and the extra-STUN parser behind the documented test flag.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    TEST_LOG_SCHEMA, MAX_STEPS,
    useTestLog, createLogRecord, appendStep, summarizeSteps,
    describeCandidate, isMdnsAddress, webrtcVerdict, dnsLeakVerdict,
    traceOutcome, formatLogText, exportRecord, errorText, safeRaw,
    verdictTone, verdictKey, stepTone,
} from '../frontend/composables/use-test-log.js';
import { parseExtraStun, probeServers, STUN_PROBE_SERVERS, STUN_SERVERS } from '../frontend/utils/webrtc-ice.js';
import { probeStepsOf } from '../frontend/composables/use-globalping-measurement.js';
import { splitRowStep } from '../frontend/composables/use-site-split.js';

// A clock the test moves by hand.
const fakeClock = (start = 1000) => {
    let now = start;
    return { clock: () => now, advance: (ms) => { now += ms; }, wall: () => Date.UTC(2026, 9, 15, 11, 0, 0) };
};

describe('useTestLog — record lifecycle', () => {
    it('begins a record with schema, ISO start, meta and no private origin in the export', () => {
        const c = fakeClock();
        const log = useTestLog('webrtc', c);
        log.begin({ servers: 'a, b' });
        const out = log.toJSON();
        assert.equal(out.schema, TEST_LOG_SCHEMA);
        assert.equal(out.test, 'webrtc');
        assert.equal(out.startedAt, '2026-10-15T11:00:00.000Z');
        assert.deepEqual(out.meta, { servers: 'a, b' });
        assert.equal('_t0' in out, false);
    });

    it('timestamps steps from the start and measures a timed step', async () => {
        const c = fakeClock();
        const log = useTestLog('x', c);
        log.begin();
        c.advance(5);
        const value = await log.timed({ kind: 'trace', target: 'h', endpoint: 'https://h/cdn-cgi/trace', protocol: 'HTTPS GET' }, async () => {
            c.advance(42);
            return { state: 'answered', ip: '198.51.100.7', loc: 'JP', colo: 'NRT' };
        }, traceOutcome);
        assert.equal(value.ip, '198.51.100.7');
        const [step] = log.record.value.steps;
        assert.equal(step.seq, 1);
        assert.equal(step.at, 5);
        assert.equal(step.durationMs, 42);
        assert.equal(step.result, 'ok');
        assert.equal(step.value, '198.51.100.7 · JP · NRT');
        assert.equal(step.endpoint, 'https://h/cdn-cgi/trace');
    });

    it('a throwing call is recorded as fail and re-thrown unchanged', async () => {
        const log = useTestLog('x', fakeClock());
        log.begin();
        const boom = new TypeError('Failed to fetch');
        await assert.rejects(log.timed({ kind: 'http' }, async () => { throw boom; }), (e) => e === boom);
        const [step] = log.record.value.steps;
        assert.equal(step.result, 'fail');
        assert.equal(step.error, 'TypeError: Failed to fetch');
    });

    it('an AbortError is recorded as a timeout', async () => {
        const log = useTestLog('x', fakeClock());
        log.begin();
        const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
        await assert.rejects(log.timed({ kind: 'http' }, async () => { throw abort; }));
        assert.equal(log.record.value.steps[0].result, 'timeout');
    });

    it('a handle from a superseded run closes nothing in the new record', () => {
        const c = fakeClock();
        const log = useTestLog('x', c);
        log.begin();
        const stale = log.open({ kind: 'http', target: 'old' });
        log.begin();
        const fresh = log.open({ kind: 'http', target: 'new' });
        assert.equal(stale.end({ result: 'ok' }), null);
        fresh.end({ result: 'fail', error: 'nope' });
        assert.equal(log.record.value.steps.length, 1);
        assert.equal(log.record.value.steps[0].target, 'new');
        assert.equal(log.record.value.steps[0].result, 'fail');
    });

    it('finish stamps duration and verdict; add before begin starts a record', () => {
        const c = fakeClock();
        const log = useTestLog('x', c);
        log.add({ kind: 'env', result: 'info' });
        c.advance(120);
        log.finish({ verdict: 'pass', reason: 'allOk', params: { ok: 1, total: 1 } });
        const out = log.toJSON();
        assert.equal(out.durationMs, 120);
        assert.deepEqual(out.verdict, { verdict: 'pass', reason: 'allOk', params: { ok: 1, total: 1 } });
        assert.ok(out.finishedAt);
    });

    it('caps the step list and counts what it dropped', () => {
        const rec = createLogRecord('x', { startMs: 0 });
        for (let i = 0; i < MAX_STEPS + 3; i++) appendStep(rec, { kind: 'http', result: 'ok' }, i);
        assert.equal(rec.steps.length, MAX_STEPS);
        assert.equal(rec.truncated, 3);
    });

    it('unknown result codes fall back to info and every step has the same columns', () => {
        const rec = createLogRecord('x');
        const step = appendStep(rec, { kind: 'k', result: 'weird' }, 0);
        assert.equal(step.result, 'info');
        assert.deepEqual(Object.keys(step).sort(), ['at', 'durationMs', 'endpoint', 'error', 'kind', 'note', 'protocol', 'raw', 'result', 'seq', 'target', 'value'].sort());
    });
});

describe('summarizeSteps', () => {
    const s = (result, kind = 'http') => ({ kind, result });
    it('no measured step is inconclusive', () => {
        assert.equal(summarizeSteps([s('info'), s('skip')]).verdict, 'inconclusive');
        assert.equal(summarizeSteps([]).reason, 'noSteps');
    });
    it('all ok passes, none fails, some is partial with counts', () => {
        assert.deepEqual(summarizeSteps([s('ok'), s('ok')]), { verdict: 'pass', reason: 'allOk', params: { ok: 2, total: 2, failed: 0 } });
        assert.equal(summarizeSteps([s('fail'), s('timeout')]).verdict, 'fail');
        assert.deepEqual(summarizeSteps([s('ok'), s('timeout'), s('fail')]).params, { ok: 1, total: 3, failed: 2 });
    });
    it('only the named kinds count', () => {
        const steps = [s('ok', 'trace'), s('fail', 'trust')];
        assert.equal(summarizeSteps(steps, { kinds: ['trace'] }).verdict, 'pass');
    });
});

describe('describeCandidate', () => {
    it('classifies mDNS, IPv4, IPv6 and the public boundary', () => {
        assert.equal(isMdnsAddress('3f1c-uuid.local'), true);
        assert.equal(describeCandidate({ type: 'host', address: '3f1c-uuid.local', ip: null }).family, 'mdns');
        const v4 = describeCandidate({ type: 'srflx', address: '8.8.8.8', ip: '8.8.8.8', protocol: 'udp', port: '5000' });
        assert.equal(v4.family, 'ipv4');
        assert.equal(v4.public, true);
        assert.equal(describeCandidate({ type: 'srflx', ip: '10.0.0.5', address: '10.0.0.5' }).public, false);
        assert.equal(describeCandidate({ type: 'host', ip: '2001:4860:4860::8888', address: '2001:4860:4860::8888' }).family, 'ipv6');
    });
});

describe('webrtcVerdict', () => {
    const probe = (...candidates) => ({ server: { id: 's' }, ok: true, candidates });
    const host = { type: 'host', address: 'abc.local', ip: null };
    const srflx = (ip) => ({ type: 'srflx', address: ip, ip });

    it('WebRTC unavailable is no-leak', () => {
        assert.deepEqual(webrtcVerdict({ available: false }), { verdict: 'no-leak', reason: 'webrtcDisabled', params: { servers: 0 } });
    });
    it('a public reflexive address that is not an HTTP exit is a leak, naming the address', () => {
        const v = webrtcVerdict({ probes: [probe(host, srflx('203.0.113.9'))], egressIps: ['198.51.100.1'] });
        // 203.0.113.0/24 is documentation space, not a usable public address: it
        // reads as a private reflexive answer, never as a leak.
        assert.equal(v.reason, 'webrtcPrivateOnly');
        const leak = webrtcVerdict({ probes: [probe(host, srflx('8.8.4.4'))], egressIps: ['1.1.1.1'] });
        assert.equal(leak.verdict, 'leak');
        assert.equal(leak.reason, 'webrtcIpDiffers');
        assert.equal(leak.params.ips, '8.8.4.4');
        assert.equal(leak.params.egress, '1.1.1.1');
    });
    it('a public reflexive address equal to the HTTP exit is no-leak', () => {
        const v = webrtcVerdict({ probes: [probe(srflx('8.8.4.4')), probe(srflx('8.8.4.4'))], egressIps: ['8.8.4.4', '2001:4860::1'] });
        assert.equal(v.verdict, 'no-leak');
        assert.equal(v.reason, 'webrtcMatchesEgress');
        assert.equal(v.params.answered, 2);
    });
    it('a public host candidate that differs from the exit is also a leak', () => {
        const v = webrtcVerdict({ probes: [probe({ type: 'host', address: '8.8.4.4', ip: '8.8.4.4' })], egressIps: ['1.1.1.1'] });
        assert.equal(v.verdict, 'leak');
    });
    it('a public address with no egress answer is inconclusive', () => {
        assert.equal(webrtcVerdict({ probes: [probe(srflx('8.8.4.4'))], egressIps: [] }).reason, 'webrtcNoEgress');
    });
    it('no reflexive candidate anywhere is inconclusive: UDP blocked (proxy mode)', () => {
        const v = webrtcVerdict({ probes: [probe(host), probe(), probe(host)], egressIps: ['1.1.1.1'] });
        assert.equal(v.verdict, 'inconclusive');
        assert.equal(v.reason, 'webrtcUdpBlocked');
        assert.equal(v.params.servers, 3);
        assert.equal(v.params.answered, 0);
        assert.equal(v.params.mdns, 2);
    });
    it('only private reflexive addresses (a LAN STUN server) is no-leak', () => {
        const v = webrtcVerdict({ probes: [probe(host, srflx('10.0.0.5'))], egressIps: ['1.1.1.1'] });
        assert.equal(v.verdict, 'no-leak');
        assert.equal(v.reason, 'webrtcPrivateOnly');
        assert.equal(v.params.ips, '10.0.0.5');
    });
    it('a relay address is never counted as the visitor', () => {
        const v = webrtcVerdict({ probes: [probe({ type: 'relay', address: '8.8.4.4', ip: '8.8.4.4' })], egressIps: ['1.1.1.1'] });
        assert.notEqual(v.verdict, 'leak');
    });
});

describe('dnsLeakVerdict', () => {
    it('no resolvers / no egress / no geo are inconclusive with distinct reasons', () => {
        assert.equal(dnsLeakVerdict({}).reason, 'dnsNoResolvers');
        assert.equal(dnsLeakVerdict({ resolvers: [{ ip: '8.8.8.8', country_code: 'us' }] }).reason, 'dnsNoEgress');
        assert.equal(dnsLeakVerdict({ resolvers: [{ ip: '8.8.8.8' }], egressCountry: 'JP' }).reason, 'dnsNoGeo');
    });
    it('a resolver in another country than the HTTP exit is a leak (case-insensitive)', () => {
        const v = dnsLeakVerdict({ resolvers: [{ ip: '1.1.1.1', country_code: 'jp' }, { ip: '114.114.114.114', country_code: 'cn' }], egressCountry: 'JP' });
        assert.equal(v.verdict, 'leak');
        assert.equal(v.params.foreign, 'CN');
    });
    it('all resolvers in the exit country is no-leak', () => {
        assert.equal(dnsLeakVerdict({ resolvers: [{ ip: '1.1.1.1', country_code: 'US' }], egressCountry: 'us' }).verdict, 'no-leak');
    });
});

describe('outcomes, tones and export', () => {
    it('traceOutcome maps every readTrace state', () => {
        assert.equal(traceOutcome({ state: 'timeout' }).result, 'timeout');
        assert.equal(traceOutcome({ state: 'blocked' }).error, 'blocked');
        assert.equal(traceOutcome(null).result, 'fail');
        assert.equal(traceOutcome({ ip: '1.1.1.1', loc: 'US' }).result, 'ok');
    });
    it('tones and locale keys', () => {
        assert.equal(verdictTone('leak'), 'bad');
        assert.equal(verdictTone('no-leak'), 'ok');
        assert.equal(verdictTone('nonsense'), 'muted');
        assert.equal(verdictKey('no-leak'), 'noLeak');
        assert.equal(stepTone('timeout'), 'warn');
    });
    it('errorText and safeRaw never throw on awkward values', () => {
        assert.equal(errorText(null), null);
        assert.equal(errorText(new Error('x')), 'x');
        const cyclic = {}; cyclic.self = cyclic;
        assert.equal(typeof safeRaw(cyclic), 'string');
        assert.deepEqual(safeRaw({ a: 1n }), { a: '1' });
    });
    it('formatLogText renders verdict, reason with params and every step', () => {
        const c = fakeClock();
        const log = useTestLog('dnsleak', c);
        log.begin({ providers: 'p' });
        log.add({ kind: 'dns', target: 'ip-api.com', endpoint: 'https://x/json', protocol: 'DNS → HTTPS GET', result: 'ok', value: '8.8.8.8', durationMs: 33 });
        log.add({ kind: 'egress', result: 'fail', error: 'blocked' });
        log.finish({ verdict: 'no-leak', reason: 'dnsSameCountry', params: { egress: 'US' } });
        const tr = (key, params) => (params && Object.keys(params).length ? `${key}${JSON.stringify(params)}` : key);
        const text = formatLogText(log.record.value, tr);
        assert.match(text, /testlog\.verdict\.noLeak/);
        assert.match(text, /testlog\.reason\.dnsSameCountry\{"egress":"US"\}/);
        assert.match(text, /#1 \+0ms \[ok\] testlog\.kind\.dns \(33 ms\) — ip-api\.com \| https:\/\/x\/json \| DNS → HTTPS GET/);
        assert.match(text, / {4}→ 8\.8\.8\.8/);
        assert.match(text, / {4}✗ blocked/);
        assert.equal(exportRecord(null), null);
    });
});

describe('extra STUN servers (test-only flag)', () => {
    it('parses host:port entries and drops anything else', () => {
        assert.deepEqual(parseExtraStun('127.0.0.1:3478, 127.0.0.1:3479,bad,:1,[::1]:3478,stun:evil.com:1,a b:3'), [
            { id: 'test-1', url: '127.0.0.1:3478', testOnly: true },
            { id: 'test-2', url: '127.0.0.1:3479', testOnly: true },
            { id: 'test-3', url: '[::1]:3478', testOnly: true },
        ]);
        assert.deepEqual(parseExtraStun(''), []);
        assert.deepEqual(parseExtraStun(undefined), []);
    });
    it('only ever appends: the public servers stay first and unchanged', () => {
        assert.deepEqual(probeServers(''), STUN_PROBE_SERVERS);
        const withExtra = probeServers('127.0.0.1:3478');
        assert.deepEqual(withExtra.slice(0, STUN_PROBE_SERVERS.length), STUN_PROBE_SERVERS);
        assert.equal(withExtra.at(-1).url, '127.0.0.1:3478');
        // The cards' list is not touched by the probe matrix.
        assert.deepEqual(STUN_PROBE_SERVERS.slice(0, STUN_SERVERS.length), STUN_SERVERS);
    });
});

describe('per-test step builders', () => {
    it('probeStepsOf turns Globalping results into probe steps', () => {
        const data = { results: [
            { probe: { country: 'JP', city: 'Tokyo', network: 'Net' }, result: { status: 'finished', stats: { min: 1, avg: 2, max: 3, loss: 0 } } },
            { probe: { country: 'DE', asn: 3320 }, result: { status: 'failed', rawOutput: 'ping: unknown host\nmore' } },
            { probe: { country: 'US' }, result: { status: 'in-progress' } },
        ] };
        const steps = probeStepsOf(data, 'ping');
        assert.equal(steps.length, 3);
        assert.equal(steps[0].result, 'ok');
        assert.equal(steps[0].target, 'JP · Tokyo · Net');
        assert.match(steps[0].value, /avg 2/);
        assert.equal(steps[1].result, 'fail');
        assert.equal(steps[1].error, 'ping: unknown host');
        assert.equal(steps[1].target, 'DE · AS3320');
        assert.equal(steps[2].result, 'timeout');
        assert.deepEqual(probeStepsOf(null, 'ping'), []);
    });
    it('splitRowStep describes a trace row and a latency fallback', () => {
        const trace = splitRowStep({ host: 'a.com', measured: 'trace', ip: '1.1.1.1', loc: 'US', colo: 'SJC' }, 12.4);
        assert.equal(trace.kind, 'trace');
        assert.equal(trace.durationMs, 12.4);
        assert.equal(trace.value, '1.1.1.1 · US · SJC');
        const latency = splitRowStep({ host: 'b.com', method: 'auto', measured: 'latency', reachable: false, ms: null, dots: [{ ok: false }, { ok: false }] }, 900);
        assert.equal(latency.kind, 'latency');
        assert.equal(latency.result, 'fail');
        assert.equal(latency.value, '0/2');
        assert.ok(latency.note);
        // No hardcoded English: the note is a locale key, localized when `t` is given.
        assert.equal(latency.note, 'siteSplitLog.noTraceFallback');
        const localized = splitRowStep({ host: 'b.com', method: 'auto', measured: 'latency', reachable: true, ms: 40, dots: [{ ok: true }] }, 50, (k) => `T(${k})`);
        assert.equal(localized.note, 'T(siteSplitLog.noTraceFallback)');
        assert.equal(splitRowStep({ host: 'c.com', method: 'ping', measured: 'latency', dots: [] }, 1).note, null);
    });
});
