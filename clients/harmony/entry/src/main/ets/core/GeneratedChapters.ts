// Web's generatedMovieChapters (WorkDetail.tsx): a film whose server reports no chapters still gets scene markers, one per 5 to 30 minutes
// (about ten per film), so the Chapters rail is never empty. A 60 second clip gives one marker at 0:00.
import { MediaChapter } from "./Types/Media";

const INTERVAL_OPTIONS_MS: number[] = [5, 10, 15, 20, 30].map((minutes: number): number => minutes * 60000);

export function generatedMovieChapters(runtimeMs: number): MediaChapter[] {
  if (!(runtimeMs > 0)) {
    return [];
  }
  const target = runtimeMs / 10;
  const found = INTERVAL_OPTIONS_MS.find((candidate: number): boolean => candidate >= target);
  const interval = found !== undefined ? found : INTERVAL_OPTIONS_MS[INTERVAL_OPTIONS_MS.length - 1];
  const count = Math.max(1, Math.ceil(runtimeMs / interval));
  const chapters: MediaChapter[] = [];
  for (let index = 0; index < count; index++) {
    const start = index * interval;
    chapters.push({ index: index, start_ms: start, end_ms: Math.min(runtimeMs, start + interval) });
  }
  return chapters;
}
