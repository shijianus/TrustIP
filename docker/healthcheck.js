// Container HEALTHCHECK probe (Dockerfile). Node only, because the runtime
// image carries no curl / wget: the static server on FRONTEND_PORT (default
// 18966) must serve `/`, and the API on BACKEND_PORT (default 11966, loopback)
// must answer /api/configs. The Referer is one requireReferer always allows
// (common/referer-check.js), so the probe needs no ALLOWED_DOMAINS entry.
// Exit 0 = healthy, 1 = unhealthy; each request gives up after 4 s.
import http from 'node:http';

const frontEndPort = Number.parseInt(process.env.FRONTEND_PORT || '18966', 10);
const backEndPort = Number.parseInt(process.env.BACKEND_PORT || '11966', 10);
const TIMEOUT_MS = 4000;

const probe = (port, path) => new Promise((resolve) => {
    const req = http.get({
        host: '127.0.0.1',
        port,
        path,
        headers: { Referer: 'http://localhost/' },
        timeout: TIMEOUT_MS,
    }, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
});

const results = await Promise.all([
    probe(frontEndPort, '/'),
    probe(backEndPort, '/api/configs'),
]);
process.exit(results.every(Boolean) ? 0 : 1);
