// Playwright `webServer` entry: boots the whole offline stack and stays up until
// Playwright (or Ctrl-C) stops it.
//
//   backend   127.0.0.1:E2E_BACKEND_PORT        backend-server.js, no keys, offline
//   frontend  127.0.0.1:E2E_FRONTEND_PORT       dist/      (plain build)
//   frontend  127.0.0.1:E2E_FRONTEND_STUN_PORT  dist-stun/ (VITE_TEST_EXTRA_STUN build)
//   STUN      127.0.0.1:E2E_STUN_PORT/udp

import fs from 'node:fs';
import path from 'node:path';
import { PORTS, ROOT, IPCHECKING_ENDPOINT, startBackend, startFrontend, waitFor } from './stack.mjs';
import { startStunServer } from './stun-server.mjs';

const logDir = path.resolve(ROOT, process.env.E2E_LOG_DIR || 'e2e/.out/logs');
fs.mkdirSync(logDir, { recursive: true });

const stun = await startStunServer({
    port: PORTS.stun,
    onRequest: (entry) => fs.appendFileSync(path.join(logDir, 'stun-requests.jsonl'), `${JSON.stringify(entry)}\n`),
});
const backend = startBackend({
    logDir,
    env: {
        E2E_FETCH_LOG: path.join(logDir, 'backend-fetch.jsonl'),
        // Endpoint without a key: the IPCheck.ing routes stay "API key is missing".
        IPCHECKING_API_ENDPOINT: IPCHECKING_ENDPOINT,
    },
});
let stopping = false;
backend.exited.then((code) => {
    if (stopping) return;
    console.error(`[e2e stack] backend exited early (code ${code}); see ${logDir}/backend.log`);
    process.exit(1);
});

const plain = await startFrontend({ distDir: path.join(ROOT, 'dist'), port: PORTS.frontend });
const stunDist = path.join(ROOT, 'dist-stun');
const withStun = fs.existsSync(path.join(stunDist, 'index.html'))
    ? await startFrontend({ distDir: stunDist, port: PORTS.frontendStun })
    : null;
if (!withStun) console.warn('[e2e stack] dist-stun/ not built: the WebRTC local-STUN test will be skipped');

await waitFor(`http://127.0.0.1:${PORTS.backend}/api/configs`, {
    headers: { Referer: 'http://localhost/' },
    ok: (s) => s === 200,
});
console.log(`[e2e stack] ready: frontend :${PORTS.frontend}, stun-frontend :${withStun ? PORTS.frontendStun : '-'}, backend :${PORTS.backend}, stun udp :${stun.port}`);

const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.allSettled([backend.stop(), plain.stop(), withStun?.stop(), stun.close()]);
    process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
