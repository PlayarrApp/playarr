import { readFileSync } from "node:fs";

const suite = JSON.parse(readFileSync(new URL("./screens.json", import.meta.url), "utf8"));

export const captureTimezone = suite.determinism.timezone;

export function captureWallTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("deterministic capture clock is invalid");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: captureTimezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}:${fields.second}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
}
