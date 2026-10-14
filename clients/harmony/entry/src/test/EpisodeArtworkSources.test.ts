import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { selectEpisodeArtworkSources } from '../main/ets/core/EpisodeArtworkSources';

test('eligible episodes use still, default media frame, then series artwork in web order', () => {
  assert.deepEqual(selectEpisodeArtworkSources({ mediaFileId: 'media-1', hasEpisodeThumb: true }), [
    'episode-still', 'media-thumbnail', 'series-artwork',
  ]);
  assert.deepEqual(selectEpisodeArtworkSources({ mediaFileId: 'media-1', hasEpisodeThumb: false }), [
    'media-thumbnail', 'series-artwork',
  ]);
});

test('episodes without a resolved media file are ineligible regardless of still metadata', () => {
  assert.deepEqual(selectEpisodeArtworkSources({ mediaFileId: null, hasEpisodeThumb: true }), []);
  assert.deepEqual(selectEpisodeArtworkSources({ mediaFileId: undefined, hasEpisodeThumb: false }), []);
  assert.deepEqual(selectEpisodeArtworkSources({ mediaFileId: '', hasEpisodeThumb: true }), []);
});
