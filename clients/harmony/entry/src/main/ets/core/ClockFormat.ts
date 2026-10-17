/**
 * Web TV shell clock text: "04:06" and "Sun 11 October" (shown uppercase). English names only.
 * `utc` reads the UTC fields instead of the device's: a parity capture pins an instant and shows it in UTC (en-GB).
 */

const WEEKDAYS: string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: string[] = ["January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December"];

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

export function clockTime(now: Date, utc: boolean = false): string {
  return utc ? `${pad2(now.getUTCHours())}:${pad2(now.getUTCMinutes())}` : `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function clockDate(now: Date, utc: boolean = false): string {
  return utc ? `${WEEKDAYS[now.getUTCDay()]} ${now.getUTCDate()} ${MONTHS[now.getUTCMonth()]}`
    : `${WEEKDAYS[now.getDay()]} ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}
