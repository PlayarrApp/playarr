// core/RuntimeLabel.ts: web `lib/detailMeta.ts` runtimeLabel: "1h 52m", "45m", "2h"; empty when the runtime is unknown.

// webMinutes: under an hour web writes "45 min" (TV pages); the touch pages keep "45m".
export function formatRuntimeLabel(ms: number | null, webMinutes: boolean = false): string {
  if (ms === null || ms <= 0) {
    return "";
  }
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return webMinutes ? Math.max(1, minutes) + " min" : minutes + "m";
  }
  if (minutes <= 0) {
    return hours + "h";
  }
  return hours + "h " + minutes + "m";
}
