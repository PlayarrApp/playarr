/** `GET /api/v1/calendar`: the release calendar for an inclusive range of UTC days. */

import { getPlayarrClient } from '../AppContainer';
import { ApiResult } from '../net/ApiResult';
import { calendarUrl, calendarFeedUrl } from '../core/Endpoints.ts';
import { CalendarResponse, CalendarFeedStatus, CalendarFeedCreated } from '../core/Types/Calendar.ts';

export function getCalendar(start: string, end: string): Promise<ApiResult<CalendarResponse>> {
  return getPlayarrClient().getJson<CalendarResponse>(calendarUrl(start, end));
}

/** `GET /api/v1/calendar/feed`: does the viewer have an iCal link, and can the server show it again. */
export function getCalendarFeed(): Promise<ApiResult<CalendarFeedStatus>> {
  return getPlayarrClient().getJson<CalendarFeedStatus>(calendarFeedUrl());
}

/** `POST /api/v1/calendar/feed`: returns the existing link or creates one; `rotate` replaces it (the old URL stops working). */
export function createCalendarFeed(rotate: boolean): Promise<ApiResult<CalendarFeedCreated>> {
  const body: Object = new Object();
  return getPlayarrClient().postJson<Object, CalendarFeedCreated>(calendarFeedUrl(rotate), body);
}
