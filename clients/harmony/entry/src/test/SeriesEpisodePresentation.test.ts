import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  EpisodeFocusGate,
  centredSeasonStackOffset,
  episodeAreaMatchesScrollOffsets,
  seriesEpisodeAreaSampleMatchesTarget,
  episodeFocusRectFromAreaVps,
  episodeFocusRectFromWindowPixels,
  hasPositiveEpisodeVisibleArea,
  hasPositiveEpisodeAreaSample,
  issueEpisodeFocusRequest,
  isSeriesEpisodeTargetFocused,
  SERIES_EPISODE_CAPTION_TITLE_GAP,
  SERIES_EPISODE_CAPTION_TOP_PADDING,
  SERIES_EPISODE_CARD_WIDTH,
  SERIES_EPISODE_LIST_HEIGHT,
  episodeIndexForTarget,
  seriesEpisodeCaption,
  seriesDetailMeasurementId,
  seriesEpisodeFocusId,
  seriesEpisodeOverlayNumber,
} from '../main/ets/core/SeriesEpisodePresentation';

describe('series episode presentation', () => {
  it('requires positive card area inside both current scroll viewports', () => {
    const card = { left: 120, top: 300, width: 268, height: 190 };
    const rail = { left: 80, top: 280, width: 700, height: 220 };
    const page = { left: 100, top: 250, width: 800, height: 716 };
    assert.equal(hasPositiveEpisodeVisibleArea(card, rail, page), true);
    assert.equal(hasPositiveEpisodeVisibleArea({ ...card, left: 900 }, rail, page), false);
    assert.equal(hasPositiveEpisodeVisibleArea({ ...card, top: 501 }, rail, page), false);
    assert.equal(hasPositiveEpisodeVisibleArea({ ...card, width: 0 }, rail, page), false);
  });

  it('rejects an area measured against stale scroll offsets', () => {
    assert.equal(episodeAreaMatchesScrollOffsets(140, 140, 62, 62), true);
    assert.equal(episodeAreaMatchesScrollOffsets(139, 140, 62, 62), false);
    assert.equal(episodeAreaMatchesScrollOffsets(140, 140, 61, 62), false);
  });

  it('revalidates a pre-plan paired sample against the resolved identity and live offsets', () => {
    const captured = {
      workId: 'work-a', generation: 4, railId: 'season-a', episodeId: 'episode-a', occurrence: 0,
      pageOffset: 130, railOffset: 42, capturedAtMs: 1791910000123,
    };
    const matchesPlan = (): boolean => seriesEpisodeAreaSampleMatchesTarget(
      captured, 'work-a', 4, 'season-a', 'episode-a', 0, 130, 42
    );
    assert.equal(matchesPlan(), true);
    assert.equal(seriesEpisodeAreaSampleMatchesTarget(captured, 'work-b', 4, 'season-a', 'episode-a', 0, 130, 42), false);
    assert.equal(seriesEpisodeAreaSampleMatchesTarget(captured, 'work-a', 5, 'season-a', 'episode-a', 0, 130, 42), false);
    assert.equal(seriesEpisodeAreaSampleMatchesTarget(captured, 'work-a', 4, 'season-b', 'episode-a', 0, 130, 42), false);
    assert.equal(seriesEpisodeAreaSampleMatchesTarget(captured, 'work-a', 4, 'season-a', 'episode-b', 0, 130, 42), false);
    assert.equal(seriesEpisodeAreaSampleMatchesTarget(captured, 'work-a', 4, 'season-a', 'episode-a', 1, 130, 42), false);
    assert.equal(seriesEpisodeAreaSampleMatchesTarget(captured, 'work-a', 4, 'season-a', 'episode-a', 0, 130.6, 42), false);
    assert.equal(seriesEpisodeAreaSampleMatchesTarget({ ...captured, capturedAtMs: Number.NaN },
      'work-a', 4, 'season-a', 'episode-a', 0, 130, 42), false);
  });

  it('converts valid ComponentUtils window pixels to vp and fails closed on invalid rectangles', () => {
    const rect = episodeFocusRectFromWindowPixels(240, 600, 536, 302, (value: number): number => value / 2);
    assert.deepEqual(rect, { left: 120, top: 300, width: 268, height: 151 });
    assert.equal(episodeFocusRectFromWindowPixels(Number.NaN, 0, 20, 20, (value: number): number => value), null);
    assert.equal(episodeFocusRectFromWindowPixels(0, 0, 0, 20, (value: number): number => value), null);
    assert.equal(episodeFocusRectFromWindowPixels(0, 0, 20, 20, (_value: number): number => Number.NaN), null);
    assert.equal(episodeFocusRectFromWindowPixels(0, 0, 20, 20, (_value: number): number => {
      throw new Error('conversion failed');
    }), null);
  });

  it('accepts finite positive global Area bounds in vp and rejects missing or invalid values', () => {
    assert.deepEqual(episodeFocusRectFromAreaVps(120, 300, 268, 151),
      { left: 120, top: 300, width: 268, height: 151 });
    assert.equal(episodeFocusRectFromAreaVps(null, 300, 268, 151), null);
    assert.equal(episodeFocusRectFromAreaVps(120, null, 268, 151), null);
    assert.equal(episodeFocusRectFromAreaVps(120, 300, null, 151), null);
    assert.equal(episodeFocusRectFromAreaVps(120, 300, 268, null), null);
    assert.equal(episodeFocusRectFromAreaVps(Number.NaN, 300, 268, 151), null);
    assert.equal(episodeFocusRectFromAreaVps(120, Number.POSITIVE_INFINITY, 268, 151), null);
    assert.equal(episodeFocusRectFromAreaVps(120, 300, 0, 151), null);
    assert.equal(episodeFocusRectFromAreaVps(120, 300, 268, -1), null);
    assert.equal(episodeFocusRectFromAreaVps(Number.MAX_VALUE, 300, Number.MAX_VALUE, 151), null);
  });

  it('accepts a paired positive Area and finite offsets as mounted evidence only', () => {
    const card = episodeFocusRectFromAreaVps(12, 24, 268, 151);
    assert.equal(hasPositiveEpisodeAreaSample(card, 0, -229), true);
    assert.equal(hasPositiveEpisodeAreaSample(null, 0, 0), false);
    assert.equal(hasPositiveEpisodeAreaSample(card, null, 0), false);
    assert.equal(hasPositiveEpisodeAreaSample(card, 0, null), false);
    assert.equal(hasPositiveEpisodeAreaSample(card, Number.NaN, 0), false);
    assert.equal(hasPositiveEpisodeAreaSample({ ...card!, width: 0 }, 0, 0), false);
  });

  it('scopes measurement IDs by route context, rail, episode and repeated occurrence without changing focus IDs', () => {
    const first = seriesDetailMeasurementId('image', 'work-a', 4, 'rail-a', 'episode-a', 0);
    assert.equal(first, seriesDetailMeasurementId('image', 'work-a', 4, 'rail-a', 'episode-a', 0));
    assert.notEqual(first, seriesDetailMeasurementId('card', 'work-a', 4, 'rail-a', 'episode-a', 0));
    assert.notEqual(first, seriesDetailMeasurementId('image', 'work-b', 4, 'rail-a', 'episode-a', 0));
    assert.notEqual(first, seriesDetailMeasurementId('image', 'work-a', 5, 'rail-a', 'episode-a', 0));
    assert.notEqual(first, seriesDetailMeasurementId('image', 'work-a', 4, 'rail-b', 'episode-a', 0));
    assert.notEqual(first, seriesDetailMeasurementId('image', 'work-a', 4, 'rail-a', 'episode-b', 0));
    assert.notEqual(first, seriesDetailMeasurementId('image', 'work-a', 4, 'rail-a', 'episode-a', 1));
    assert.equal(seriesEpisodeFocusId('episode-a'), 'detail-episode-episode-a');
  });

  it('formats season and episode captions and art overlay numbers', () => {
    assert.equal(seriesEpisodeCaption(1, 2), 'S01 · E02');
    assert.equal(seriesEpisodeCaption(12, 103), 'S12 · E103');
    assert.equal(seriesEpisodeOverlayNumber(1), '01');
    assert.equal(seriesEpisodeOverlayNumber(12), '12');
    assert.equal(seriesEpisodeFocusId('episode-a'), 'detail-episode-episode-a');
  });

  it('reports final focus from the currently focused episode row', () => {
    assert.equal(isSeriesEpisodeTargetFocused('episode-a', 'episode-a'), true);
    assert.equal(isSeriesEpisodeTargetFocused('episode-b', 'episode-a'), false);
    assert.equal(isSeriesEpisodeTargetFocused('episode-a', null), false);
  });

  it('keeps the measured 16:9 card size and gives the List an explicit caption/clip height', () => {
    assert.equal(SERIES_EPISODE_CARD_WIDTH, 268);
    assert.equal(Math.round(SERIES_EPISODE_CARD_WIDTH * 9 / 16), 151);
    assert.equal(SERIES_EPISODE_CAPTION_TOP_PADDING, 11.52);
    assert.equal(SERIES_EPISODE_CAPTION_TITLE_GAP, 8.8);
    assert.ok(SERIES_EPISODE_LIST_HEIGHT >= 151 + 42 + 24);
    assert.equal(episodeIndexForTarget(['episode-a', 'episode-b', 'episode-c'], 'episode-b', true), 1);
    assert.equal(episodeIndexForTarget(['episode-a'], 'episode-b', true), -1);
    assert.equal(episodeIndexForTarget(['episode-a'], 'episode-a', false), -1);
  });

  it('centres the target season row in the stack and clamps at the start', () => {
    assert.equal(centredSeasonStackOffset(900, 220, 716), 652);
    assert.equal(centredSeasonStackOffset(200, 220, 716), 0);
  });

  it('waits for the target card, claims once, and leaves an already-focused target alone', () => {
    const gate = new EpisodeFocusGate();
    assert.equal(gate.claim('episode-a', false, true), 'none');
    assert.equal(gate.claim('episode-a', true, false), 'none');
    assert.equal(gate.isPending(), true);
    assert.equal(gate.claim('episode-a', true, true), 'request');
    assert.equal(gate.beginRequest(), true);
    assert.equal(gate.isPending(), false);
    assert.equal(gate.claim('episode-a', true, true), 'none');

    const focusedGate = new EpisodeFocusGate();
    focusedGate.recordCurrentFocus('episode-b', 'episode-b');
    assert.equal(focusedGate.claim('episode-b', true, false), 'already-focused');
    assert.equal(focusedGate.claim('episode-b', true, true), 'none');
  });

  it('keeps the focus gate pending until visibility allows a request', () => {
    const gate = new EpisodeFocusGate();
    assert.equal(gate.claim('episode-a', true, false), 'none');
    assert.equal(gate.isPending(), true);
    assert.equal(gate.claim('episode-a', true, true), 'request');
    assert.equal(gate.beginRequest(), true);
    assert.equal(gate.isPending(), false);
  });

  it('prevents synchronous focus re-entry and rolls a thrown request back to pending', () => {
    const gate = new EpisodeFocusGate();
    assert.equal(gate.claim('episode-a', true, true), 'request');
    assert.equal(gate.beginRequest(), true);
    const issuedAfterThrow = issueEpisodeFocusRequest((): void => { throw new Error('unavailable'); });
    if (!issuedAfterThrow) {
      gate.rollbackRequest();
    }
    assert.equal(gate.isPending(), true);
    assert.equal(gate.claim('episode-a', true, true), 'request');
    assert.equal(gate.beginRequest(), true);
    let requestCalls = 0;
    const issued = issueEpisodeFocusRequest((): void => {
      requestCalls += 1;
      gate.recordCurrentFocus('episode-a', 'episode-a');
      assert.equal(gate.claim('episode-a', true, true), 'none');
    });
    assert.equal(issued, true);
    assert.equal(requestCalls, 1);
    assert.equal(gate.claim('episode-a', true, true), 'none');
    assert.equal(gate.isPending(), false);

    const issuedGate = new EpisodeFocusGate();
    assert.equal(issuedGate.claim('episode-a', true, true), 'request');
    assert.equal(issuedGate.beginRequest(), true);
    assert.equal(issuedGate.claim('episode-a', true, true), 'none');
    issuedGate.recordCurrentFocus('episode-a', 'episode-a');
    assert.equal(issuedGate.isPending(), false);

    const cancelledGate = new EpisodeFocusGate();
    assert.equal(cancelledGate.beginRequest(), true);
    cancelledGate.cancel();
    cancelledGate.rollbackRequest();
    assert.equal(cancelledGate.claim('episode-a', true, true), 'none');

    const cancelledDuringCallGate = new EpisodeFocusGate();
    assert.equal(cancelledDuringCallGate.claim('episode-a', true, true), 'request');
    assert.equal(cancelledDuringCallGate.beginRequest(), true);
    const cancelledCallIssued = issueEpisodeFocusRequest((): void => {
      cancelledDuringCallGate.cancel();
      throw new Error('unavailable after input');
    });
    if (!cancelledCallIssued) {
      cancelledDuringCallGate.rollbackRequest();
    }
    assert.equal(cancelledDuringCallGate.isPending(), false);
    assert.equal(cancelledDuringCallGate.claim('episode-a', true, true), 'none');
  });

  it('ignores unrelated initial focus but cancels after explicit user input', () => {
    const autoFocusedActionGate = new EpisodeFocusGate();
    autoFocusedActionGate.recordCurrentFocus('', 'episode-a');
    assert.equal(autoFocusedActionGate.isPending(), true);
    assert.equal(autoFocusedActionGate.claim('episode-a', true, true), 'request');

    const nonTargetEpisodeGate = new EpisodeFocusGate();
    nonTargetEpisodeGate.recordCurrentFocus('episode-b', 'episode-a');
    assert.equal(nonTargetEpisodeGate.claim('episode-a', true, true), 'request');

    const changingFocusGate = new EpisodeFocusGate();
    changingFocusGate.recordCurrentFocus('episode-a', 'episode-a');
    changingFocusGate.recordCurrentFocus('episode-b', 'episode-a');
    assert.equal(changingFocusGate.claim('episode-a', true, true), 'request');

    const inputGate = new EpisodeFocusGate();
    inputGate.cancel();
    assert.equal(inputGate.claim('episode-a', true, true), 'none');

    const focusGate = new EpisodeFocusGate();
    focusGate.recordCurrentFocus('episode-b', 'episode-b');
    assert.equal(focusGate.claim('episode-a', false, true), 'none');
    assert.equal(focusGate.isPending(), false);
  });
});
