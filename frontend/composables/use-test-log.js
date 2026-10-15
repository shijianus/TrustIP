// The visitor-readable record of one test run: what was asked, of whom, over
// which protocol, how long it took, what came back — and, at the end, one
// plain-language verdict that says why.
//
// Every client-side test on this site measures something the visitor cannot see
// happen: a STUN binding, a DNS lookup made by an <img>, a no-cors GET whose body
// the browser hides. A result card states the conclusion; this record is the
// evidence under it, in the same shape everywhere (`widgets/TestRunLog.vue`
// renders it, copies it, exports it), so "why does it say that" has one answer
// per test instead of one per component.
//
// Split in two on purpose:
//   - pure functions (record building, verdict rules, text export) — tested under
//     `node --test` with an injected clock, no Vue needed;
//   - `useTestLog()` — the thin reactive wrapper a component holds.
//
// A verdict is a code plus a reason key and its parameters, never a sentence: the
// component translates `testlog.reason.<reason>` so the exported JSON stays
// locale-free and comparable between two visitors' runs.

import { shallowRef, triggerRef } from 'vue';
import { isUsablePublicIP } from '../utils/valid-ip.js';

export const TEST_LOG_SCHEMA = 'trustip.test-log/1';

// One step's outcome. `running` only exists between `begin` and `end` of a timed
// step; an exported log never carries it unless the run was cut short.
export const STEP_RESULTS = ['ok', 'fail', 'timeout', 'skip', 'info', 'running'];

// The whole verdict vocabulary. Leak tests answer the first three; everything
// else answers pass / partial / fail. `inconclusive` is shared: a run that could
// not measure says so rather than borrowing either answer.
export const VERDICTS = ['leak', 'no-leak', 'inconclusive', 'pass', 'partial', 'fail'];

// The cap keeps a ten-round connectivity pass over a big custom list from turning
// the log into the slowest thing on the page. The record says it was truncated.
export const MAX_STEPS = 600;

const defaultClock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
const defaultWall = () => Date.now();

