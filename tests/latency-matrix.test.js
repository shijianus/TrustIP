// Tests for the latency grid's probe plan — the contract between this
// deployment's answer and what the visitor's browser posts to Globalping.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    LATENCY_PROBE_LOCATIONS,
    buildLatencyMatrix,
} from '../common/latency-matrix.js';

describe('latency-matrix — buildLatencyMatrix', () => {
    test('plans one cell per probe city and leaves every one waiting', () => {
        const matrix = buildLatencyMatrix('65.21.201.224');
        assert.equal(matrix.results.length, LATENCY_PROBE_LOCATIONS.length);
        assert.equal(matrix.results.length, 8);
        assert.ok(matrix.results.every((r) => r.state === 'pending' && r.ms === null));
        // The answer is a work order, never a measurement: nothing here has
        // touched the network, and the page must not be able to tell otherwise.
        assert.ok(matrix.results.every((r) => !('avg' in r) && !('loss' in r)));
    });

    test('carries a city and country the browser can join a probe result back on', () => {
        const matrix = buildLatencyMatrix('65.21.201.224');
        for (const cell of matrix.results) {
            assert.ok(cell.city && cell.country, `cell ${cell.location} is missing its join keys`);
            assert.equal(cell.location, `${cell.city}, ${cell.country}`);
        }
        assert.equal(
            new Set(matrix.results.map((c) => c.location)).size,
            matrix.results.length,
            'two cells share a location and would fight over one result',
        );
    });

    test('posts the plan in the order the cells are drawn', () => {
        const matrix = buildLatencyMatrix('65.21.201.224');
        const posted = matrix.measurement.body.locations;
        assert.deepEqual(posted.map((l) => l.city), matrix.results.map((r) => r.city));
        assert.equal(matrix.measurement.body.target, '65.21.201.224');
        assert.equal(matrix.measurement.body.type, 'ping');
    });

    test('stays inside the unauthenticated probe budget of one page view', () => {
        // Globalping caps an unauthenticated visitor at 250 probes an hour; a
        // single dossier load must not spend a visible fraction of that.
        const matrix = buildLatencyMatrix('65.21.201.224');
        const probes = matrix.measurement.body.locations.reduce((n, l) => n + (l.limit || 1), 0);
        assert.equal(probes, 8);
        assert.ok(probes <= 8, 'one probe per cell, no more');
    });

    test('names its source so the UI can attribute the numbers', () => {
        assert.equal(buildLatencyMatrix('65.21.201.224').source, 'Globalping');
    });
});

describe('latency-matrix — address families', () => {
    test('serves IPv4 without a caveat', () => {
        const matrix = buildLatencyMatrix('8.8.8.8');
        assert.equal(matrix.version, 4);
        assert.equal(matrix.addressFamily.experimental, false);
        assert.equal(matrix.unsupported, false);
    });

    test('serves IPv6 but carries the upstream’s experimental label', () => {
        const matrix = buildLatencyMatrix('2001:4860:4860::8888');
        assert.equal(matrix.version, 6);
        assert.equal(matrix.unsupported, false, 'a working measurement must not be hidden');
        assert.equal(matrix.addressFamily.experimental, true);
    });
});
