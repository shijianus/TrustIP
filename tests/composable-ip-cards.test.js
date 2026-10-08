// The gate in front of `ipinfo:finished`.
//
// The event is the homepage's only source for the countries its own addresses
// resolve to, and the routing table builds its work order out of exactly that list —
// so a snapshot that fires before every visible card has landed is not merely early,
// it is missing a country. When the card grid was extracted out of `IpInfos.vue` the
// settle check lost its accumulator (`allHasFetched && status[i][i]` → `status[i][i]`)
// and quietly became "did the last card land", which is the case pinned below.
//
// Importing the composable pulls in the real Pinia store and the vue-i18n runtime, so
// the same browser globals `composable-maxmind.test.js` installs go first.

globalThis.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] ?? null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; },
  clear() { this._data = {}; },
};
globalThis.window = {
  location: { search: '' },
  addEventListener() {},
  innerWidth: 1024,
};
globalThis.document = {
  addEventListener() {},
  title: '',
  querySelector() { return null; },
  createElement() { return {}; },
  documentElement: { classList: { toggle() {} } },
};

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { allCardsSettled } = await import('../frontend/composables/use-ip-cards.js');

// The store's own shape: a card writes `{ [its index]: true }` into its slot when it
// lands, so the array is sparse until the whole grid has answered.
const settled = (...indexes) => {
  const status = [];
  for (const i of indexes) status[i] = { [i]: true };
  return status;
};

describe('allCardsSettled', () => {
  it('waits for the whole visible grid', () => {
    assert.equal(allCardsSettled(settled(0, 1, 2, 3), 4), true);
  });

  it('refuses a grid whose last card landed first', () => {
    // The regression: cards 0, 2 and 3 are in and card 1 is still in flight. Read
    // off the last index, that looks finished; read as a fold over the visible
    // cards, it is not.
    assert.equal(allCardsSettled(settled(0, 2, 3), 4), false);
  });

  it('ignores cards past the display count', () => {
    // `ipCardsToShow` is a visitor preference. A settled card the page has hidden
    // must not hold the event back, and a hidden card that never ran must not
    // prevent it.
    assert.equal(allCardsSettled(settled(0, 1), 2), true);
    assert.equal(allCardsSettled(settled(0, 1, 5), 2), true);
  });

  it('reports an empty grid as settled', () => {
    // Nothing is pending when nothing is shown, so the caller can still emit the
    // (empty) snapshot rather than wait for a card that will never arrive.
    assert.equal(allCardsSettled([], 0), true);
  });

  it('treats a slot that is present but not true as in flight', () => {
    assert.equal(allCardsSettled([{ 0: false }, { 1: true }], 2), false);
  });
});
