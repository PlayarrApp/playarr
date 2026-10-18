import { APP_ARGV, APP_EXE, requireSingleAppProcess, scanAppProcessesScript } from "./process.mjs";

export const DIAGNOSTIC_SINK_LIMIT = 64 * 1024;

export function ownedDiagnosticCommand(identity, limit = DIAGNOSTIC_SINK_LIMIT) {
  const { pid, starttime, marker } = identity ?? {};
  if (!Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(String(starttime)) || !/^--pc=[a-f0-9]{8}$/.test(marker ?? "")) {
    throw new Error("invalid Sailfish diagnostic process identity");
  }
  if (!Number.isSafeInteger(limit) || limit < 1024 || limit > DIAGNOSTIC_SINK_LIMIT) throw new Error("invalid Sailfish diagnostic limit");
  return [
    "set -eu",
    `pid='${pid}'`,
    `expected_start='${starttime}'`,
    `expected_exe='${APP_EXE}'`,
    `app='${APP_ARGV}'`,
    `marker='${marker}'`,
    'd="/proc/$pid"',
    '[ -r "$d/stat" ] && [ -r "$d/cmdline" ] || exit 41',
    'exe=$(readlink "$d/exe" 2>/dev/null) || exit 41',
    '[ "$exe" = "$expected_exe" ] || exit 41',
    'rest=$(sed \'s/^[^)]*) //\' "$d/stat" 2>/dev/null) || exit 41',
    'set -- $rest',
    '[ "$#" -ge 20 ] || exit 41',
    'i=1',
    'while [ "$i" -lt 20 ]; do shift; i=$((i + 1)); done',
    '[ "$1" = "$expected_start" ] || exit 41',
    'tr \'\\000\' \'\\n\' < "$d/cmdline" | grep -Fxq -- "$app" || exit 41',
    'tr \'\\000\' \'\\n\' < "$d/cmdline" | grep -Fxq -- "$marker" || exit 41',
    'printf \'__PLAYARR_DIAGNOSTIC_META__ pid=%s start=%s\\n\' "$pid" "$expected_start"',
    'printf \'__PLAYARR_DIAGNOSTIC_PA_LOG__\\n\'',
    `tail -c ${limit} /run/user/100000/pa.log 2>/dev/null || true`,
    'printf \'\\n__PLAYARR_DIAGNOSTIC_PID_JOURNAL__\\n\'',
    `journalctl -b --no-pager -o cat _PID="$pid" 2>/dev/null | tail -c ${limit} || true`,
  ].join("\n");
}

