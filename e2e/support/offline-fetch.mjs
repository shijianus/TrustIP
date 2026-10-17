// Preloaded into backend-server.js (and the edge harness) by the E2E stack and
// scripts/security-probes.mjs:
//
//   node --import ./e2e/support/offline-fetch.mjs backend-server.js
//
// It makes a server run deterministic without the internet and without keys:
//   - global fetch() to anything but loopback never leaves the process. A few
//     upstreams get a canned answer (below); everything else fails the way a
//     network outage does (`TypeError: fetch failed`), which every handler already
//     treats as "upstream down".
//   - port-43 WHOIS connections (whoiser uses net.connect) are redirected to an
//     in-process registry that answers every name with "No match".
//   - every outbound fetch is appended to E2E_FETCH_LOG (JSONL, query keys
//     redacted) so a probe can count how many visitor requests reached an upstream
//     and which headers travelled with them.
//
// Test-only. Nothing in the app imports this file.

import fs from 'node:fs';
import net from 'node:net';

const LOG = process.env.E2E_FETCH_LOG || '';
const realFetch = globalThis.fetch;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const SECRET_PARAM = /^(?:key|apikey|api_key|token|access_key|license_key)$/i;

const redact = (url) => {
    const copy = new URL(url);
    for (const name of [...copy.searchParams.keys()]) {
        if (SECRET_PARAM.test(name)) copy.searchParams.set(name, 'REDACTED');
    }
    return copy.toString();
};

const record = (entry) => {
    if (!LOG) return;
    fs.appendFileSync(LOG, `${JSON.stringify({ t: Date.now(), ...entry })}\n`);
};

const json = (status, body, type = 'application/json') => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': type },
});

// 1×1 JPEG — what /api/map streams back for a canonical request.
const TINY_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
);

const RDAP_BASE = 'https://rdap.e2e.invalid/';
// IANA bootstrap files pointing every number and name at one fake RDAP server,
// which answers 404: "no such record".
const bootstrap = (file) => {
    if (file === 'asn.json') return { services: [[['1-4294967295'], [RDAP_BASE]]] };
    if (file === 'ipv4.json') return { services: [[['0.0.0.0/0'], [RDAP_BASE]]] };
    if (file === 'ipv6.json') return { services: [[['::/0'], [RDAP_BASE]]] };
    if (file === 'dns.json') {
        return { services: [[['com', 'net', 'org', 'io', 'jp', 'de', 'uk', 'test', 'example'], [RDAP_BASE]]] };
    }
    return null;
};

const IPCHECKING_HOST = 'ipchecking.e2e.invalid';

const cannedResponse = (url, method) => {
    const host = url.hostname;
    if (host === 'maps.googleapis.com') {
        return new Response(TINY_JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });
    }
    if (host === 'api.github.com' && url.pathname.startsWith('/repos/')) {
        return json(200, { stargazers_count: 42 });
    }
    if (host === 'data.iana.org' && url.pathname.startsWith('/rdap/')) {
        const body = bootstrap(url.pathname.slice('/rdap/'.length));
        return body ? json(200, body) : json(404, {});
    }
    if (url.origin + '/' === RDAP_BASE) {
        return json(404, { errorCode: 404, title: 'Not Found' }, 'application/rdap+json');
    }
    if (host === IPCHECKING_HOST) {
        if (url.pathname.includes('getpdresult')) return json(200, { status: 'done', e2e: true });
        if (url.pathname.includes('dnsleaktest')) return json(200, { e2e: true, results: [] });
        if (/userinfo/i.test(url.pathname)) return json(200, { e2e: true });
        if (/achievement/i.test(url.pathname) || method === 'PUT') return json(200, { success: true });
        return json(200, { e2e: true });
    }
    return null;
};

globalThis.fetch = async function offlineFetch(input, init = {}) {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (LOOPBACK.has(url.hostname)) return realFetch(input, init);

    const canned = cannedResponse(url, request.method);
    record({
        method: request.method,
        url: redact(url),
        host: url.host,
        headers: Object.fromEntries(request.headers),
        answered: canned ? canned.status : 'offline',
    });
    if (request.signal?.aborted) throw request.signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (canned) return canned;
    throw new TypeError('fetch failed', { cause: new Error(`offline test stack: ${url.host} is not reachable`) });
};

// --- port 43 ---------------------------------------------------------------
// A registry that knows no names. A bare TLD query (IANA's referral lookup)
// gets a referral to itself; anything else gets the classic Verisign miss line.
const whoisServer = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
        buffer += chunk;
        if (!buffer.includes('\n')) return;
        const query = buffer.trim();
        record({ method: 'WHOIS', url: `whois://registry/${query}`, host: 'port-43', headers: {}, answered: 'no-match' });
        if (/^[a-z]{2,}$/i.test(query)) {
            socket.end(`% IANA WHOIS server (e2e)\nrefer:        whois.e2e.invalid\n\ndomain:       ${query.toUpperCase()}\n`);
        } else {
            socket.end(`No match for "${query.toUpperCase()}".\r\n>>> Last update of whois database: 2026-01-01T00:00:00Z <<<\r\n`);
        }
    });
    socket.on('error', () => {});
});
await new Promise((resolve) => whoisServer.listen(0, '127.0.0.1', resolve));
whoisServer.unref();
const WHOIS_PORT = whoisServer.address().port;

const realConnect = net.connect;
const redirectWhois = function connect(...args) {
    const first = args[0];
    if (first && typeof first === 'object' && Number(first.port) === 43) {
        args[0] = { ...first, host: '127.0.0.1', port: WHOIS_PORT };
    } else if (Number(first) === 43) {
        args[0] = WHOIS_PORT;
        if (typeof args[1] === 'string') args[1] = '127.0.0.1';
    }
    return realConnect.apply(this, args);
};
net.connect = redirectWhois;
net.createConnection = redirectWhois;

export const E2E_IPCHECKING_ENDPOINT = `https://${IPCHECKING_HOST}`;
