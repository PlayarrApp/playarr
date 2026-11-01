import { describe, expect, it } from "vitest";
import { ACTIVE_INTERVAL_MS, DEFAULT_MAX_FRAMES, NATIVE_MB_PER_RENDER, SAFE_NATIVE_CEILING_MB, renderBudget, IDLE_AFTER_MS, IDLE_INTERVAL_MS, frameBudgetSpent, heapGuardTripped, nextIntervalMs, readHeap } from "./mirrorGuard";

describe("debug mirror self-protection", () => {
  it("reads the heap in MB and tolerates engines without performance.memory", () => {
    expect(readHeap({ memory: { usedJSHeapSize: 50 * 1048576, jsHeapSizeLimit: 512 * 1048576 } })).toEqual({ usedMb: 50, limitMb: 512 });
    expect(readHeap({})).toBeNull();
  });
  it("trips above the ceiling or near the engine limit, never without a reading", () => {
    expect(heapGuardTripped({ usedMb: 100, limitMb: 512 }, 300)).toBe(false);
    expect(heapGuardTripped({ usedMb: 301, limitMb: 4096 }, 300)).toBe(true);
    expect(heapGuardTripped({ usedMb: 200, limitMb: 220 }, 300)).toBe(true);
    expect(heapGuardTripped(null, 300)).toBe(false);
  });
  it("slows down only after a quiet spell", () => {
    expect(nextIntervalMs(1000, 0)).toBe(ACTIVE_INTERVAL_MS);
    expect(nextIntervalMs(IDLE_AFTER_MS + 1, 0)).toBe(IDLE_INTERVAL_MS);
  });
  it("spends the per-load frame budget", () => {
    expect(frameBudgetSpent(119, 120)).toBe(false);
    expect(frameBudgetSpent(120, 120)).toBe(true);
  });
  it("derives the per-load render budget from the measured slope and a native memory ceiling", () => {
    expect(renderBudget(1000, 25)).toBe(40);
    expect(renderBudget(10, 25)).toBe(1);
    expect(DEFAULT_MAX_FRAMES).toBe(40);
  });
  it("never lets a page that renders on every frame reach the ceiling, however long it runs", () => {
    // The active dwell renders every frame (a key every 4th frame changes the page). 1000 frames is far past the 240-frame proof.
    let captured = 0;
    let nativeMb = 0;
    let peakMb = 0;
    const slopes: number[] = [];
    for (let frame = 1; frame <= 1000; frame += 1) {
      if (!frameBudgetSpent(captured, DEFAULT_MAX_FRAMES)) {
        captured += 1;
        nativeMb += NATIVE_MB_PER_RENDER;
      }
      peakMb = Math.max(peakMb, nativeMb);
      if (frame >= 60) slopes.push(nativeMb);
    }
    expect(peakMb).toBeLessThanOrEqual(SAFE_NATIVE_CEILING_MB);
    // Flat over frames 60 to 1000: the budget is spent before frame 60 when every frame renders.
    expect(new Set(slopes).size).toBe(1);
  });
});
