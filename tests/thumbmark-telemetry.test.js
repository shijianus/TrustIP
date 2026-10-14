// The browser-fingerprint tool runs ThumbmarkJS in this origin. The library's
// own default is `logging: true`, which in a sampled fraction of sessions POSTs
// the fingerprint to api.thumbmarkjs.com and loads a remote script — on a
// privacy tool. This pins that the one place the library is constructed turns
// every remote call off, and that the installed library still needs it to.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

const SOURCE = fs.readFileSync(new URL('../frontend/components/advanced-tools/BrowserInfo.vue', import.meta.url), 'utf8');

describe('ThumbmarkJS telemetry', () => {
    it('constructs Thumbmark exactly once, with logging and experimental off and no api key', () => {
        const calls = SOURCE.match(/new Thumbmark\(\{[^}]*\}\)/g) || [];
        assert.equal(calls.length, 1, 'expected one Thumbmark constructor call');
        assert.match(calls[0], /logging:\s*false/);
        assert.match(calls[0], /experimental:\s*false/);
        assert.doesNotMatch(calls[0], /api_key|api_endpoint/);
    });

    it('is not imported anywhere else in the frontend', () => {
        const hits = [];
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) walk(full);
                else if (/\.(vue|js)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('@thumbmarkjs/thumbmarkjs')) hits.push(full);
            }
        };
        walk(new URL('../frontend', import.meta.url).pathname);
        assert.deepEqual(hits.map((h) => path.basename(h)), ['BrowserInfo.vue']);
    });

    // If a future release flips the default off, this tells whoever reads it
    // that the explicit option is now belt-and-braces rather than load-bearing.
    it('the installed library still defaults logging to on, so the option matters', () => {
        const entry = new URL(import.meta.resolve('@thumbmarkjs/thumbmarkjs'));
        const text = fs.readFileSync(entry, 'utf8');
        assert.match(text, /logging:!0/);
    });
});
