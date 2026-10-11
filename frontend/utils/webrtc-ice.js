// One ICE gathering pass against one STUN server, shared by whoever asks.
//
// Two callers need exactly this: the `/webrtc` section, which shows the answer as
// four cards with an SDP timeline, and the homepage's routing table, which needs the
// address quietly and in time to fold into its second work order. Duplicating the
// gathering would mean two definitions of what "a leak" is, and the whole point of
// the primary-address rule is that there is only one.
//
// `gatherStunCandidate` settles on the first public candidate and nothing else, and
// `gatherAllCandidates` below records every candidate the browser emits. The two are
// deliberately separate functions rather than one with a flag: the first answers
// "did the network tell me who I am" and its answer feeds the primary-address rule,
// the second answers "what does this browser hand out over each path" and its answer
// is only ever displayed. Merging them would let a `host` address — which a browser
// emits whether or not any STUN server replied — be read as a leak.
//
// What counts as an answer, and why the rest does not: a `host` candidate is the
// browser repeating its own interface address, which it emits whether or not the
// STUN server ever replied, and a `relay` candidate is the TURN server's address —
// counting that as a leak would place the visitor wherever their relay sits. Only
// `srflx` and `prflx` are something the network said back about *you*, so only those
// resolve this promise.
//
// Distinguishing "timed out" from "mDNS privacy is on" looks tempting and is a
// false-positive machine: the two conditions are independent (mDNS can be on while
// STUN still answers via srflx, and vice versa). So a pass that produced nothing
// reports `error`, and the caller decides what words to put on it.

// The four the section has always asked. Different providers, different network
// paths, so one blocked or geo-fenced server does not read as "no leak".
export const STUN_SERVERS = [
    { id: 'google', url: 'stun.l.google.com:19302' },
    { id: 'blackberry', url: 'stun.voip.blackberry.com:3478' },
    { id: 'twilio', url: 'global.stun.twilio.com' },
    { id: 'cloudflare', url: 'stun.cloudflare.com' },
];

// Regex extracting the IP portion out of an ICE candidate line
// (full SDP grammar not needed — just IPv4 / IPv6 with common forms).
const CANDIDATE_IP_RE = /([0-9a-f]{1,4}(:[0-9a-f]{1,4}){7}|[0-9a-f]{0,4}(:[0-9a-f]{1,4}){0,6}::[0-9a-f]{0,4}|::[0-9a-f]{1,4}(:[0-9a-f]{1,4}){0,6}|[0-9]{1,3}(\.[0-9]{1,3}){3})/i;

// The candidate's type token is the eighth field of the attribute line, by SDP
// grammar. Locale-free on purpose: the UI turns this into a translated label, the
// report builder and the leak filter read the code.
export const natTypeCodeOf = (candidate) => {
    const type = String(candidate || '').split(' ')[7];
    return ['host', 'srflx', 'prflx', 'relay'].includes(type) ? type : 'unknown';
};

// A browser can ship the constructor and forbid building with it (permissions
// policy, a WebRTC-disabled Chromium), or a privacy extension can replace it with a
// stub that passes `typeof` but has no API. All three are the runtime sibling of
// "no WebRTC here": a finding about the browser, not a failure of the test.
const isConstructionBlocked = (error) => error?.name === 'NotAllowedError'
    || error?.name === 'NotSupportedError'
    || (error instanceof TypeError && /not a constructor/i.test(error?.message || ''));

/**
 * Record every ICE candidate one gathering pass produces, and settle only when the
 * browser stops producing them.
 *
 * This is the multi-method pass a visitor reads as "what does each path hand out":
 * `host` (this machine's own interface address), `srflx`/`prflx` (what a STUN server
 * reflected back) and `relay` (a TURN server's address) are each kept as their own
 * row, because telling them apart is the whole finding — a `host` address is not a
 * leak, and a `relay` address is somebody else's machine.
 *
 * Resolves `{ ok: true, candidates }` when ICE reports end-of-candidates or the
 * gathering state reaches `complete`, and with whatever arrived when the timeout
 * runs out — a partial list is still a list. `unavailable` and `aborted` mean the
 * same findings as in `gatherStunCandidate`. Never rejects.
 *
 * @param {string} url
 * @returns {Promise<object>}
 */
