// The two pure halves of the homepage's signal readers.
//
// `split-signals.js` is mostly browser I/O — a key map, a clock, a user agent — and
// those are out of scope for the Node runner. These two functions are not: they are
// where a pile of IP cards and STUN answers becomes the `geo` and `net` slices the
// server scores, which means they decide what counts as a *measured* country. A
// visitor with a mainland IPv4 and an overseas proxy has two countries on the record
// or none, and this is the code that picks.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { geoSliceFromCards, networkSlice } from '../frontend/utils/split-signals.js';

describe('geoSliceFromCards', () => {
    it('names every country the cards resolved, because two addresses is two facts', () => {
        const slice = geoSliceFromCards([
            { ip: '58.246.11.22', country_code: 'cn' },
            { ip: '2606:4700::1', country_code: 'US' },
        ]);
        assert.equal(slice.available, true);
        assert.deepEqual(slice.countries, ['CN', 'US']);
    });

    it('reports unmeasured rather than guessing when no card carried a code', () => {
        // Several sources answer a country *name* in the visitor's language and no
        // code at all; the caller then looks the address up through the same source
        // the table uses for every other exit, rather than this one inventing one.
        const slice = geoSliceFromCards([{ ip: '58.246.11.22', country: '中国' }]);
        assert.equal(slice.available, false);
        assert.equal(slice.reason, 'unresolved');
        assert.deepEqual(geoSliceFromCards([]).countries, undefined);
    });

    it('ignores a card that never produced an address', () => {
        assert.equal(geoSliceFromCards([{ country_code: 'JP' }]).available, false);
    });
});

describe('networkSlice', () => {
    const LEAK = { ip: '58.246.11.22', country_code: 'CN', org: 'AS4134' };

    it('keeps the leaked countries in a field of their own, ahead of the exits', () => {
        // The scorer reads these two lists differently: an exit says where the
        // traffic entered the internet and a leak says where the machine sits, and
        // on a split network they are different addresses in different countries.
        const slice = networkSlice({ cards: [{ country_code: 'US' }], leaks: [LEAK] });
        assert.equal(slice.available, true);
        assert.deepEqual(slice.exitCountries, ['US']);
        assert.deepEqual(slice.leakedCountries, ['CN']);
        assert.equal(slice.leakSource, 'webrtc');
    });

    it('says nothing leaked rather than leaving the field off', () => {
        const slice = networkSlice({ cards: [{ country_code: 'DE' }], leaks: [] });
        assert.deepEqual(slice.leakedCountries, []);
        assert.equal(slice.leakSource, null);
    });

    it('treats an answer with no country as nothing measured', () => {
        // A STUN server that replied with an address the geo lookup could not place
        // is a real leak with no judgement attached to it — which belongs on screen,
        // but not in the list of countries the work order is built from.
        const slice = networkSlice({ cards: [], leaks: [{ ip: '58.246.11.22', country_code: '' }] });
        assert.equal(slice.available, false);
        assert.equal(slice.reason, 'unresolved');
    });

    it('normalises a code and drops anything that is not one', () => {
        // A source that answers "CHINA" has named a country, not written a code;
        // lowercasing is the caller's job and the scorer's guard re-checks it, so
        // the one that survives here is the two-letter form.
        const slice = networkSlice({
            cards: [{ country_code: 'CHINA' }, { country_code: 'cn' }, { country_code: 'FR' }],
            leaks: [LEAK, { ip: 'x', country_code: undefined }],
        });
        assert.deepEqual(slice.exitCountries, ['CN', 'FR']);
        assert.deepEqual(slice.leakedCountries, ['CN']);
    });
});
