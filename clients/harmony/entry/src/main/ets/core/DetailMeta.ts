/** The detail page's meta chips (web phone `.work-meta`): kind, runtime, year, release date and genres for a film; season, episode, runtime, year span, air date and genres for a series. Pure, shared by every layout. */

import type { WorkDetail, EpisodeDetail, SeasonDetail, WorkChildrenSeries } from './Types/WorkDetail';
import type { ResumePlan } from './Types/ResumePlan';

/** A series' seasons, [] for any other kind (`children` is the bare string "Movie" or a single-key object). */
function seasonsOf(detail: WorkDetail): SeasonDetail[] {
  const children = detail.children;
  if (typeof children === 'string') {
    return [];
  }
  const series: WorkChildrenSeries = children as WorkChildrenSeries;
  return series.Series !== undefined ? series.Series : [];
}

const MONTHS: string[] = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** "5 Jun 2003" from an ISO date (en-GB short month, as web), or '' for a missing or malformed one. */
export function formatDayMonthYear(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.length < 10) {
    return '';
  }
  const month = parseInt(iso.substring(5, 7), 10);
  const day = parseInt(iso.substring(8, 10), 10);
  if (month < 1 || month > 12 || day < 1) {
    return '';
  }
  return day.toString() + ' ' + MONTHS[month - 1] + ' ' + iso.substring(0, 4);
}

function runtimeLabel(minutes: number): string {
  if (minutes <= 0) {
    return '';
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) {
    return minutes.toString() + ' min';
  }
  return rest > 0 ? hours.toString() + 'h ' + rest.toString() + 'm' : hours.toString() + 'h';
}

function two(n: number): string {
  return n < 10 ? '0' + n.toString() : n.toString();
}

/** The plan's target episode (with its season), or undefined without a plan or when the detail does not list it. */
export function planEpisode(detail: WorkDetail, plan: ResumePlan | null): EpisodeDetail | undefined {
  if (plan === null || plan.target === undefined || plan.target === null) {
    return undefined;
  }
  const wanted = plan.target.episode_id;
  const seasons: SeasonDetail[] = seasonsOf(detail);
  for (const season of seasons) {
    for (const item of season.episodes) {
      if (item.episode.id === wanted) {
        return item;
      }
    }
  }
  return undefined;
}

/** The last year a series has an episode air, to write "2011–2017"; '' when none is known. */
function lastAiredYear(detail: WorkDetail): string {
  const seasons: SeasonDetail[] = seasonsOf(detail);
  let latest = '';
  for (const season of seasons) {
    for (const item of season.episodes) {
      const air = item.episode.air_date;
      if (air !== undefined && air !== null && air.length >= 4 && air.substring(0, 4) > latest) {
        latest = air.substring(0, 4);
      }
    }
  }
  return latest;
}

/** The chips, in web's order. A film: Movie, runtime, year, "Released d Mon yyyy", genres. A series with a plan target: "Season n", "S01 · E01", runtime, "2011–2017", "Aired d Mon yyyy", genres. */
export function metaChips(detail: WorkDetail, plan: ResumePlan | null): string[] {
  const work = detail.work;
  const chips: string[] = [];
  const year = work.release_date !== null && work.release_date.length >= 4 ? work.release_date.substring(0, 4) : '';
  if (work.kind === 'series') {
    const target = planEpisode(detail, plan);
    if (plan !== null && plan.target !== undefined && plan.target !== null) {
      chips.push('Season ' + plan.target.season_number.toString());
      chips.push('S' + two(plan.target.season_number) + ' · E' + two(plan.target.episode_number));
    }
    if (target !== undefined && target.episode.runtime_minutes !== undefined && target.episode.runtime_minutes !== null) {
      const runtime = runtimeLabel(target.episode.runtime_minutes);
      if (runtime.length > 0) {
        chips.push(runtime);
      }
    }
    const last = lastAiredYear(detail);
    if (year.length > 0) {
      chips.push(last.length > 0 && last !== year ? year + '–' + last : year);
    }
    if (target !== undefined) {
      const aired = formatDayMonthYear(target.episode.air_date);
      if (aired.length > 0) {
        chips.push('Aired ' + aired);
      }
    }
  } else {
    chips.push(work.kind === 'movie' ? 'Movie' : work.kind === 'artist' ? 'Artist' : 'Title');
    const runtime = detail.runtime_ms !== null ? runtimeLabel(Math.round(detail.runtime_ms / 60000)) : '';
    if (runtime.length > 0) {
      chips.push(runtime);
    }
    if (year.length > 0) {
      chips.push(year);
    }
    const released = formatDayMonthYear(work.release_date);
    if (released.length > 0) {
      chips.push('Released ' + released);
    }
  }
  for (const genre of work.genres) {
    chips.push(genre);
  }
  return chips;
}

/** The episode name shown under a series title ("Pilot"), '' without one. */
export function planEpisodeTitle(detail: WorkDetail, plan: ResumePlan | null): string {
  const item = planEpisode(detail, plan);
  return item !== undefined && item.episode.title !== undefined && item.episode.title !== null ? item.episode.title : '';
}

/** The synopsis under it: the target episode's overview for a series that has one, else the work's. */
export function planSynopsis(detail: WorkDetail, plan: ResumePlan | null): string {
  const item = planEpisode(detail, plan);
  if (item !== undefined && item.episode.overview !== undefined && item.episode.overview !== null && item.episode.overview.length > 0) {
    return item.episode.overview;
  }
  return detail.work.overview !== null ? detail.work.overview : '';
}
