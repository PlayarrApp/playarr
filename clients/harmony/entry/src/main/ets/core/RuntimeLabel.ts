// core/RuntimeLabel.ts: web `lib/detailMeta.ts` runtimeLabel: "1h 52m", "45m", "2h"; empty when the runtime is unknown.

export function formatRuntimeLabel(ms: number | null): string {
  if (ms === null || ms <= 0) {
    return "";
  }
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return minutes + "m";
  }
  if (minutes <= 0) {
    return hours + "h";
  }
  return hours + "h " + minutes + "m";
}
