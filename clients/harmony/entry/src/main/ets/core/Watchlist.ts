// core/Watchlist.ts: row helpers for the watchlist page, as web lib/discovery.ts (the server computes identity,
// sources and actions; the client only maps them to a target and labels).
import type { WatchlistAction, WatchlistTitle, WatchlistTitleSource } from "./Types/Watchlist.ts";

/** Highest priority first: resuming beats starting over, requesting beats recording. */
const ACTION_PRIORITY: string[] = ["resume", "play", "request", "launch", "record"];

const SOURCE_LABELS: Record<string, string> = {
  library: "Library",
  peer: "Peer server",
  request: "Requestable",
  live_tv: "Live TV",
  game: "Game",
};

const ACTION_LABELS: Record<string, string> = {
  play: "Play",
  resume: "Resume",
  request: "Request",
  record: "Record",
  launch: "Launch",
};

/** The library work this title opens, or null when the library has no copy (web `libraryDetailRoute`). */
export function libraryWorkId(title: WatchlistTitle): string | null {
  for (const source of title.sources) {
    if (source.source === "library" && source.work_id) {
      return source.work_id;
    }
  }
  return null;
}

/** One chip per distinct source kind, in first-seen order. */
export function sourceChips(sources: WatchlistTitleSource[]): string[] {
  const chips: string[] = [];
  for (const source of sources) {
    const label = SOURCE_LABELS[source.source] ?? source.source;
    if (chips.indexOf(label) === -1) {
      chips.push(label);
    }
  }
  return chips;
}

/** The label of the highest-priority enabled action, or null when none is enabled. */
export function primaryActionLabel(actions: WatchlistAction[]): string | null {
  for (const kind of ACTION_PRIORITY) {
    for (const action of actions) {
      if (action.action === kind && action.enabled) {
        return ACTION_LABELS[kind] ?? kind;
      }
    }
  }
  return null;
}

/** Disabled actions worth explaining, in priority order; Record is never explained. */
export function explainedReasons(actions: WatchlistAction[]): string[] {
  const lines: string[] = [];
  for (const kind of ACTION_PRIORITY) {
    if (kind === "record") {
      continue;
    }
    for (const action of actions) {
      if (action.action === kind && !action.enabled && action.reason) {
        lines.push((ACTION_LABELS[kind] ?? kind) + ": " + action.reason);
      }
    }
  }
  return lines;
}
