import { ENGLISH_MONTHS } from "./shellClockDate";

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
