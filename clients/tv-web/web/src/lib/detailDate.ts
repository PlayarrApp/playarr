import { ENGLISH_MONTHS, ENGLISH_WEEKDAYS_LONG } from "./shellClockDate";

/**
 * Formats a detail-page date in the UI language's locale. en-GB is built from parts: engines disagree on the
 * default locale (VIDAA's browser answers en-US, "Sep 17, 2026") and on the short September ("Sep" or "Sept").
 * The Web pattern is day, short month with "Sept", year.
 */
export function formatDetailDate(date: Date, locale: string): string {
  if (locale === "en-GB") {
    const month = date.getUTCMonth();
    const name = month === 8 ? "Sept" : (ENGLISH_MONTHS[month] ?? "").slice(0, 3);
    return `${date.getUTCDate()} ${name} ${date.getUTCFullYear()}`;
  }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/**
 * The full release date and time of a calendar entry ("Wednesday, 7 October 2026 at 01:00"). en-GB is built from parts:
 * VIDAA's ICU drops the weekday and the month name from the combined dateStyle format.
 */
export function formatFullDateTime(date: Date, locale: string): string {
  if (locale === "en-GB") {
    const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    const weekday = ENGLISH_WEEKDAYS_LONG[date.getDay()] ?? "";
    const month = ENGLISH_MONTHS[date.getMonth()] ?? "";
    return `${weekday}, ${date.getDate()} ${month} ${date.getFullYear()} at ${time}`;
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(date);
}
