// entry/src/test/RuntimeLabel.test.ts: core/RuntimeLabel.ts.
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";

import { formatRuntimeLabel } from "../main/ets/core/RuntimeLabel";

describe("formatRuntimeLabel", () => {
  it("formats hours and minutes as web does", () => {
    assert.equal(formatRuntimeLabel(112 * 60000), "1h 52m");
    assert.equal(formatRuntimeLabel(45 * 60000), "45m");
    assert.equal(formatRuntimeLabel(120 * 60000), "2h");
    assert.equal(formatRuntimeLabel(null), "");
    assert.equal(formatRuntimeLabel(0), "");
  });
});
