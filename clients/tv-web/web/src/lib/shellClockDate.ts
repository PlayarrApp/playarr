const ENGLISH_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const ENGLISH_MONTHS = [
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

/** Formats the shell date, with a fallback for VIDAA's incomplete en-GB ICU data. */
export function formatShellClockDate(date: Date, locale: string, isVidaa: boolean): string {
  if (!isVidaa || locale !== "en-GB") {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "long",
    }).format(date);
  }

  // Some VIDAA firmware returns only the day part for this combined Intl format.
  // The matching Web en-GB pattern is the short weekday, day, then long month.
  const day = new Intl.DateTimeFormat(locale, { day: "numeric" }).format(date);
  return `${ENGLISH_WEEKDAYS[date.getDay()]} ${day} ${ENGLISH_MONTHS[date.getMonth()]}`;
}
