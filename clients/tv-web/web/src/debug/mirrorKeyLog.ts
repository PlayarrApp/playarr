// DEBUG BUILD ONLY. Records what the page sees when a physical remote key is pressed (?mirrorKeyLog=1), so the owner's Back press on a
// VIDAA remote can be compared with the broker's KEY_BACK, which raises no page event at all. Events go to the parity receiver.

export type KeyLogEntry = {
  type: string;
  at: number;
  key?: string;
  code?: string;
  keyCode?: number;
  detail?: string;
};

/** Plain-data record of one DOM event; kept pure so it can be tested without a browser. */
export function describeEvent(e: { type: string; key?: string; code?: string; keyCode?: number }, now: number, detail?: string): KeyLogEntry {
  const entry: KeyLogEntry = { type: e.type, at: now };
  if (e.type === "keydown" || e.type === "keyup") {
    entry.key = e.key;
    entry.code = e.code;
    entry.keyCode = e.keyCode;
  }
  if (detail) entry.detail = detail;
  return entry;
}

export function startKeyLog(url: string, win: Window = window): void {
  let queue: KeyLogEntry[] = [];
  const push = (e: Event, detail?: string): void => {
    queue.push(describeEvent(e as KeyboardEvent, Date.now(), detail));
  };
  const flush = (): void => {
    if (queue.length === 0) return;
    const body = JSON.stringify({ events: queue.slice(0, 200) });
    queue = queue.slice(200);
    try {
      void fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch {
      // the receiver is unreachable: drop the batch
    }
  };
  for (const type of ["keydown", "keyup"]) win.addEventListener(type, (e) => { push(e); flush(); }, true);
  for (const type of ["popstate", "hashchange", "visibilitychange", "pagehide"]) {
    win.addEventListener(type, (e) => { push(e, `${win.location.pathname}${win.location.hash} vis=${win.document.visibilityState} len=${win.history.length}`); flush(); }, true);
  }
  win.setInterval(flush, 1000);
  queue.push({ type: "armed", at: Date.now(), detail: `${win.location.pathname}${win.location.hash} len=${win.history.length}` });
  flush();
}
