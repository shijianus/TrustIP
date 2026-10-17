// Local harness for the Qoder Sites edge function.
//
// `functions/` must stay Node-free and dependency-free, so the adapter that lets
// this repo's own runtime exercise it lives outside that directory: it turns a
// `node:http` request into a web `Request`, calls the same handler the platform
// calls, and writes the `Response` back. Nothing else — no routing, no caching,
// no shim of any upstream.
//
// Run:  node dev/function-local.mjs        (listens on 127.0.0.1:8787)
// Then: curl 'http://127.0.0.1:8787/functions/v1/app/ipsb?ip=8.8.8.8'
//
// Requires Node with TypeScript type stripping enabled (22.18+ by default,
// `--experimental-strip-types` on 22.6–22.17).

import http from 'node:http';
import handler from '../functions/handler.ts';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8787);

const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
    req.on('error', reject);
});

// Methods the Fetch spec forbids in `new Request()` (it throws on them). A
// server runtime still receives them off the wire, so the harness hands the
// handler a minimal request-shaped object instead — the handler only reads
// `url`, `method`, `headers` and `body`, and refuses these before the body.
const FORBIDDEN_METHODS = new Set(['TRACE', 'TRACK', 'CONNECT']);

const toWebRequest = async (req) => {
    const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (FORBIDDEN_METHODS.has(req.method)) {
        req.resume();
        return { url: url.href, method: req.method, headers: new Headers(req.headers), body: null };
    }
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    return new Request(url, {
        method: req.method,
        headers: req.headers,
        body,
        // A harness must not be stricter than the platform: local curls carry no
        // Referer, and the function is not supposed to care.
        duplex: 'half',
    });
};

const server = http.createServer((req, res) => {
    const started = Date.now();
    toWebRequest(req)
        .then((request) => handler(request))
        .then((response) => response.arrayBuffer().then((buffer) => ({ response, buffer })))
        .then(({ response, buffer }) => {
            res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
            res.end(Buffer.from(buffer));
            console.log(`${req.method} ${req.url} → ${response.status} (${Date.now() - started}ms)`);
        })
        .catch((error) => {
            console.error('harness failure', error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: error?.message || String(error) }));
        });
});

server.listen(PORT, HOST, () => {
    console.log(`🚀 edge function harness on http://${HOST}:${PORT}/functions/v1/app/<route>`);
});
