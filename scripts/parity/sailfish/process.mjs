import { randomBytes } from "node:crypto";

export const APP_EXE = "/usr/libexec/mapplauncherd/booster-silica-qt5";
export const APP_ARGV = "/usr/bin/harbour-playarr";

const validateMarker = (marker) => {
  if (!/^--pc=[a-f0-9]{8}$/.test(marker)) throw new Error("invalid Sailfish process marker");
};

// Sailfish's invoker/booster can shorten argv, so keep the unique process tag
// to eight hex digits after its short option name.
export function newProcessMarker(bytes = randomBytes(4)) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 4) throw new Error("Sailfish process marker requires four random bytes");
  return `--pc=${bytes.toString("hex")}`;
}

export function scanAppProcessesScript(marker) {
  validateMarker(marker);
  return `set -eu
marker='${marker}'
expected='${APP_EXE}'
app='${APP_ARGV}'
for d in /proc/[0-9]*; do
  [ -r "$d/cmdline" ] || continue
  exe=$(readlink "$d/exe" 2>/dev/null) || continue
  [ "$exe" = "$expected" ] || continue
  if ! tr '\\000' '\\n' < "$d/cmdline" 2>/dev/null | grep -Fxq -- "$app"; then continue; fi
  rest=$(sed 's/^[^)]*) //' "$d/stat" 2>/dev/null) || continue
  set -- $rest
  [ "$#" -ge 20 ] || continue
  i=1
  while [ "$i" -lt 20 ]; do shift; i=$((i + 1)); done
  start=$1
  present=0
  if tr '\\000' '\\n' < "$d/cmdline" 2>/dev/null | grep -Fxq -- "$marker"; then present=1; fi
  printf '%s %s %s\\n' "\${d#/proc/}" "$start" "$present"
done`;
}

export function parseAppProcesses(output, marker) {
  validateMarker(marker);
  const rows = output.trim() ? output.trim().split("\n") : [];
  return rows.map((line) => {
    const match = /^(\d+) (\d+) ([01])$/.exec(line);
    if (!match) throw new Error("invalid Sailfish process scan output");
    return { pid: Number(match[1]), starttime: match[2], markerPresent: match[3] === "1", marker };
  });
}

export function requireSingleAppProcess(output, marker) {
  const processes = parseAppProcesses(output, marker);
  if (processes.length !== 1 || !processes[0].markerPresent) {
    throw new Error(`Sailfish process preflight expected one marked app, found ${processes.length}`);
  }
  return processes[0];
}

export function appIdentityReceipt(identity, capturedAt = new Date()) {
  if (!identity || !Number.isSafeInteger(identity.pid) || identity.pid < 1 || !/^\d+$/.test(String(identity.starttime))) {
    throw new Error("invalid Sailfish process identity");
  }
  const marker = identity.markerPresent === true ? identity.marker : "none";
  if (marker !== "none") validateMarker(marker);
  const timestamp = capturedAt instanceof Date ? capturedAt.toISOString() : new Date(capturedAt).toISOString();
  return {
    pid: identity.pid,
    start_ticks: String(identity.starttime),
    marker,
    capturedAt: timestamp,
  };
}

export function cleanupAppProcessScript(identity) {
  const { pid, starttime, marker } = identity;
  validateMarker(marker);
  if (!Number.isSafeInteger(pid) || pid < 1 || !/^\d+$/.test(String(starttime))) {
    throw new Error("invalid Sailfish process identity");
  }
  return `set -eu
pid='${pid}'
expected_start='${starttime}'
expected_exe='${APP_EXE}'
app='${APP_ARGV}'
marker='${marker}'
d="/proc/$pid"
still_owned() {
  [ -r "$d/stat" ] && [ -r "$d/cmdline" ] || return 1
  exe=$(readlink "$d/exe" 2>/dev/null) || return 1
  [ "$exe" = "$expected_exe" ] || return 1
  rest=$(sed 's/^[^)]*) //' "$d/stat" 2>/dev/null) || return 1
  set -- $rest
  [ "$#" -ge 20 ] || return 1
  i=1
  while [ "$i" -lt 20 ]; do shift; i=$((i + 1)); done
  [ "$1" = "$expected_start" ] || return 1
  tr '\\000' '\\n' < "$d/cmdline" 2>/dev/null | grep -Fxq -- "$app" || return 1
  tr '\\000' '\\n' < "$d/cmdline" 2>/dev/null | grep -Fxq -- "$marker" || return 1
}
still_owned || exit 0
kill -TERM "$pid" 2>/dev/null || exit 0
n=0
while [ "$n" -lt 20 ]; do
  still_owned || exit 0
  sleep 0.1
  n=$((n + 1))
done
still_owned || exit 0
kill -KILL "$pid" 2>/dev/null || true
n=0
while [ "$n" -lt 20 ]; do
  still_owned || exit 0
  sleep 0.1
  n=$((n + 1))
done
still_owned || exit 0
echo "owned Playarr process persisted after KILL" >&2
exit 1`;
}
