// api/maxmind.js — the error path: the client gets a fixed message per status,
// never the thrown error's text, and the error itself goes to the logger.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import maxmindHandler, { createMaxMindHandler } from '../api/maxmind.js';
import logger from '../common/logger.js';

const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
});

const withLoggedErrors = (fn) => {
    const logged = [];
    const original = logger.error;
    logger.error = (obj, msg) => { logged.push({ obj, msg }); };
    try {
        fn();
    } finally {
        logger.error = original;
    }
    return logged;
};

describe('maxmind handler errors', () => {
    it('answers 503 with a fixed message while the database is not loaded', () => {
        const res = makeRes();
        withLoggedErrors(() => maxmindHandler({ query: { ip: '8.8.8.8', lang: 'en' } }, res));
        assert.equal(res.statusCode, 503);
        assert.deepEqual(res.body, { error: 'MaxMind database is not ready' });
    });

    it('never returns the raw error message of an unexpected failure', () => {
        const secret = "ENOENT: no such file or directory, open '/srv/app/common/maxmind-db/GeoLite2-City.mmdb'";
        const handler = createMaxMindHandler(() => { throw new Error(secret); });
        const res = makeRes();
        const logged = withLoggedErrors(() => handler({ query: { ip: '8.8.8.8', lang: 'en' } }, res));
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'Internal Server Error' });
        assert.ok(!JSON.stringify(res.body).includes('/srv/app'));
        assert.equal(logged.length, 1);
        assert.equal(logged[0].obj.err.message, secret);
    });

    it('does not echo the message of a 503 thrown with custom text either', () => {
        const handler = createMaxMindHandler(() => {
            throw Object.assign(new Error('reader at /tmp/x failed'), { statusCode: 503 });
        });
        const res = makeRes();
        withLoggedErrors(() => handler({ query: { ip: '8.8.8.8' } }, res));
        assert.equal(res.statusCode, 503);
        assert.deepEqual(res.body, { error: 'MaxMind database is not ready' });
    });

    it('maps any other statusCode to a generic 500', () => {
        const handler = createMaxMindHandler(() => {
            throw Object.assign(new Error('teapot internals'), { statusCode: 418 });
        });
        const res = makeRes();
        withLoggedErrors(() => handler({ query: { ip: '8.8.8.8' } }, res));
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'Internal Server Error' });
    });
});
