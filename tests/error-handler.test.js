import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { apiNotFound, jsonErrorHandler } from '../common/error-handler.js';
import logger from '../common/logger.js';

function makeRes({ headersSent = false } = {}) {
    return {
        statusCode: null,
        body: null,
        ended: false,
        headersSent,
        headers: {},
        setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        end() { this.ended = true; return this; },
    };
}

const quietly = (fn) => {
    const original = logger.error;
    logger.error = () => {};
    try { return fn(); } finally { logger.error = original; }
};

describe('apiNotFound', () => {
    it('answers JSON 404', () => {
        const res = makeRes();
        apiNotFound({ path: '/nope' }, res);
        assert.equal(res.statusCode, 404);
        assert.deepEqual(res.body, { error: 'Not found' });
        assert.equal(res.headers['cache-control'], 'no-store');
    });
});

describe('jsonErrorHandler', () => {
    it('never puts the stack or the error message in the response', () => {
        const res = makeRes();
        const err = new TypeError('macAddress.replace is not a function');
        quietly(() => jsonErrorHandler(err, { path: '/api/macchecker' }, res, () => {}));
        assert.equal(res.statusCode, 500);
        assert.deepEqual(res.body, { error: 'Internal Server Error' });
        assert.doesNotMatch(JSON.stringify(res.body), /replace|\.js|at /);
    });

    it('keeps body-parser 400 (malformed JSON) as a JSON 400', () => {
        const res = makeRes();
        const err = Object.assign(new SyntaxError('Unexpected token b in JSON'), { status: 400, type: 'entity.parse.failed' });
        jsonErrorHandler(err, { path: '/api/split' }, res, () => {});
        assert.equal(res.statusCode, 400);
        assert.deepEqual(res.body, { error: 'Invalid request body' });
        assert.equal(res.headers['cache-control'], 'no-store');
    });

    it('keeps body-parser 413 (oversized body) as a JSON 413', () => {
        const res = makeRes();
        const err = Object.assign(new Error('request entity too large'), { status: 413, type: 'entity.too.large' });
        jsonErrorHandler(err, { path: '/api/report' }, res, () => {});
        assert.equal(res.statusCode, 413);
        assert.deepEqual(res.body, { error: 'Request body too large' });
        assert.equal(res.headers['cache-control'], 'no-store');
    });

    it('maps other 4xx to a generic message', () => {
        const res = makeRes();
        jsonErrorHandler(Object.assign(new Error('x'), { statusCode: 415 }), { path: '/api/x' }, res, () => {});
        assert.equal(res.statusCode, 415);
        assert.deepEqual(res.body, { error: 'Bad request' });
    });

    it('treats a nonsense status as 500', () => {
        const res = makeRes();
        quietly(() => jsonErrorHandler(Object.assign(new Error('x'), { status: 'teapot' }), { path: '/api/x' }, res, () => {}));
        assert.equal(res.statusCode, 500);
    });

    it('only ends the response when headers were already sent', () => {
        const res = makeRes({ headersSent: true });
        quietly(() => jsonErrorHandler(new Error('mid-stream'), { path: '/api/ip-card' }, res, () => {}));
        assert.equal(res.ended, true);
        assert.equal(res.body, null);
    });
});