export function sanitiseDiagnosticText(text, secrets = []) {
  let output = String(text ?? "");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) output = output.split(secret).join("[redacted]");
  }
  return output
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\b(?:Bearer|Basic)\s+[^\s"'<>]+/gi, "[redacted-auth]")
    .replace(/\b[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\b/gi, "[redacted-id]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted-address]")
    .replace(/\b(?:token|access_token|refresh_token|password|passwd|secret)(\s*[=:]\s*)[^\s,;"']+/gi, "$1[redacted]");
}

export function formatOwnedDiagnostics(output, identity, secrets = [], limit = DIAGNOSTIC_SINK_LIMIT) {
  if (!Number.isSafeInteger(limit) || limit < 1024 || limit > DIAGNOSTIC_SINK_LIMIT) throw new Error("invalid Sailfish diagnostic limit");
  const raw = String(output);
  const metadata = new RegExp(`__PLAYARR_DIAGNOSTIC_META__ pid=${identity?.pid} start=${identity?.starttime}`);
  const paMarker = "__PLAYARR_DIAGNOSTIC_PA_LOG__";
  const journalMarker = "__PLAYARR_DIAGNOSTIC_PID_JOURNAL__";
  const metaAt = raw.indexOf("__PLAYARR_DIAGNOSTIC_META__");
  const paAt = raw.indexOf(paMarker);
  const journalAt = raw.indexOf(journalMarker);
  if (metaAt < 0 || paAt < metaAt || journalAt < paAt || !metadata.test(raw.slice(metaAt, paAt))) {
    throw new Error("Sailfish diagnostic response is missing verified source boundaries");
  }
  const pa = raw.slice(paAt + paMarker.length, journalAt).trim();
  const journal = raw.slice(journalAt + journalMarker.length).trim();
  const clean = (value) => sanitiseDiagnosticText(value, secrets).slice(-limit);
  return `Sailfish owned-process diagnostics\npid=${identity.pid} start=${identity.starttime}\n\n[pa.log]\n${clean(pa)}\n\n[owned-pid journal]\n${clean(journal)}\n`;
}

export function preserveBeforeCleanup(preserve, cleanup) {
  let preserveError = null;
  let cleanupError = null;
  try { preserve(); } catch (error) { preserveError = error; }
  try { cleanup(); } catch (error) { cleanupError = error; }
  if (preserveError && cleanupError) throw new AggregateError([preserveError, cleanupError], "diagnostic preservation and cleanup both failed");
  if (cleanupError) throw cleanupError;
  if (preserveError) throw new Error(`cleanup completed, but diagnostics could not be preserved: ${preserveError.message}`);
}

const validMarker = (marker) => {
  if (!/^--pc=[a-f0-9]{8}$/.test(marker)) throw new Error("invalid Sailfish route marker");
};

export function routeReadinessProbe(marker, kind, expectedId = null) {
  validMarker(marker);
  if (kind !== "movie" && kind !== "series") throw new Error("invalid Sailfish detail kind");
  if (expectedId !== null && !/^[a-zA-Z0-9_-]+$/.test(expectedId)) throw new Error("invalid Sailfish detail id");
  const expected = expectedId === null ? "" : `&&p.work.id==='${expectedId}'`;
  return `js:(function(){var p=pageStack.currentPage;if(!p)return;if(p.failed){console.log('PLAYARR_CAPTURE_ROUTE_ERROR=${marker}');return;}if(p.work&&p.work.kind==='${kind}'${expected}&&p.detail&&p.detail.work&&p.detail.work.id===p.work.id)console.log('PLAYARR_CAPTURE_ROUTE_READY=${marker}');})()`;
}

export function serializeSteps(theme, steps) {
  const parts = [`js:Api.themeMode='${theme}'`, ...steps];
  if (parts.some((part) => part.includes("|"))) throw new Error("Sailfish PLAYARR_STEPS contains the reserved pipe delimiter");
  const script = parts.join("|");
  const bytes = Buffer.byteLength(script, "utf8");
  if (bytes >= 3500) throw new Error(`Sailfish PLAYARR_STEPS is ${bytes} bytes; maximum is 3499 to stay below the booster environment limit`);
  if (JSON.stringify(script.split("|")) !== JSON.stringify(parts)) throw new Error("Sailfish PLAYARR_STEPS serialization is not reversible");
  return script;
}

export function routeLogCommand(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("invalid Sailfish process id for route journal");
  return `printf '\\n__PLAYARR_PA_LOG__\\n'; cat /run/user/100000/pa.log 2>/dev/null; printf '\\n__PLAYARR_PID_JOURNAL__\\n'; journalctl -b --no-pager -o cat _PID=${pid} 2>/dev/null`;
}

export function selectCanonicalRouteLog(output) {
  const paMarker = "__PLAYARR_PA_LOG__";
  const journalMarker = "__PLAYARR_PID_JOURNAL__";
  const paAt = output.indexOf(paMarker);
  const journalAt = output.indexOf(journalMarker);
  if (paAt < 0 || journalAt < 0 || journalAt <= paAt) {
    throw new Error("Sailfish route log response is missing its source boundaries");
  }
  const paLog = output.slice(paAt + paMarker.length, journalAt).trim();
  const journal = output.slice(journalAt + journalMarker.length).trim();
  const hasRouteTelemetry = (log) => /PARITY\||PLAYARR_CAPTURE_ROUTE_(?:READY|ERROR)=/.test(log);
  // Keep one chronological sink. Concatenating the two duplicates Qt output and
  // can make an older event appear newer to consumers that read the final line.
  return hasRouteTelemetry(paLog) ? paLog : journal;
}

export function readOwnedRouteLog(ssh, identity) {
  const output = ssh("root", scanAppProcessesScript(identity.marker));
  const current = requireSingleAppProcess(output, identity.marker);
  if (current.pid !== identity.pid || current.starttime !== identity.starttime) {
    throw new Error("Sailfish process identity changed before route log check");
  }
  return selectCanonicalRouteLog(ssh("root", routeLogCommand(identity.pid)));
}

export function requireRouteReady(log, marker) {
  validMarker(marker);
  if (log.split("\n").some((line) => line.includes(`PLAYARR_CAPTURE_ROUTE_ERROR=${marker}`))) {
    throw new Error("Sailfish detail route reported a load failure");
  }
  if (!log.split("\n").some((line) => line.includes(`PLAYARR_CAPTURE_ROUTE_READY=${marker}`))) {
    throw new Error("Sailfish detail route did not become ready before capture");
  }
}
