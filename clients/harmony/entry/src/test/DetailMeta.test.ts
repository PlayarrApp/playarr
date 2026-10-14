import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { hasSeriesResumeTarget, planEpisode, planSynopsis } from '../main/ets/core/DetailMeta';
import type { ResumePlan } from '../main/ets/core/Types/ResumePlan';
import type { EpisodeDetail, SeasonDetail, WorkDetail } from '../main/ets/core/Types/WorkDetail';

function episode(id: string, seasonId: string, number: number, overview: string | null): EpisodeDetail {
  return {
    episode: {
      id: id,
      season_id: seasonId,
      episode_number: number,
      title: 'Test Episode ' + number,
      overview: overview,
      images: [],
      monitored: true,
      availability: 'available',
    },
  };
}

function season(number: number, overview: string | null, episodes: EpisodeDetail[]): SeasonDetail {
  return {
    season: {
      id: 'season-' + number,
      series_work_id: 'sample-series',
      season_number: number,
      overview: overview,
      monitored: true,
      availability: 'available',
    },
    episodes: episodes,
  };
}

function detail(kind: 'series' | 'movie', episodeOverview: string | null = 'Selected episode overview',
                selectedSeasonOverview: string | null = 'Selected season overview',
                workOverview: string | null = 'Work overview'): WorkDetail {
  const workId = 'sample-series';
  const children = kind === 'series'
    ? {
      Series: [
        season(1, 'Other season overview', [
          episode('episode-1-1', 'season-1', 1, 'Other episode overview'),
          episode('episode-1-2', 'season-1', 2, null),
        ]),
        season(2, selectedSeasonOverview, [
          episode('episode-2-1', 'season-2', 1, 'Unselected episode overview'),
          episode('episode-2-2', 'season-2', 2, episodeOverview),
        ]),
      ],
    }
    : 'Movie' as const;
  return {
    work: {
      id: workId,
      kind: kind,
      external_refs: [],
      title: 'Sample Work',
      sort_title: 'sample work',
      overview: workOverview,
      images: [],
      genres: [],
      tags: [],
      added_at: '2026-01-01T00:00:00Z',
      release_date: null,
      monitored: true,
      availability: 'available',
    },
    children: children,
    media_file_id: null,
    runtime_ms: null,
    available_on: [],
  };
}

function plan(seriesWorkId = 'sample-series', episodeId = 'episode-2-2'): ResumePlan {
  return {
    series_work_id: seriesWorkId,
    action: 'start',
    reason: 'test',
    needs_choice: false,
    options: [],
    target: {
      kind: 'next_in_series',
      episode_id: episodeId,
      media_file_id: 'sample-file',
      season_number: 2,
      episode_number: 2,
      label: 'S02E02',
      position_ms: 0,
      duration_ms: 1,
      progress_percent: 0,
    },
  };
}

describe('series resume detail copy', () => {
  it('uses the target episode across multiple seasons, not the first row', () => {
    const current = detail('series');
    const selected = planEpisode(current, plan());
    assert.equal(selected?.episode.id, 'episode-2-2');
    assert.equal(hasSeriesResumeTarget(current, plan()), true);
  });

  it('rejects a target for another work, an unlisted episode, or a non-series work', () => {
    const current = detail('series');
    assert.equal(hasSeriesResumeTarget(current, plan('different-series')), false);
    assert.equal(hasSeriesResumeTarget(current, plan('sample-series', 'missing-episode')), false);
    const noTarget: ResumePlan = { ...plan(), target: null };
    assert.equal(hasSeriesResumeTarget(current, noTarget), false);
    const movie = detail('movie');
    assert.equal(planEpisode(movie, plan()), undefined);
    assert.equal(hasSeriesResumeTarget(movie, plan()), false);
  });

  it('uses episode overview, then its own season overview, then work overview', () => {
    const current = detail('series');
    assert.equal(planSynopsis(current, plan()), 'Selected episode overview');

    const withoutEpisodeOverview = detail('series', null);
    assert.equal(planSynopsis(withoutEpisodeOverview, plan()), 'Selected season overview');

    const withoutEither = detail('series', null, null);
    assert.equal(planSynopsis(withoutEither, plan()), 'Work overview');

    const withoutAnyOverview = detail('series', null, null, null);
    assert.equal(planSynopsis(withoutAnyOverview, plan()), '');
  });
});
