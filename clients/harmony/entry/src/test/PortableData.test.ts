// entry/src/test/PortableData.test.ts: core/PortableData.ts against web's importQuery and YourData texts.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { importQuery, formatBytes, resultLine } from "../main/ets/core/PortableData";

describe("PortableData", () => {
  it("builds web's import query", () => {
    assert.equal(importQuery(false, false, ""), "progress_conflicts=newest");
    assert.equal(importQuery(true, true, "ab/c"), "include_preferences=true&progress_conflicts=keep_existing&package_sha256=ab%2Fc");
  });
  it("formats sizes like web", () => {
    assert.equal(formatBytes(null), "");
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2.0 KB");
    assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
  });
  it("words a finished and a stopped import", () => {
    assert.equal(resultLine({ completed: true, progress_added: 2, progress_updated: 1, playlist_items_added: 4, failure: null }),
      "Import finished: 3 progress records and 4 playlist items saved.");
    assert.ok(resultLine({ completed: false, progress_added: 0, progress_updated: 0, playlist_items_added: 0, failure: "boom." }).startsWith("The import stopped part way: boom."));
  });
});
