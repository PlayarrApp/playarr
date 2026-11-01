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
 * Native memory one rendered frame leaves behind until the page is reloaded. JS heap stays near 9 MB, so garbage collection never reacts.
 * Measured on 1 Nov 2026 with the active dwell (a key every 4th frame, 240 frames) in Chromium 111.0.5563.19 and 153: renderer RSS grew
 * 3.8 GB over 183 renders on 111 (20.8 MB each) and 23 MB per render on 153. Blob-loaded SVG frames taint the canvas on both, so
 * every render takes the data: URL path. Rounded up to 25.
 */
export const NATIVE_MB_PER_RENDER = 25;
/** Native memory (MB) a page load may add before it stops mirroring; the peak the active dwell was measured to reach and survive. */
export const SAFE_NATIVE_CEILING_MB = 1000;

/** Renders one page load may do: the ceiling divided by the per-render cost. ?mirrorMaxFrames= overrides. */
export function renderBudget(ceilingMb: number = SAFE_NATIVE_CEILING_MB, perRenderMb: number = NATIVE_MB_PER_RENDER): number {
  return Math.max(1, Math.floor(ceilingMb / perRenderMb));
}

export const DEFAULT_MAX_FRAMES = renderBudget();

export function frameBudgetSpent(captured: number, max: number): boolean {
  return captured >= max;
}