export const gatherAllCandidates = (url, { timeoutMs = 6000, signal } = {}) => new Promise((resolve) => {
    const candidates = [];
    let pc = null;
    let timer = null;
    let settled = false;

    const settle = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        if (pc) {
            try { pc.close(); } catch { /* already gone */ }
            pc = null;
        }
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(result);
    };
    const onAbort = () => settle({ ok: false, reason: 'aborted', candidates });

    if (typeof RTCPeerConnection !== 'function') {
        settle({ ok: false, reason: 'unavailable', candidates });
        return;
    }
    if (signal?.aborted) { settle({ ok: false, reason: 'aborted', candidates }); return; }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:' + url }] });
        if (typeof pc.createDataChannel !== 'function' || typeof pc.createOffer !== 'function') {
            pc = null;
            settle({ ok: false, reason: 'unavailable', candidates });
            return;
        }

        pc.onicegatheringstatechange = () => {
            if (pc?.iceGatheringState === 'complete') settle({ ok: true, candidates });
        };
        pc.onicecandidate = (event) => {
            if (!event.candidate) { settle({ ok: true, candidates }); return; }
            const line = String(event.candidate.candidate || '');
            const fields = line.split(' ');
            const type = natTypeCodeOf(line);
            const ip = CANDIDATE_IP_RE.exec(line)?.[0] || null;
            // A candidate whose address is an mDNS `.local` name yields no IP here.
            // That is the browser's privacy mode working, so the row keeps the raw
            // address rather than dropping the candidate.
            const address = ip ?? (fields[4] || null);
            if (type === 'unknown' && !address) return;
            candidates.push({
                type,
                address,
                ip,
                protocol: fields[2] || null,
                port: fields[5] || null,
                related: fields[9] || null,
                raw: line,
            });
        };

        pc.createDataChannel('');
        pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .catch(() => { /* a failed offer still reports whatever candidates gathered */ });

        timer = setTimeout(() => { timer = null; settle({ ok: candidates.length > 0, reason: candidates.length ? null : 'error', candidates }); }, timeoutMs);
    } catch (error) {
        if (isConstructionBlocked(error)) {
            settle({ ok: false, reason: 'unavailable', candidates });
            return;
        }
        console.error('ICE gather error:', error);
        settle({ ok: false, reason: 'error', candidates });
    }
});

/**
 * Ask one STUN server what it can see of this machine.
 *
 * Resolves exactly once: `{ ok: true, ip, candidate }` on the first srflx/prflx
 * candidate, `{ ok: false, reason: 'error' | 'unavailable' | 'aborted' }`
 * otherwise. Never rejects — a caller that has to write four catch blocks around a
 * privacy test will get them wrong.
 *
 * `onLog` receives timeline lines for the SDP panel; it is called with a plain
 * string, so a caller that does not want a log does not have to build one.
 * `signal` closes the peer connection and settles as `aborted`, which is how a
 * caller unmounting mid-gather stops ICE from running for the full timeout.
 */
export const gatherStunCandidate = (url, { timeoutMs = 5000, onLog = () => {}, signal } = {}) => new Promise((resolve) => {
    const started = performance.now();
    // Every line is prefixed with a millisecond offset from the start of this
    // server's pass, so the log reads as a timeline rather than a list.
    const log = (msg) => {
        onLog(`[+${Math.round(performance.now() - started).toString().padStart(4, ' ')}ms] ${msg}`);
    };

    let pc = null;
    let timer = null;
    let settled = false;

    const settle = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) { clearTimeout(timer); timer = null; }
        if (pc) {
            try { pc.close(); } catch { /* already gone */ }
            pc = null;
        }
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve(result);
    };
    const onAbort = () => { log('aborted'); settle({ ok: false, reason: 'aborted' }); };

    if (typeof RTCPeerConnection !== 'function') {
        log('RTCPeerConnection unavailable');
        settle({ ok: false, reason: 'unavailable' });
        return;
    }
    if (signal?.aborted) { settle({ ok: false, reason: 'aborted' }); return; }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    try {
        log(`new RTCPeerConnection -> stun:${url}`);
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:' + url }] });

        // Privacy extensions may swap RTCPeerConnection for a stub that constructs
        // fine but lacks the real API surface — the same finding as a blocked
        // constructor. Drop it without close(): it may not have one.
        if (typeof pc.createDataChannel !== 'function' || typeof pc.createOffer !== 'function') {
            log('stubbed RTCPeerConnection: createDataChannel/createOffer missing');
            pc = null;
            settle({ ok: false, reason: 'unavailable' });
            return;
        }

        pc.onicegatheringstatechange = () => log(`iceGatheringState: ${pc.iceGatheringState}`);

        // These fire when signalling fails (host unreachable, auth issues). They do
        // not end the pass on their own, but they are what explains a server that
        // never answered, which is otherwise indistinguishable from a blocked one.
        pc.onicecandidateerror = (event) => {
            log(`iceCandidateError: ${event.errorCode || ''} ${event.errorText || ''} url=${event.url || ''}`.trim());
        };

        pc.onicecandidate = (event) => {
            if (!event.candidate) { log('candidate: (end-of-candidates)'); return; }
            const candidate = event.candidate.candidate;
            log(`candidate: ${candidate}`);
            if (settled) return;
            if (!['srflx', 'prflx'].includes(natTypeCodeOf(candidate))) return;
            const ipMatch = CANDIDATE_IP_RE.exec(candidate);
            if (!ipMatch) return;
            log(`resolved IP: ${ipMatch[0]}`);
            settle({ ok: true, ip: ipMatch[0], candidate });
        };

        pc.createDataChannel('');
        pc.createOffer().then((offer) => {
            // Multi-line, recorded as one block so a <pre> can render it verbatim.
            log(`createOffer ok\n--- Offer SDP ---\n${offer.sdp}--- end SDP ---`);
            return pc.setLocalDescription(offer);
        }).then(() => {
            log('setLocalDescription ok');
        }).catch((error) => {
            log(`offer/setLocalDescription failed: ${error?.message || error}`);
        });

        timer = setTimeout(() => { timer = null; settle({ ok: false, reason: 'error' }); }, timeoutMs);
    } catch (error) {
        if (isConstructionBlocked(error)) {
            log(`construction blocked: ${error?.message || error}`);
            settle({ ok: false, reason: 'unavailable' });
            return;
        }
        console.error('STUN Server Test Error:', error);
        log(`exception: ${error?.message || error}`);
        settle({ ok: false, reason: 'error' });
    }
});
