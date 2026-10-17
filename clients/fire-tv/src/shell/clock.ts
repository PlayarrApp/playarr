/**
 * The app clock behind the shell's top-left clock and the calendar's "today". A parity capture build freezes it with
 * `PLAYARR_PARITY_CLOCK` (inlined at bundle time, see babel.config.js); otherwise it is the device time. A frozen clock
 * is formatted in UTC, the fixture's time zone, so a capture does not depend on the device's zone.
 */
const PARITY_CLOCK: string | undefined = process.env.PLAYARR_PARITY_CLOCK;

// A parity control channel build can also freeze the clock at run time (`cmd=clock&now=<iso>`), so one bundle serves pinned
// and live captures. It wins over the build-time value and is lost when the app restarts.
let runtimeClock: string | null = null;
const clockListeners = new Set<() => void>();

export function setParityClock(iso: string | null): void {
  if (iso !== null && Number.isNaN(Date.parse(iso))) throw new Error(`invalid parity clock ${iso}`);
  runtimeClock = iso;
  clockListeners.forEach((listener) => listener());
}

/** Called when the parity clock is set, so a clock already on screen redraws at once. Returns the unsubscribe function. */
export function onParityClockChange(listener: () => void): () => void {
  clockListeners.add(listener);
  return () => clockListeners.delete(listener);
}

export function isClockFrozen(): boolean {
  return Boolean(runtimeClock ?? PARITY_CLOCK);
}

export function appNow(): Date {
  const frozen = runtimeClock ?? PARITY_CLOCK;
  return frozen ? new Date(frozen) : new Date();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function parts(date: Date, utc: boolean): {hours: number; minutes: number; weekday: number; day: number; month: number} {
  return utc
    ? {
        hours: date.getUTCHours(),
        minutes: date.getUTCMinutes(),
        weekday: date.getUTCDay(),
        day: date.getUTCDate(),
        month: date.getUTCMonth(),
      }
    : {
        hours: date.getHours(),
        minutes: date.getMinutes(),
        weekday: date.getDay(),
        day: date.getDate(),
        month: date.getMonth(),
      };
}

/** `12:00`, 24-hour, like the web's en-GB clock. */
export function formatClockTime(date: Date, utc: boolean = isClockFrozen()): string {
  const p = parts(date, utc);
  return `${String(p.hours).padStart(2, '0')}:${String(p.minutes).padStart(2, '0')}`;
}

/** `Wed 7 October`, the web's en-GB clock date (drawn upper-case). */
export function formatClockDate(date: Date, utc: boolean = isClockFrozen()): string {
  const p = parts(date, utc);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
}
