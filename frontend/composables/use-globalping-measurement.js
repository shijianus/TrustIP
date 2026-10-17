// Shared Globalping measurement orchestration.
//
// Three advanced tools (MtrTest / GlobalLatencyTest / CensorshipCheck) all
// talk to https://api.globalping.io with the same shape: POST to create a
// measurement, then poll GET /{id} every pollInterval until status stops
// being 'in-progress' or maxRetries is hit.
//
// Responsibilities:
//   - wrap POST + polling via fetchWithTimeout (prevents indefinite hang)
//   - track the pending setTimeout / AbortController so onScopeDispose can
//     cancel in-flight work when the drawer / route unmounts — this fixes
//     the previous bug where timers continued firing and mutating refs on
//     unmounted components
//
// Callbacks (all optional):
//   - onResults(data): called on every successful poll (including
//       intermediate in-progress payloads). Return truthy to indicate this
//       payload captured at least one usable row — drives whether the final
//       status is 'finished' vs 'error'.
//   - onFinish(): called exactly once when status transitions to 'finished'.
//       Use this for post-processing (e.g. drawMap, calResult).
//   - onError(reason, info): called when status transitions to 'error'. Reason is
//       'create' (POST failed), 'poll' (GET failed), 'empty' (measurement
//       completed but produced no usable rows) or 'rate-limited' (Globalping
//       answered 429; `info.retryAfter` is the wait in seconds).
//
// Rate limits are shared by every tool on the page: a 429 sets one module-level
// back-off (`globalpingRateLimit`, read by GlobalpingRateNotice.vue) and every
// start inside it fails fast as 'rate-limited' without spending another request.
// Identical create bodies in flight at once share one POST.
//
// Where the server holds GLOBALPING_TOKEN (/api/configs.globalpingProxy), the
// create POST goes to /api/globalping/measurements, which adds the Bearer token;
// polls always read api.globalping.io directly (results need no token).

import { ref, shallowRef, onScopeDispose } from 'vue';
import { fetchWithTimeout } from '../../common/fetch-with-timeout.js';
import { isValidIP, isUsablePublicIP } from '../utils/valid-ip.js';

// Curated 28-country spread shared by the MtrTest and GlobalLatencyTest
// tools: their picker's "suggested" section and default selection. The full
// per-continent catalog comes from the live probe inventory
// (utils/globalping-probes.js); CensorshipCheck keeps its own suggestion
// lists because its sections are censorship-oriented, not geographic.
export const GLOBALPING_SUGGESTED_COUNTRIES = [
    'HK', 'TW', 'CN', 'JP', 'KR', 'MY', 'ID', 'SG', 'IN', 'SA',
    'GB', 'DE', 'PL', 'FI', 'FR', 'TR', 'UA', 'RU',
    'ZA', 'NG', 'EG',
    'CA', 'US', 'MX', 'AR', 'BR',
    'NZ', 'AU',
];
// Shared cap for user-composed Globalping runs (one probe per country).
export const GLOBALPING_MAX_COUNTRIES = 30;

// Filter the store's collected IP entries down to the ones usable as a
// measurement target: a truthy `ip` free of spaces (the store sometimes holds
// placeholder / status strings that contain whitespace). Returns the full
// { ip, country } entries so the picker can show each IP's flag. Shared by the
// Globalping tools' IP picker dropdowns.
export function selectableIPs(storeIPs) {
    return storeIPs.filter((e) => e && e.ip && !e.ip.includes(' '));
}

// Classify a typed measurement target into one of four states, so the manual
// -entry inputs can style themselves and explain a rejection. 'unreachable'
// is the interesting one: Globalping probes sit on the public internet, so an
// address outside publicly routable space — most often the visitor's own LAN
// IP — has no path from any country. Shared by MtrTest / GlobalLatencyTest.
export function classifyTarget(input) {
    const ip = typeof input === 'string' ? input.trim() : '';
    if (ip === '') return 'empty';
    if (!isValidIP(ip)) return 'invalid';
    if (!isUsablePublicIP(ip)) return 'unreachable';
    return 'ok';
}

const API_BASE = 'https://api.globalping.io/v1/measurements';
export const GLOBALPING_PROXY_CREATE = '/api/globalping/measurements';

