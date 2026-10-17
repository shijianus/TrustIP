// The offline test stack: backend-server.js (with offline-fetch.mjs preloaded and
// no keys), the frontend app (common/frontend-app.js) over a built dist, and the
// local STUN server. Shared by the Playwright web server (e2e/support/serve-stack.mjs)
// and scripts/security-probes.mjs.
//
// Ports come from the environment so CI and a local run can choose their own;
// the defaults stay clear of the dev ports (11966 / 18966 / 8787).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PRELOAD = path.join(ROOT, 'e2e/support/offline-fetch.mjs');
export const IPCHECKING_ENDPOINT = 'https://ipchecking.e2e.invalid';

const num = (value, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
};

export const PORTS = {
    backend: num(process.env.E2E_BACKEND_PORT, 41966),
    frontend: num(process.env.E2E_FRONTEND_PORT, 42966),
    frontendStun: num(process.env.E2E_FRONTEND_STUN_PORT, 42967),
    edge: num(process.env.E2E_EDGE_PORT, 42787),
    stun: num(process.env.E2E_STUN_PORT, 43478),
};

// A child gets a clean environment: no .env keys of the machine running the tests
// leak into "no keys" assertions. dotenv only fills variables that are unset, and
// there is no .env in a CI checkout.
export const cleanEnv = (extra = {}) => ({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'C.UTF-8',
    LOG_FORMAT: 'json',
    LOG_LEVEL: process.env.E2E_LOG_LEVEL || 'warn',
    DATASET_AUTO_UPDATE: 'false',
    ...extra,
});

/**
 * Spawn a node child with the offline preload.
 * @returns {{ child: import('node:child_process').ChildProcess, stop: () => Promise<void> }}
 */
export const spawnNode = (name, args, { env = {}, logDir } = {}) => {
    const out = logDir ? fs.openSync(path.join(logDir, `${name}.log`), 'a') : 'ignore';
    const child = spawn(process.execPath, ['--import', PRELOAD, ...args], {
        cwd: ROOT,
        env: cleanEnv(env),
        stdio: ['ignore', out, out],
    });
    const exited = new Promise((resolve) => child.once('exit', resolve));
    return {
        child,
        exited,
        stop: async () => {
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
            await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        },
    };
};

export const startBackend = ({ port = PORTS.backend, env = {}, logDir, name = 'backend' } = {}) => spawnNode(
    name,
    ['backend-server.js'],
    { env: { BACKEND_PORT: String(port), ...env }, logDir },
);

export const startEdge = ({ port = PORTS.edge, env = {}, logDir } = {}) => spawnNode(
    'edge',
    ['dev/function-local.mjs'],
    { env: { PORT: String(port), ...env }, logDir },
);

/** In-process frontend app over a built dist (the same factory frontend-server.js uses). */
export const startFrontend = async ({ distDir, port, backEndPort = PORTS.backend, env = {} }) => {
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
        throw new Error(`${distDir}/index.html is missing — build first (see e2e/README.md)`);
    }
    const { createFrontendApp } = await import(path.join(ROOT, 'common/frontend-app.js'));
    const app = createFrontendApp({ distDir, backEndPort, env });
    const server = await new Promise((resolve, reject) => {
        const s = app.listen(port, '127.0.0.1', (err) => (err ? reject(err) : resolve(s)));
    });
    return { server, stop: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
};

/** Poll until `url` answers `status` (default: any non-5xx). */
export const waitFor = async (url, { timeoutMs = 60000, ok = (s) => s < 500, headers = {} } = {}) => {
    const deadline = Date.now() + timeoutMs;
    let last = 'no answer';
    while (Date.now() < deadline) {
        try {
            const res = await fetch(url, { headers, redirect: 'manual' });
            await res.arrayBuffer();
            if (ok(res.status)) return res.status;
            last = `HTTP ${res.status}`;
        } catch (error) {
            last = error.cause?.code || error.message;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`${url} not ready after ${timeoutMs}ms (${last})`);
};
