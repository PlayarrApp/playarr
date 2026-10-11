// core/PeriodPicker.ts: the calendar's month and year jump, as web components/shell/PeriodPicker.tsx.

export const MONTH_NAMES: string[] = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function pad(value: number): string {
  return value < 10 ? "0" + String(value) : String(value);
}

/** The anchor day a jump to `month` (1 to 12) of `year` sets: the first of that month. */
export function periodJumpDay(year: number, month: number): string {
  let digits = String(year);
  while (digits.length < 4) {
    digits = "0" + digits;
  }
  return digits + "-" + pad(month) + "-01";
}

/** Years offered either side of the current one, oldest first (web `yearSpan`, default 15). */
export function yearChoices(currentYear: number, span: number = 15): number[] {
  const years: number[] = [];
  for (let offset = -span; offset <= span; offset++) {
    years.push(currentYear + offset);
  }
  return years;
}

export function yearOfDay(day: string): number {
  return Number(day.slice(0, 4));
}

export function monthOfDay(day: string): number {
  return Number(day.slice(5, 7));
}
