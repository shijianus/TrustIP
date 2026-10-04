// World coastlines as SVG paths, for the panels that plot a coordinate and
// need to say which continent it landed on.
//
// `world-atlas` ships its geometry as TopoJSON: quantized, delta-encoded arcs
// that are shared between neighbouring polygons. Decoding it here rather than
// pulling in a renderer keeps this a few dozen lines and — the actual reason —
// keeps the map off the network. The alternative already in the repo is a
// Pacific-centred WebP with Chinese labels baked in, which puts a marker at
// the wrong place and shows text no locale asked for.
//
// Output is a list of path strings in the equirectangular space the callers
// already draw in: 360 wide by 180 tall, so `x = lon + 180` and
// `y = 90 - lat` and a plotted point needs no second projection to agree with
// the coastline under it.

const W = 360;
const H = 180;

// Quantized arc → [lon, lat] pairs. Coordinates in a TopoJSON arc are deltas
// on integers; the transform turns the running total back into degrees.
const decodeArc = (arc, { scale, translate }) => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
        x += dx;
        y += dy;
        return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
};

// One ring of a polygon: its arc indices, stitched. A negative index means the
// arc is traversed backwards, and every junction repeats a point.
const stitchRing = (indices, arcs, transform) => {
    const points = [];
    for (const raw of indices) {
        const reversed = raw < 0;
        const decoded = decodeArc(arcs[reversed ? ~raw : raw], transform);
        const ordered = reversed ? [...decoded].reverse() : decoded;
        // Every junction repeats the previous arc's last point — except the
        // first arc, which has nothing before it.
        points.push(...(points.length ? ordered.slice(1) : ordered));
    }
    return points;
};

const round = (n) => Math.round(n * 10) / 10;

// Degrees → the 360x180 drawing space, with the ring closed.
const ringToPath = (ring) => ring
    .map(([lon, lat], i) => `${i ? 'L' : 'M'}${round(lon + 180)} ${round(90 - lat)}`)
    .join('') + 'Z';

/**
 * Turn a TopoJSON land topology into path strings. Pure, so the projection and
 * the arc stitching can be tested without a browser or the 55 kB file.
 *
 * @param {object} topology  a `world-atlas` topology with a `land` object
 * @returns {string[]}  one `d` attribute per polygon ring
 */
export const landPathsFrom = (topology) => {
    const { transform, arcs } = topology;
    const paths = [];
    for (const geometry of topology.objects.land.geometries) {
        // Polygon: rings of arc indices. MultiPolygon: a list of those.
        const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
        for (const polygon of polygons) {
            // Every ring of the polygon goes into one path — the first is the
            // outline and the rest carve inland water (the Caspian, the Great
            // Lakes) — which is what the caller's `fill-rule: evenodd` reads.
            const rings = polygon
                .map((ring) => stitchRing(ring, arcs, transform))
                .filter((points) => points.length > 2);
            if (rings.length) paths.push(rings.map(ringToPath).join(''));
        }
    }
    return paths;
};

export const WORLD_MAP_SIZE = { width: W, height: H };

// Memoized as a promise, like the chart loader: two panels mounting at once
// must cost one download, and a failed one must be retryable rather than
// cached as null.
let request = null;

/**
 * @returns {Promise<string[]>}  coastline paths, or `[]` if the data did not
 *   arrive — every caller treats the map as decoration, never as the answer.
 */
export const loadWorldLand = () => {
    if (!request) {
        request = import('world-atlas/land-110m.json')
            .then((mod) => landPathsFrom(mod.default ?? mod))
            .catch(() => {
                request = null;
                return [];
            });
    }
    return request;
};