// Locale key segment for a verdict code (`no-leak` → `noLeak`): vue-i18n paths
// read best without a hyphen, while the exported code stays as written.
export const verdictKey = (verdict) => String(verdict || '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// `VerdictChip` tone for a verdict: the same colour language as the rest of the app.
export const verdictTone = (verdict) => ({
    leak: 'bad',
    'no-leak': 'ok',
    pass: 'ok',
    partial: 'warn',
    fail: 'bad',
    inconclusive: 'muted',
}[verdict] || 'muted');

export const stepTone = (result) => ({
    ok: 'ok',
    fail: 'bad',
    timeout: 'warn',
    skip: 'muted',
    info: 'info',
    running: 'info',
}[result] || 'muted');

// Error objects do not survive JSON.stringify; a step keeps the name and message
// a visitor (or an issue report) can actually read.
export const errorText = (error) => {
    if (error == null || error === '') return null;
    if (typeof error === 'string') return error;
    const name = error.name && error.name !== 'Error' ? `${error.name}: ` : '';
    return `${name}${error.message || String(error)}`;
};

// Raw values go into an exported file and a <pre>: anything that would not
// round-trip through JSON (functions, DOM nodes, cycles) is replaced, not thrown.
export const safeRaw = (value) => {
    if (value === undefined) return null;
    try {
        return JSON.parse(JSON.stringify(value, (key, v) => (typeof v === 'bigint' ? String(v) : v)));
    } catch {
        return String(value);
    }
};

/**
 * A fresh, empty record.
 * @param {string} test   stable id of the test (`webrtc`, `dnsleak`, …)
 * @param {object} [opts] { meta, wallMs, startMs }
 */
export const createLogRecord = (test, { meta = {}, wallMs = Date.now(), startMs = 0 } = {}) => ({
    schema: TEST_LOG_SCHEMA,
    test,
    startedAt: new Date(wallMs).toISOString(),
    finishedAt: null,
    durationMs: null,
    meta: safeRaw(meta) || {},
    steps: [],
    truncated: 0,
    verdict: null,
    // Not exported: the monotonic origin every step's `at` is measured from.
    _t0: startMs,
});

const round = (n) => (Number.isFinite(n) ? Math.round(n) : null);

/**
 * Append one step. Fields a caller does not know stay null rather than absent, so
 * every exported step has the same columns.
 */
export const appendStep = (record, fields, nowMs) => {
    if (record.steps.length >= MAX_STEPS) {
        record.truncated += 1;
        return null;
    }
    const step = {
        seq: record.steps.length + 1,
        at: round(nowMs - record._t0),
        kind: fields.kind || 'step',
        target: fields.target ?? null,
        endpoint: fields.endpoint ?? null,
        protocol: fields.protocol ?? null,
        durationMs: fields.durationMs == null ? null : round(fields.durationMs),
        result: STEP_RESULTS.includes(fields.result) ? fields.result : 'info',
        value: fields.value == null ? null : String(fields.value),
        error: errorText(fields.error),
        note: fields.note ?? null,
        raw: fields.raw === undefined ? null : safeRaw(fields.raw),
    };
    record.steps.push(step);
    return step;
};

/**
 * Close a step opened as `running`. `outcome` carries result / value / error /
 * raw / note; the duration is measured, never supplied.
 */
export const closeStep = (step, outcome, nowMs, record) => {
    if (!step) return null;
    const startedAt = record._t0 + (step.at || 0);
    step.durationMs = round(nowMs - startedAt);
    step.result = STEP_RESULTS.includes(outcome?.result) ? outcome.result : 'ok';
    if (outcome?.value !== undefined) step.value = outcome.value == null ? null : String(outcome.value);
    if (outcome?.error !== undefined) step.error = errorText(outcome.error);
    if (outcome?.raw !== undefined) step.raw = safeRaw(outcome.raw);
    if (outcome?.note !== undefined) step.note = outcome.note;
    if (outcome?.target !== undefined) step.target = outcome.target;
    return step;
};

// ── Verdict rules ──────────────────────────────────────────────────────────────

/**
 * The generic verdict for tests that answer "did it work": all measured steps ok
 * is a pass, none is a fail, some is partial. Only steps of the given kinds count
 * (an `info` line about the environment is not a measurement).
 */
export const summarizeSteps = (steps, { kinds = null } = {}) => {
    const measured = (steps || []).filter((s) => ['ok', 'fail', 'timeout'].includes(s.result)
        && (!kinds || kinds.includes(s.kind)));
    const total = measured.length;
    const ok = measured.filter((s) => s.result === 'ok').length;
    const failed = total - ok;
    if (!total) return { verdict: 'inconclusive', reason: 'noSteps', params: { ok: 0, total: 0, failed: 0 } };
    if (ok === total) return { verdict: 'pass', reason: 'allOk', params: { ok, total, failed } };
    if (!ok) return { verdict: 'fail', reason: 'allFailed', params: { ok, total, failed } };
    return { verdict: 'partial', reason: 'someFailed', params: { ok, total, failed } };
};

// mDNS host candidates are `<uuid>.local`: the browser hiding the LAN address.
export const isMdnsAddress = (address) => /\.local\.?$/i.test(String(address || ''));

/**
 * One ICE candidate, described the way the probe table reads it.
 * `family` is ipv4 / ipv6 / mdns / unknown; `public` follows the single
 * definition of "an address the internet can see" the backend guards use.
 */
export const describeCandidate = (candidate) => {
    const address = candidate?.address || candidate?.ip || null;
    const ip = candidate?.ip || null;
    let family = 'unknown';
    if (isMdnsAddress(address)) family = 'mdns';
    else if (ip && ip.includes(':')) family = 'ipv6';
    else if (ip) family = 'ipv4';
    return {
        type: candidate?.type || 'unknown',
        address,
        ip,
        family,
        protocol: candidate?.protocol || null,
        port: candidate?.port || null,
        public: Boolean(ip) && isUsablePublicIP(ip),
    };
};

/**
 * WebRTC verdict over every STUN server's candidates, compared with the address
 * HTTP traffic leaves from.
 *
 * @param {object} input
 * @param {boolean} input.available     RTCPeerConnection usable in this browser
 * @param {Array}   input.probes        [{ server, ok, reason, candidates: [...] }]
 * @param {Array}   input.egressIps     addresses HTTP echoes reported (may be [])
 * @returns {{verdict, reason, params}}
 *
 * The rules, in order:
 *  1. no WebRTC at all → no-leak (`webrtcDisabled`): nothing can leak through an API
 *     the browser does not have.
 *  2. a public candidate address that is not one of the HTTP exits → leak
 *     (`webrtcIpDiffers`) — the textbook WebRTC leak behind a proxy / VPN.
 *  3. no egress address to compare with, but a public address appeared →
 *     inconclusive (`webrtcNoEgress`): we cannot say whether it differs.
 *  4. public addresses that all match the exits → no-leak (`webrtcMatchesEgress`).
 *  5. no server reflected anything (no srflx / prflx) → inconclusive
 *     (`webrtcUdpBlocked`): UDP to STUN is blocked — typical of a proxy-mode
 *     client or a firewall — so this network cannot leak via STUN *now*, but the
 *     same browser on another network could.
 *  6. only private reflexive addresses → no-leak (`webrtcPrivateOnly`).
 */
export const webrtcVerdict = ({ available = true, probes = [], egressIps = [] } = {}) => {
    const servers = probes.length;
    if (!available) return { verdict: 'no-leak', reason: 'webrtcDisabled', params: { servers } };
    const all = probes.flatMap((p) => (p.candidates || []).map(describeCandidate));
    const reflexive = all.filter((c) => c.type === 'srflx' || c.type === 'prflx');
    const answered = probes.filter((p) => (p.candidates || []).some((c) => c.type === 'srflx' || c.type === 'prflx')).length;
    const publicIps = [...new Set(all.filter((c) => c.public && c.type !== 'relay').map((c) => c.ip))];
    const exits = [...new Set((egressIps || []).filter(Boolean))];
    const mdns = all.filter((c) => c.family === 'mdns').length;
    const base = { servers, answered, mdns, egress: exits.join(', ') || '—' };

    if (publicIps.length && exits.length) {
        const differing = publicIps.filter((ip) => !exits.includes(ip));
        if (differing.length) return { verdict: 'leak', reason: 'webrtcIpDiffers', params: { ...base, ips: differing.join(', ') } };
        return { verdict: 'no-leak', reason: 'webrtcMatchesEgress', params: { ...base, ips: publicIps.join(', ') } };
    }
    if (publicIps.length) return { verdict: 'inconclusive', reason: 'webrtcNoEgress', params: { ...base, ips: publicIps.join(', ') } };
    if (!reflexive.length) return { verdict: 'inconclusive', reason: 'webrtcUdpBlocked', params: base };
    return {
        verdict: 'no-leak',
        reason: 'webrtcPrivateOnly',
        params: { ...base, ips: [...new Set(reflexive.map((c) => c.ip || c.address))].join(', ') },
    };
};

/**
 * DNS leak verdict: which resolvers answered, against where HTTP traffic exits.
 * A resolver in another country than the HTTP exit is the visible half of a DNS
 * leak (queries going out through the local ISP while traffic rides a tunnel).
 *
 * @param {object} input
 * @param {Array}  input.resolvers  [{ ip, country_code }]
 * @param {string} input.egressCountry  ISO code the HTTP exit geolocates to ('' unknown)
 */
export const dnsLeakVerdict = ({ resolvers = [], egressCountry = '' } = {}) => {
    const seen = (resolvers || []).filter((r) => r && r.ip);
    const countries = [...new Set(seen.map((r) => String(r.country_code || '').toUpperCase()).filter(Boolean))];
    const params = { resolvers: seen.length, countries: countries.join(', ') || '—', egress: egressCountry || '—' };
    if (!seen.length) return { verdict: 'inconclusive', reason: 'dnsNoResolvers', params };
    if (!egressCountry) return { verdict: 'inconclusive', reason: 'dnsNoEgress', params };
    const egress = egressCountry.toUpperCase();
    const foreign = countries.filter((cc) => cc !== egress);
    if (foreign.length) return { verdict: 'leak', reason: 'dnsCountryDiffers', params: { ...params, foreign: foreign.join(', ') } };
    if (!countries.length) return { verdict: 'inconclusive', reason: 'dnsNoGeo', params };
    return { verdict: 'no-leak', reason: 'dnsSameCountry', params };
};

// ── Shared step descriptions ──────────────────────────────────────────────────

/**
 * A `/cdn-cgi/trace` echo (`readTrace` in use-ai-egress.js, or any `{ state, ip, loc,
 * colo }` answer) as a step outcome.
 */
export const traceOutcome = (answer) => {
    if (answer?.state === 'answered' || (answer?.ip && !answer?.state)) {
        return {
            result: 'ok',
            value: [answer.ip, answer.loc, answer.colo].filter(Boolean).join(' · '),
            raw: answer,
        };
    }
    if (answer?.state === 'timeout') return { result: 'timeout', error: 'timeout', raw: answer };
    return { result: 'fail', error: answer?.state || 'no answer', raw: answer ?? null };
};

// ── Text export ───────────────────────────────────────────────────────────────

/**
 * Plain-text rendering for "copy as text". `tr(key, params)` translates; a test
 * without vue-i18n can pass an identity function.
 */
export const formatLogText = (record, tr = (key) => key) => {
    if (!record) return '';
    const lines = [];
    lines.push(`# ${tr('testlog.Title')} — ${record.test}`);
    lines.push(`${tr('testlog.StartedAt')}: ${record.startedAt}`);
    if (record.durationMs != null) lines.push(`${tr('testlog.Duration')}: ${record.durationMs} ms`);
    const metaEntries = Object.entries(record.meta || {});
    for (const [key, value] of metaEntries) lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    if (record.verdict) {
        lines.push('');
        lines.push(`${tr('testlog.Verdict')}: ${tr(`testlog.verdict.${verdictKey(record.verdict.verdict)}`)}`);
        lines.push(tr(`testlog.reason.${record.verdict.reason}`, record.verdict.params || {}));
    }
    lines.push('');
    for (const s of record.steps) {
        const head = `#${s.seq} +${s.at ?? '?'}ms [${s.result}] ${tr(`testlog.kind.${s.kind}`)}`;
        const where = [s.target, s.endpoint, s.protocol].filter(Boolean).join(' | ');
        const dur = s.durationMs != null ? ` (${s.durationMs} ms)` : '';
        lines.push(`${head}${dur}${where ? ` — ${where}` : ''}`);
        if (s.value) lines.push(`    → ${s.value}`);
        if (s.error) lines.push(`    ✗ ${s.error}`);
        if (s.note) lines.push(`    · ${s.note}`);
    }
    if (record.truncated) lines.push(`… +${record.truncated}`);
    return lines.join('\n');
};

// The exported object: the record without its private monotonic origin.
export const exportRecord = (record) => {
    if (!record) return null;
    const { _t0, ...rest } = record;
    return safeRaw(rest);
};

// ── The composable ────────────────────────────────────────────────────────────

/**
 * @param {string} test  stable test id, used in the export file name and the record
 * @param {object} [opts] { clock, wall } — injectable for tests
 */
export const useTestLog = (test, { clock = defaultClock, wall = defaultWall } = {}) => {
    const record = shallowRef(null);
    // Bumped on every mutation so a template reading nested steps re-renders without
    // making a 600-step array deeply reactive.
    const touch = () => triggerRef(record);
    let generation = 0;

    const begin = (meta = {}) => {
        generation += 1;
        record.value = createLogRecord(test, { meta, wallMs: wall(), startMs: clock() });
        return generation;
    };

    const ensure = () => {
        if (!record.value) begin();
        return record.value;
    };

    // A step that already happened (or that has no duration).
    const add = (fields) => {
        const rec = ensure();
        const step = appendStep(rec, fields, clock());
        touch();
        return step;
    };

    // Open a step now, close it later with `end(outcome)`. A handle from a
    // superseded run (a refresh started meanwhile) closes nothing.
    const open = (fields) => {
        const rec = ensure();
        const gen = generation;
        const step = appendStep(rec, { ...fields, result: 'running' }, clock());
        return {
            step,
            end: (outcome = {}) => {
                if (gen !== generation || !step) return null;
                closeStep(step, outcome, clock(), rec);
                touch();
                return step;
            },
        };
    };

    /**
     * Time an async call as one step. `describe(value)` maps its answer to an
     * outcome; a throw becomes `fail` with the error text and is re-thrown, so
     * wrapping a call never changes how its caller behaves.
     */
    const timed = async (fields, fn, describe = (value) => ({ result: 'ok', raw: value })) => {
        const handle = open(fields);
        try {
            const value = await fn();
            handle.end(describe(value) || { result: 'ok' });
            return value;
        } catch (error) {
            handle.end({ result: error?.name === 'AbortError' ? 'timeout' : 'fail', error });
            throw error;
        }
    };

    const setMeta = (patch) => {
        const rec = ensure();
        rec.meta = { ...rec.meta, ...safeRaw(patch) };
        touch();
    };

    const finish = (verdict) => {
        const rec = record.value;
        if (!rec) return;
        rec.finishedAt = new Date(wall()).toISOString();
        rec.durationMs = round(clock() - rec._t0);
        rec.verdict = verdict ? { verdict: verdict.verdict, reason: verdict.reason, params: verdict.params || {} } : null;
        touch();
    };

    const reset = () => {
        generation += 1;
        record.value = null;
    };

    return {
        test,
        record,
        begin,
        add,
        open,
        timed,
        setMeta,
        finish,
        reset,
        isCurrent: (gen) => gen === generation,
        toJSON: () => exportRecord(record.value),
    };
};
