/** `GET /api/v1/catalog/{series_id}/resume-plan` (backend `ResumePlan` / `ResumeOption`): where a series should be played from. */

export type ResumeAction = 'start' | 'resume' | 'restart';

export interface ResumeOption {
  kind: string;
  episode_id: string;
  media_file_id: string;
  season_number: number;
  episode_number: number;
  episode_number_end?: number | null;
  label: string;
  position_ms: number;
  duration_ms: number;
  progress_percent: number;
}

export interface ResumePlan {
  series_work_id: string;
  action: ResumeAction;
  reason: string;
  needs_choice: boolean;
  options: ResumeOption[];
  target?: ResumeOption | null;
}
