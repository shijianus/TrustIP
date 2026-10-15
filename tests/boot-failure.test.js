// A backend boot that fails exits once, with code 1 and one ❌ log line —
// common/boot-failure.js, and backend-server.js wired to it.
//
// The process spec starts the real backend-server.js on a port that is already
// taken: the listen error must reject the boot and end the process cleanly,
// not surface as an unhandled rejection or an uncaught throw. It fails before
// any dataset download starts, so it needs no network.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { exitOnBootFailure } from '../common/boot-failure.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('exitOnBootFailure', () => {
    it('logs the error once and exits with code 1', () => {
        const logged = [];
        const exits = [];
        const err = new Error('boom');
        exitOnBootFailure(err, { log: { error: (ctx, msg) => logged.push([ctx.err, msg]) }, exit: (code) => exits.push(code) });
        assert.deepEqual(exits, [1]);
        assert.equal(logged.length, 1);
        assert.equal(logged[0][0], err);
        assert.match(logged[0][1], /^❌ /);
    });
});

describe('backend-server.js', () => {
    it('exits 1 with a logged error when its port is taken', { timeout: 30_000 }, async () => {
        const blocker = net.createServer();
        await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
        const port = blocker.address().port;
        try {
            const child = spawn(process.execPath, ['backend-server.js'], {
                cwd: ROOT,
                env: { ...process.env, BACKEND_PORT: String(port), BACKEND_HOST: '127.0.0.1', LOG_FORMAT: 'json', SENTRY_DSN_BACKEND: '', VITE_SENTRY_DSN_FRONTEND: '' },
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let out = '';
            let err = '';
            child.stdout.on('data', (c) => { out += c; });
            child.stderr.on('data', (c) => { err += c; });
            const timer = setTimeout(() => child.kill('SIGKILL'), 25_000);
            const code = await new Promise((resolve) => child.on('exit', resolve));
            clearTimeout(timer);
            assert.equal(code, 1, `stdout: ${out.slice(-500)}\nstderr: ${err.slice(-500)}`);
            assert.match(out, /❌ Backend boot failed; exiting/);
            assert.match(out, /EADDRINUSE/);
            assert.doesNotMatch(err, /UnhandledPromiseRejection|Unhandled 'error' event/);
        } finally {
            await new Promise((resolve) => blocker.close(resolve));
        }
    });
});
