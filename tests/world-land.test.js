// Tests for the TopoJSON → SVG coastline decoder.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import landTopology from 'world-atlas/land-110m.json' with { type: 'json' };
import { landPathsFrom, WORLD_MAP_SIZE } from '../frontend/utils/world-land.js';

// A unit square built from four arcs, so stitching and the projection are both
// exercised by numbers small enough to check by hand.
const SQUARE = {
    transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [
        [[0, 0], [10, 0]],
        [[10, 0], [0, 10]],
        [[10, 10], [-10, 0]],
        [[0, 10], [0, -10]],
    ],
    objects: {
        land: {
            type: 'GeometryCollection',
            geometries: [{ type: 'Polygon', arcs: [[0, 1, 2, 3]] }],
        },
    },
};

describe('world-land — landPathsFrom', () => {
    test('stitches a forward ring and projects it into the 360x180 space', () => {
        const [path] = landPathsFrom(SQUARE);
        // lon 0..10 → x 180..190, lat 0..10 → y 90..80, closing where it opened.
        assert.equal(path, 'M180 90L190 90L190 80L180 80L180 90Z');
    });

    test('traverses a negatively-indexed arc backwards', () => {
        // `-4 .. -1` are `~(-4) === 3` down to `~(-1) === 0`: the same square
        // walked the other way round, so the vertices come out in reverse.
        const rewound = {
            ...SQUARE,
            objects: { land: { geometries: [{ type: 'Polygon', arcs: [[-4, -3, -2, -1]] }] } },
        };
        assert.equal(landPathsFrom(rewound)[0], 'M180 90L180 80L190 80L190 90L180 90Z');
    });

    test('keeps a polygon hole in the same path so even-odd carving works', () => {
        const withHole = {
            ...SQUARE,
            objects: { land: { geometries: [{ type: 'Polygon', arcs: [[0, 1, 2, 3], [0, 1, 2, 3]] }] } },
        };
        const paths = landPathsFrom(withHole);
        assert.equal(paths.length, 1, 'one polygon, one path');
        assert.equal(paths[0].split('M').length - 1, 2, 'two subpaths: outline and hole');
    });

    test('drops a ring too short to enclose anything', () => {
        const degenerate = {
            ...SQUARE,
            objects: { land: { geometries: [{ type: 'Polygon', arcs: [[[0]]] }] } },
        };
        assert.deepEqual(landPathsFrom(degenerate), []);
    });

    test('handles a Polygon and a MultiPolygon geometry alike', () => {
        const multi = {
            ...SQUARE,
            objects: {
                land: {
                    geometries: [
                        { type: 'Polygon', arcs: [[0, 1, 2, 3]] },
                        { type: 'MultiPolygon', arcs: [[[0, 1, 2, 3]], [[0, 1, 2, 3]]] },
                    ],
                },
            },
        };
        assert.equal(landPathsFrom(multi).length, 3);
    });
});

describe('world-land — the shipped topology', () => {
    test('decodes into a usable number of coastline paths', () => {
        const paths = landPathsFrom(landTopology);
        assert.ok(paths.length > 40, `expected dozens of polygons, got ${paths.length}`);
        assert.ok(paths.every((d) => d.startsWith('M') && d.endsWith('Z')));
    });

    test('lands the drawing inside the panel it is drawn on', () => {
        const nums = landPathsFrom(landTopology)
            .join('')
            .match(/-?[\d.]+/g)
            .map(Number);
        const xs = nums.filter((_, i) => i % 2 === 0);
        const ys = nums.filter((_, i) => i % 2 === 1);
        assert.ok(Math.min(...xs) >= 0 && Math.max(...xs) <= WORLD_MAP_SIZE.width);
        assert.ok(Math.min(...ys) >= 0 && Math.max(...ys) <= WORLD_MAP_SIZE.height);
        // A map that only covered a corner would pass the bounds check above.
        assert.ok(Math.max(...xs) - Math.min(...xs) > 300, 'spans nearly the full width');
        assert.ok(Math.max(...ys) - Math.min(...ys) > 150, 'spans nearly the full height');
    });

    test('draws a coastline through the Gulf of Finland', () => {
        // The panel plots an address against these paths, so the geometry has
        // to agree with the degrees: Helsinki sits on the shore, and the water
        // a few degrees south of it is where the same ring must dip.
        const x = 24.94 + 180;
        const y = 90 - 60.17;
        const vertices = landPathsFrom(landTopology)
            .join('')
            .match(/-?[\d.]+ -?[\d.]+/g)
            .map((pair) => pair.split(' ').map(Number));
        const near = vertices.filter(([vx, vy]) => Math.abs(vx - x) < 3 && Math.abs(vy - y) < 3);
        assert.ok(near.length >= 3, `expected the shore near Helsinki to be drawn, found ${near.length} vertices`);
    });
});
