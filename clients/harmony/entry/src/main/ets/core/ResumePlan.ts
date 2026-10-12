/** The series detail's primary button and kicker from the server's resume plan (web `resumeButtonLabelKey`, `pages.workDetail`). Shared by every layout. */

import type { ResumePlan } from './Types/ResumePlan';

/** The primary button's label: "Start" for a series not begun, "Watch again" once finished, "Resume" otherwise. */
export function resumeButtonLabel(plan: ResumePlan): string {
  if (plan.action === 'start') {
    return 'Start';
  }
  return plan.action === 'restart' ? 'Watch again' : 'Resume';
}

function two(n: number): string {
  return n < 10 ? '0' + n.toString() : n.toString();
}

/** The pink kicker over the title: "S01 · E01" (a multi-episode file reads "S01 · E01-E02"); empty without a target. */
export function resumeKicker(plan: ResumePlan): string {
  const target = plan.target;
  if (target === undefined || target === null) {
    return '';
  }
  let episode = 'E' + two(target.episode_number);
  if (target.episode_number_end !== undefined && target.episode_number_end !== null) {
    episode = episode + '-E' + two(target.episode_number_end);
  }
  return 'S' + two(target.season_number) + ' · ' + episode;
}

/** The media file the primary button plays, or null without a target. */
export function resumeTargetFile(plan: ResumePlan): string | null {
  const target = plan.target;
  return target === undefined || target === null ? null : target.media_file_id;
}
