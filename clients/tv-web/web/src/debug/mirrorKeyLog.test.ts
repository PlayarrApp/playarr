import { describe, expect, it } from "vitest";
import { describeEvent } from "./mirrorKeyLog";

describe("mirror key log", () => {
  it("records key, code and keyCode for key events", () => {
    expect(describeEvent({ type: "keydown", key: "Unidentified", code: "", keyCode: 461 }, 5)).toEqual({ type: "keydown", at: 5, key: "Unidentified", code: "", keyCode: 461 });
  });
  it("records only type, time and detail for navigation events", () => {
    expect(describeEvent({ type: "popstate" }, 7, "/home")).toEqual({ type: "popstate", at: 7, detail: "/home" });
  });
});