// Whether creates go through this server's token-holding proxy. Set from
// /api/configs once it loads (store.js); off until then, and on the edge.
let proxyCreate = false;
export const setGlobalpingProxy = (on) => { proxyCreate = Boolean(on); };
const createUrl = () => (proxyCreate ? GLOBALPING_PROXY_CREATE : API_BASE);

// The shared back-off: { until (ms epoch), seconds } while Globalping's 429
// holds, else null.
const DEFAULT_RETRY_AFTER_S = 60;
const MAX_RETRY_AFTER_S = 3600;
export const globalpingRateLimit = shallowRef(null);
export const isGlobalpingRateLimited = (now = Date.now()) => Boolean(globalpingRateLimit.value && globalpingRateLimit.value.until > now);
export const resetGlobalpingRateLimit = () => { globalpingRateLimit.value = null; };

// Seconds to wait from a 429: Retry-After, else Globalping's X-RateLimit-Reset
// (seconds until the window resets), else a minute; capped at an hour.
export const retryAfterOf = (response) => {
    const read = (name) => Number(response?.headers?.get?.(name));
    for (const value of [read('retry-after'), read('x-ratelimit-reset')]) {
        if (Number.isFinite(value) && value > 0) return Math.min(Math.ceil(value), MAX_RETRY_AFTER_S);
    }
    return DEFAULT_RETRY_AFTER_S;
};
const enterBackoff = (seconds) => {
    globalpingRateLimit.value = { until: Date.now() + seconds * 1000, seconds };
};

class RateLimitedError extends Error {
    constructor(seconds) {
        super(`rate limited, retry after ${seconds}s`);
        this.retryAfter = seconds;
    }
}

// One POST per distinct body in flight; every caller awaits the same outcome.
const inFlightCreates = new Map();
const createOnce = (body) => {
    const key = JSON.stringify(body);
    if (inFlightCreates.has(key)) return inFlightCreates.get(key);
    const pending = (async () => {
        const response = await fetchWithTimeout(createUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: key,
            timeoutMs: REQUEST_TIMEOUT_MS,
        });
        if (response.status === 429) {
            const seconds = retryAfterOf(response);
            enterBackoff(seconds);
            throw new RateLimitedError(seconds);
        }
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
    })().finally(() => inFlightCreates.delete(key));
    inFlightCreates.set(key, pending);
    return pending;
};

// The finished measurement as test-process log steps, one per probe: where the
// probe sits, what it reported, and its raw output (trimmed — an mtr dump is long).
const RAW_OUTPUT_LIMIT = 2000;
export const probeStepsOf = (data, type) => (data?.results || []).map((item) => {
    const probe = item?.probe || {};
    const result = item?.result || {};
    const finished = result.status === 'finished';
    let value = null;
    if (type === 'ping' && result.stats) {
        const st = result.stats;
        value = st.min == null ? null : `min ${st.min} / avg ${st.avg} / max ${st.max} ms · loss ${st.loss}%`;
    } else if (type === 'mtr' && Array.isArray(result.hops)) {
        const last = result.hops[result.hops.length - 1];
        value = `${result.hops.length} hops · last ${last?.resolvedAddress || '—'} avg ${last?.stats?.avg ?? '—'} ms`;
    } else if (type === 'http') {
        value = [result.statusCode ? `HTTP ${result.statusCode}` : null, result.timings?.total != null ? `${result.timings.total} ms` : null]
            .filter(Boolean).join(' · ') || null;
    }
    const ok = finished && (type !== 'ping' || result.stats?.min != null);
    const rawOutput = typeof result.rawOutput === 'string' ? result.rawOutput.slice(0, RAW_OUTPUT_LIMIT) : null;
    return {
        kind: 'probe',
        target: [probe.country, probe.city, probe.network || (probe.asn ? `AS${probe.asn}` : null)].filter(Boolean).join(' · '),
        protocol: String(type || '').toUpperCase(),
        result: ok ? 'ok' : (result.status === 'in-progress' ? 'timeout' : 'fail'),
        value,
        error: ok ? null : (rawOutput ? rawOutput.split('\n')[0].slice(0, 200) : result.status || 'no result'),
        raw: { probe, status: result.status, stats: result.stats ?? null, statusCode: result.statusCode ?? null, rawOutput },
    };
});
// Globalping probes can be slow on first create + under load; allow more
// headroom than the 5s front-end default.
const REQUEST_TIMEOUT_MS = 10000;

