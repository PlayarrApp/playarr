// core/RailPrefs.ts: web `lib/homeRailPrefs.ts`, the Customise Home list edits.
import type { RailPreferenceEntry, RailPreferencesRequest } from "./Types/Catalog.ts";

/** Moves a rail one place up (-1) or down (+1); unchanged at the ends. */
export function moveRail(entries: RailPreferenceEntry[], id: string, direction: number): RailPreferenceEntry[] {
  const index = entries.findIndex((entry) => entry.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= entries.length) {
    return entries;
  }
  const next = entries.slice();
  const moved = next[index];
  next[index] = next[target];
  next[target] = moved;
  return next;
}

export function toggleRail(entries: RailPreferenceEntry[], id: string): RailPreferenceEntry[] {
  return entries.map((entry) => (entry.id === id ? { id: entry.id, title: entry.title, hidden: !entry.hidden } : entry));
}

/** The full order plus the hidden set, as the preferences endpoint expects. */
export function toPreferencesRequest(entries: RailPreferenceEntry[]): RailPreferencesRequest {
  return {
    order: entries.map((entry) => entry.id),
    hidden: entries.filter((entry) => entry.hidden).map((entry) => entry.id),
  };
}
