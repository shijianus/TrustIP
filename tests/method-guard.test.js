// common/method-guard.js through a real Express 5 app and socket, mounted the
// way backend-server.js and common/frontend-app.js mount it: TRACE and the
// verbs no route answers get a JSON 405 with Allow, the rest pass through.
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import express from 'express';

import { rejectUnsupportedMethods, ALLOWED_METHODS } from '../common/method-guard.js';

const request = (port, method, path = '/') => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
});

describe('rejectUnsupportedMethods under Express 5', () => {
    let server;
    let port;
    before(async () => {
        const app = express();
        app.use(rejectUnsupportedMethods);
        app.all('/{*any}', (req, res) => res.json({ method: req.method }));
        server = await new Promise((resolve) => {
            const s = http.createServer(app).listen(0, '127.0.0.1', () => resolve(s));
        });
        port = server.address().port;
    });
    after(() => server.close());

    it('answers TRACE / TRACK / WebDAV verbs with 405, Allow and no-store', async () => {
        // TRACK never gets this far: Node's HTTP parser does not know the verb and
        // answers 400 itself.
        for (const method of ['TRACE', 'DELETE', 'PATCH', 'PROPFIND', 'MKCOL']) {
            const res = await request(port, method, '/api/configs');
            assert.equal(res.status, 405, method);
            assert.equal(res.headers.allow, 'GET, HEAD, POST, PUT, OPTIONS');
            assert.equal(res.headers['cache-control'], 'no-store');
            assert.deepEqual(JSON.parse(res.body), { error: 'Method Not Allowed' });
        }
    });

    it('lets every method a route uses through', async () => {
        for (const method of ALLOWED_METHODS) {
            const res = await request(port, method, '/x');
            assert.equal(res.status, 200, method);
        }
    });
});
