import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { seriesPhoneActionIds } from '../main/ets/core/PhoneDetailActions';

describe('Harmony phone series-detail actions', () => {
  it('keeps the resolved primary action and the two web secondary actions in one ordered row', () => {
    assert.deepEqual(seriesPhoneActionIds(true), ['primary', 'watchlist', 'playlist']);
  });

  it('keeps watchlist and playlist available while omitting an unavailable primary action', () => {
    assert.deepEqual(seriesPhoneActionIds(false), ['watchlist', 'playlist']);
  });
});
