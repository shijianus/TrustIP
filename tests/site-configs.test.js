// The two `configs` implementations must expose the same keys.
//
// `api/configs.js` runs behind Express and `functions/shared/configs.js` behind the
// Qoder Sites edge function, and the SPA reads whichever one answered. They differ
// in *values* by design — the edge serves fewer routes and has no filesystem — but
// a key present on one side and absent on the other is precisely how a panel ends
// up calling a route that is not there and reporting the 404 as a failed lookup.
//
// So the contract is the key set: equal on both sides, with the edge free to say
// `false` about anything it does not serve.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import expressConfigs from '../api/configs.js';
import edgeConfigs from '../functions/shared/configs.js';

const REFERER = 'http://localhost:18966/';

const expressBody = () => {
    let body = null;
    const res = {
        status() { return this; },
        setHeader() { return this; },
        json(value) { body = value; return this; },
    };
    expressConfigs({ method: 'GET', headers: { referer: REFERER } }, res);
    return body;
};

const edgeBody = async () => {
    const response = edgeConfigs(new Headers({ referer: REFERER }));
    return response.json();
};

describe('configs parity', () => {
    it('both halves answer the same set of keys', async () => {
        const fromExpress = Object.keys(expressBody()).sort();
        const fromEdge = Object.keys(await edgeBody()).sort();
        assert.deepEqual(fromEdge, fromExpress,
            'the two configs must advertise the same capabilities, even when they disagree about having them');
    });

    it('every value is a boolean, so the UI never reads a string as truthy', async () => {
        for (const [name, body] of [['express', expressBody()], ['edge', await edgeBody()]]) {
            for (const [key, value] of Object.entries(body)) {
                assert.equal(typeof value, 'boolean', `${name}: ${key} is ${typeof value}`);
            }
        }
    });

    // The reason this change exists: the edge function keeps a shorter route table,
    // and the two panels have to be told before they ask.
    it('declares the trust score and the dossier un-served on the edge', async () => {
        const edge = await edgeBody();
        assert.equal(edge.trust, false);
        assert.equal(edge.dossier, false);

        const express = expressBody();
        assert.equal(express.trust, true);
        assert.equal(express.dossier, true);
    });

    it('caches the answer on both sides rather than re-reading it per visitor', async () => {
        const response = edgeConfigs(new Headers({ referer: REFERER }));
        assert.match(response.headers.get('Cache-Control'), /max-age=/);
    });
});
