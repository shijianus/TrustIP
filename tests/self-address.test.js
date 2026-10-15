// Specs for frontend/utils/self-address.js — how bare `/ip` finds the visitor's
// own public address: already-collected entries first (IPv4 preferred), then the
// echo chains in order, and null when nothing usable answered.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pickKnownAddress, resolveSelfAddress } from '../frontend/utils/self-address.js';

describe('pickKnownAddress', () => {
    it('prefers a public IPv4 over IPv6 and skips private / invalid entries', () => {
        assert.equal(pickKnownAddress([{ ip: '10.0.0.1' }, { ip: '2606:4700:4700::1111' }, { ip: '52.26.208.45' }]), '52.26.208.45');
        assert.equal(pickKnownAddress(['192.168.1.2', '2606:4700:4700::1111']), '2606:4700:4700::1111');
        assert.equal(pickKnownAddress([{ ip: 'nope' }]), null);
        assert.equal(pickKnownAddress(), null);
    });
});

describe('resolveSelfAddress', () => {
    it('answers from known entries without asking any echo', async () => {
        let asked = 0;
        const ip = await resolveSelfAddress([{ ip: '1.1.1.1' }], [async () => { asked += 1; return { ip: '9.9.9.9' }; }]);
        assert.equal(ip, '1.1.1.1');
        assert.equal(asked, 0);
    });

    it('walks the chains past failures and unusable answers', async () => {
        const ip = await resolveSelfAddress([], [
            async () => { throw new Error('blocked'); },
            async () => ({ ip: '127.0.0.1' }),
            async () => ({ ip: '52.26.208.45' }),
        ]);
        assert.equal(ip, '52.26.208.45');
    });

    it('answers null when every chain fails', async () => {
        assert.equal(await resolveSelfAddress([], [async () => ({ ip: null })]), null);
    });
});
