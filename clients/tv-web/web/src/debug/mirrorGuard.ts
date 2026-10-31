// DEBUG BUILD ONLY. Self-protection for the TV page that runs the debug mirror: the page reports its JS heap, backs off when nobody is
// driving it, and stops capturing before the TV browser runs out of memory (a hung TV needs a power cycle).

/** Default heap ceiling (MB) above which the mirror stops capturing; ?mirrorMaxHeapMb= overrides it. */
export const DEFAULT_MAX_HEAP_MB = 300;
/** Frames come every 2 s while someone drives the page; after this long without a key, focus change or load they slow down. */
export const IDLE_AFTER_MS = 5 * 60_000;
export const IDLE_INTERVAL_MS = 10_000;
export const ACTIVE_INTERVAL_MS = 2000;

export interface HeapReading {
  usedMb: number;
  limitMb: number;
}

type PerfWithMemory = { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };

/** performance.memory is a Chromium extension (VIDAA's Odin browser has it); null where the engine lacks it. */
export function readHeap(perf: PerfWithMemory = performance as unknown as PerfWithMemory): HeapReading | null {
  const m = perf.memory;
  if (!m || !Number.isFinite(m.usedJSHeapSize)) return null;
  return { usedMb: Math.round(m.usedJSHeapSize / 1048576), limitMb: Math.round(m.jsHeapSizeLimit / 1048576) };
}

/** True when the heap is over the ceiling or within 15 % of the engine's own limit. */
export function heapGuardTripped(heap: HeapReading | null, maxMb: number): boolean {
  if (!heap) return false;
  return heap.usedMb > maxMb || (heap.limitMb > 0 && heap.usedMb > heap.limitMb * 0.85);
}

export function nextIntervalMs(now: number, lastActivityAt: number): number {
  return now - lastActivityAt > IDLE_AFTER_MS ? IDLE_INTERVAL_MS : ACTIVE_INTERVAL_MS;
}

/**
 * Frames one page load may capture. Measured in headless Chromium: the renderer keeps about 15 MB of native memory per captured frame
 * until the page is reloaded (JS heap stays near 9 MB, so garbage collection never reacts); a TV with a fraction of that memory hangs.
 * A reload clears it. ?mirrorMaxFrames= overrides.
 */
export const DEFAULT_MAX_FRAMES = 120;

export function frameBudgetSpent(captured: number, max: number): boolean {
  return captured >= max;
}