export function useGlobalpingMeasurement({ pollInterval = 1000, maxRetries = 4 } = {}) {
    const status = ref('idle');  // 'idle' | 'running' | 'finished' | 'error'

    let currentTimer = null;
    let currentController = null;
    let disposed = false;

    const cancel = () => {
        if (currentTimer !== null) {
            clearTimeout(currentTimer);
            currentTimer = null;
        }
        if (currentController) {
            currentController.abort();
            currentController = null;
        }
    };

    // `log` (optional) is a `useTestLog()` handle: the create request and every poll
    // are recorded there as steps (the caller begins and finishes the record).
    const start = (body, { onResults, onFinish, onError, log } = {}) => {
        cancel();
        status.value = 'running';
        let tryCount = 0;
        let anyResults = false;

        const schedule = (fn, delay) => {
            currentTimer = setTimeout(() => {
                currentTimer = null;
                fn();
            }, delay);
        };

        const finishError = (reason, info) => {
            status.value = 'error';
            onError?.(reason, info);
        };

        const poll = async (id) => {
            if (disposed) return;
            currentController = new AbortController();
            let data;
            const pollStep = log?.open({ kind: 'gpPoll', target: id, endpoint: `${API_BASE}/${id}`, protocol: 'HTTPS GET' });
            try {
                const response = await fetchWithTimeout(`${API_BASE}/${id}`, {
                    timeoutMs: REQUEST_TIMEOUT_MS,
                    signal: currentController.signal,
                });
                if (response.status === 429) {
                    const seconds = retryAfterOf(response);
                    enterBackoff(seconds);
                    throw new RateLimitedError(seconds);
                }
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                data = await response.json();
                pollStep?.end({
                    result: 'ok',
                    value: `status=${data?.status} results=${data?.results?.length ?? 0}`,
                });
            } catch (err) {
                pollStep?.end({ result: 'fail', error: err });
                if (disposed) return;
                console.error('Error fetching globalping results:', err);
                if (err instanceof RateLimitedError) finishError('rate-limited', { retryAfter: err.retryAfter });
                else finishError('poll');
                return;
            }
            if (disposed) return;

            if (onResults?.(data)) anyResults = true;

            if (data.status === 'in-progress' && tryCount < maxRetries) {
                tryCount++;
                schedule(() => poll(id), pollInterval);
            } else if (anyResults) {
                status.value = 'finished';
                onFinish?.();
            } else {
                finishError('empty');
            }
        };

        (async () => {
            let createData;
            const createStep = log?.open({
                kind: 'gpCreate',
                target: `${body?.type || ''} → ${body?.target || ''}`,
                endpoint: createUrl(),
                protocol: 'HTTPS POST',
                raw: body,
            });
            // Inside a back-off nothing is sent: the answer is already known.
            if (isGlobalpingRateLimited()) {
                const seconds = Math.max(1, Math.ceil((globalpingRateLimit.value.until - Date.now()) / 1000));
                createStep?.end({ result: 'fail', error: `rate limited (429), retry after ${seconds}s` });
                finishError('rate-limited', { retryAfter: seconds });
                return;
            }
            try {
                createData = await createOnce(body);
                createStep?.end({
                    result: createData?.id ? 'ok' : 'fail',
                    value: createData?.id ? `id=${createData.id} probes=${createData.probesCount ?? '?'}` : null,
                    error: createData?.id ? null : 'no measurement id',
                });
            } catch (err) {
                createStep?.end({ result: 'fail', error: err });
                if (disposed) return;
                console.error('Error sending globalping request:', err);
                if (err instanceof RateLimitedError) finishError('rate-limited', { retryAfter: err.retryAfter });
                else finishError('create');
                return;
            }
            if (disposed) return;
            if (!createData?.id) {
                finishError('create');
                return;
            }
            schedule(() => poll(createData.id), pollInterval);
        })();
    };

    onScopeDispose(() => {
        disposed = true;
        cancel();
    });

    return { status, start, cancel };
}
