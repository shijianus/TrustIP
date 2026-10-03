// Tests for the anchor-waiting half of composables/use-section-hash.js — the
// rule that decides whether `/` + `#SectionId` lands on its section or silently
// does nothing. The composable itself needs a mounted route, which is Vue
// rendering territory and out of scope for the Node runner (frontend/AGENTS.md);
// `find` is injectable precisely so the wait can be covered here.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { waitForAnchor } from '../frontend/composables/use-section-hash.js';

describe('waitForAnchor', () => {
  it('takes an empty or missing hash as "nothing to wait for"', async () => {
    const never = () => assert.fail('must not look anything up');
    assert.equal(await waitForAnchor('', { find: never }), null);
    assert.equal(await waitForAnchor(undefined, { find: never }), null);
  });

  it('resolves on the first look when the anchor is already there', async () => {
    let looks = 0;
    const found = { id: 'WebRTC' };
    const result = await waitForAnchor('WebRTC', {
      find: () => { looks += 1; return found; },
    });
    assert.equal(result, found);
    assert.equal(looks, 1);
  });

  it('keeps polling until the anchor appears', async () => {
    let looks = 0;
    const found = { id: 'SpeedTest' };
    const result = await waitForAnchor('SpeedTest', {
      delay: 1,
      find: () => (++looks >= 4 ? found : null),
    });
    assert.equal(result, found);
    assert.equal(looks, 4);
  });

  it('gives up with null rather than spinning forever on a hash that names nothing', async () => {
    let looks = 0;
    const result = await waitForAnchor('NoSuchSection', { tries: 3, delay: 1, find: () => { looks += 1; return null; } });
    assert.equal(result, null);
    assert.equal(looks, 3);
  });
});
