export const ENGLISH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const ENGLISH_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Formats the shell date. en-GB is built from parts: VIDAA's ICU returns only the day for the combined format, and webOS's puts a comma after the weekday. */
export function formatShellClockDate(date: Date, locale: string): string {
  if (locale !== "en-GB") {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "long",
    }).format(date);
  }

  // Engines disagree on the combined en-GB format (day only on some VIDAA firmware, "Thu, 15 October" on webOS).
  // The matching Web en-GB pattern is the short weekday, day, then long month.
  const day = new Intl.DateTimeFormat(locale, { day: "numeric" }).format(date);
  return `${ENGLISH_WEEKDAYS[date.getDay()]} ${day} ${ENGLISH_MONTHS[date.getMonth()]}`;
}

export const ENGLISH_WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** True when an `Intl` result for an English locale carries no weekday or month name: VIDAA's ICU returns only the day number. */
export function lacksNames(formatted: string): boolean {
  return !/\p{L}/u.test(formatted);
}
