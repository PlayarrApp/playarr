import { describe, expect, it } from "vitest";
import { ACTIVE_INTERVAL_MS, IDLE_AFTER_MS, IDLE_INTERVAL_MS, frameBudgetSpent, heapGuardTripped, nextIntervalMs, readHeap } from "./mirrorGuard";

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
});
