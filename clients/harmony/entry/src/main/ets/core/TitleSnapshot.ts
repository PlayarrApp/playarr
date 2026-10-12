/** The title identity posted to the watchlist and discovery endpoints for a library work (web `snapshotFromWork`). */

import type { Work } from './Types/Work';
import type { TitleSnapshot } from './Types/Calendar';

export function snapshotFromWork(work: Work): TitleSnapshot {
  let posterUrl: string | null = null;
  for (const image of work.images) {
    if (image.kind === 'poster' && posterUrl === null) {
      posterUrl = image.url;
    }
  }
  const year: number | null = work.release_date !== null && work.release_date.length >= 4 ? parseInt(work.release_date.substring(0, 4), 10) : null;
  const snapshot: TitleSnapshot = {
    kind: work.kind,
    title: work.title,
    year: year,
    work_id: work.id,
    external_refs: work.external_refs as Object,
    poster_url: posterUrl,
  };
  return snapshot;
}
