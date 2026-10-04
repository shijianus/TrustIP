// Gate for the homepage routing table's data and its two pure helpers.
//
// `data/site-split.js` is contributor-editable, so the invariant that matters
// is spelled out here: a row only belongs in the table if its host can be
// asked for the caller's address. That is a property of the destination, not
// of this repo, so it cannot be asserted — but everything that makes the list
// usable and unambiguous can be.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    SPLIT_SITES,
    CONNECTIVITY_PROBES,
    PROBE_SAMPLES,
    PROBE_TONES,
    probeTone,
} from '../frontend/data/site-split.js';
import { parseTrace } from '../frontend/composables/use-site-split.js';

describe('parseTrace — the cdn-cgi/trace body', () => {
    it('reads a flat key=value body', () => {
        const fields = parseTrace('fl=1407f99\nh=www.cloudflare.com\nip=1.2.3.4\ncolo=LAX\nloc=US\n');
        assert.equal(fields.ip, '1.2.3.4');
        assert.equal(fields.loc, 'US');
        assert.equal(fields.colo, 'LAX');
    });

    it('tolerates CRLF and surrounding whitespace', () => {
        assert.equal(parseTrace('ip=5.6.7.8\r\nts=1791099919.000\r\n').ip, '5.6.7.8');
        assert.equal(parseTrace('  ip = 9.9.9.9  ').ip.trim(), '9.9.9.9');
    });

    it('splits on the first equals only, so a value may contain one', () => {
        assert.equal(parseTrace('uag=a=b').uag, 'a=b');
    });

    it('ignores lines with no value and non-text input', () => {
        assert.deepEqual(parseTrace(''), {});
        assert.deepEqual(parseTrace(null), {});
        assert.deepEqual(parseTrace(undefined), {});
        assert.equal(parseTrace('no-equals-here\nip=1.1.1.1').ip, '1.1.1.1');
    });
});

describe('probeTone — the latency colour bands', () => {
    it('bands fast, middling and slow', () => {
        assert.equal(probeTone(12), 'ok-fast');
        assert.equal(probeTone(99), 'ok-fast');
        assert.equal(probeTone(100), 'ok-slow');
        assert.equal(probeTone(299), 'ok-slow');
        assert.equal(probeTone(300), 'fail');
        assert.equal(probeTone(9000), 'fail');
    });

    it('always resolves, because every probe result must be colourable', () => {
        assert.equal(PROBE_TONES[PROBE_TONES.length - 1].ceiling, Infinity);
        assert.equal(typeof probeTone(0), 'string');
    });
});

describe('site-split data — the routing table', () => {
    it('asks each destination at most once', () => {
        const hosts = SPLIT_SITES.map((s) => s.host);
        assert.equal(new Set(hosts).size, hosts.length, 'duplicate host');
    });

    it('stores bare hostnames, because the probe builds the URL itself', () => {
        for (const site of SPLIT_SITES) {
            assert.doesNotMatch(site.host, /^https?:\/\//, site.host);
            assert.doesNotMatch(site.host, /\//, `${site.host} carries a path`);
            assert.doesNotMatch(site.host, /\s/, `${site.host} carries whitespace`);
        }
    });

    it('labels every row with a name, a group and a region from the two-value set', () => {
        for (const site of SPLIT_SITES) {
            assert.ok(site.name?.length > 0, 'unnamed row');
            assert.ok(['AI', 'Social', 'Media', 'Crypto', 'Dev', 'Static', 'Tools', 'Speed'].includes(site.group),
                `${site.name}: unexpected group ${site.group}`);
            assert.ok(['domestic', 'international'].includes(site.region),
                `${site.name}: unexpected region ${site.region}`);
        }
    });

    it('keeps the domestic side a deliberate minority', () => {
        // The domestic tag is the table's reference point — the side a split is
        // measured against — so it must stay small and intentional rather than
        // accrete every Chinese-sounding brand.
        const domestic = SPLIT_SITES.filter((s) => s.region === 'domestic');
        assert.ok(domestic.length >= 1 && domestic.length <= 6, `${domestic.length} domestic rows`);
    });

    it('has more rows than the strip has probes', () => {
        assert.ok(SPLIT_SITES.length > CONNECTIVITY_PROBES.length);
    });
});

describe('connectivity probes', () => {
    it('names a bare host per destination and a country to flag it with', () => {
        for (const probe of CONNECTIVITY_PROBES) {
            assert.doesNotMatch(probe.host, /^https?:\/\//, probe.host);
            assert.match(probe.country, /^[A-Z]{2}$/, `${probe.name}: country must be alpha-2`);
        }
    });

    it('samples enough times to show variance, and few enough to finish', () => {
        assert.ok(PROBE_SAMPLES >= 6 && PROBE_SAMPLES <= 20, `${PROBE_SAMPLES} samples`);
    });
});
