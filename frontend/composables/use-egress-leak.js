// Which address this machine really is, gathered quietly for the routing table.
//
// The homepage's table decides what each *destination* saw by asking the
// destinations. That answers "where does my traffic enter the internet" and cannot
// answer "where am I" — a proxy is precisely a service that makes those two
// questions have different answers. The one thing a browser can offer for the second
// is a STUN server repeating this machine's reflexive address back to it, which is
// why the homepage runs one quiet ICE pass over the same four servers the `/webrtc`
// section asks, through the same gatherer (`utils/webrtc-ice.js`).
//
// Deliberately quiet, and deliberately side-effect-free: no store writes, no IP
// history entries, no achievement events, no report section. A visitor who never
// opened the WebRTC section should not find its findings credited to them, and the
// table only needs the address, not a second copy of the section's card state.
//
// A browser with WebRTC disabled answers nothing, which is the ordinary state for a
// good share of this tool's visitors. That is a clean `leaks: []`, not an error, and
// nothing downstream should read the silence as "no leak on a browser that cannot
// leak".

import { shallowRef, onScopeDispose } from 'vue';
import { STUN_SERVERS, gatherStunCandidate } from '../utils/webrtc-ice.js';
import { isUsablePublicIP } from '../utils/valid-ip.js';

// `ip=…` plus whatever the site's own geo answer carries. One address, one source:
// the caller passes the same lookup the table geocodes its exits with, so the leak
// and the row that echoes the same string can never name two different cities.
const withGeo = async (ip, geoLookup) => {
    const base = { ip, country_code: '', org: '' };
    if (!geoLookup) return base;
    try {
        const geo = await geoLookup(ip);
        return { ...base, country_code: String(geo?.country_code || '').toUpperCase(), org: geo?.org || geo?.isp || '' };
    } catch {
        // An address we could not place is still an address. The table shows it and
        // the scorer ignores it; neither is a reason to lose the finding.
        return base;
    }
};

export function useEgressLeak({ geoLookup } = {}) {
    const leaks = shallowRef([]);
    const running = shallowRef(false);

    let controller = null;
    let startedOnce = false;

    const run = async () => {
        if (startedOnce) return;
        startedOnce = true;
        controller = new AbortController();
        running.value = true;

        const seen = new Map();
        const record = (ip) => {
            if (seen.has(ip)) return;
            seen.set(ip, { ip, country_code: '', org: '' });
            leaks.value = [...seen.values()];
            withGeo(ip, geoLookup).then((geo) => {
                if (controller.signal.aborted) return;
                seen.set(ip, geo);
                leaks.value = [...seen.values()];
            });
        };

        await Promise.allSettled(STUN_SERVERS.map((server) => gatherStunCandidate(server.url, {
            signal: controller.signal,
        }).then((result) => {
            // Only a public address can name a place. A LAN candidate is what a
            // `host` candidate always is, and `isUsablePublicIP` is the single
            // definition of that boundary, shared with the backend's guards.
            if (result.ok && isUsablePublicIP(result.ip)) record(result.ip);
        })));

        running.value = false;
    };

    const cancel = () => {
        controller?.abort();
        running.value = false;
    };

    onScopeDispose(cancel);

    return { leaks, running, run, cancel };
}
