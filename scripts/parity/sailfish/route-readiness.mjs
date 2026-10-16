import { requireSingleAppProcess, scanAppProcessesScript } from "./process.mjs";

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
  return `cat /tmp/pa.log 2>/dev/null; journalctl -b --no-pager _PID=${pid} 2>/dev/null`;
}

export function readOwnedRouteLog(ssh, identity) {
  const output = ssh("root", scanAppProcessesScript(identity.marker));
  const current = requireSingleAppProcess(output, identity.marker);
  if (current.pid !== identity.pid || current.starttime !== identity.starttime) {
    throw new Error("Sailfish process identity changed before route log check");
  }
  return ssh("root", routeLogCommand(identity.pid));
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
