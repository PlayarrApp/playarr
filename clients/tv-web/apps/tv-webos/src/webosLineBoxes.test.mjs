import assert from "node:assert/strict";
import test from "node:test";
import { countLines, needsLineBoxFix } from "./webosLineBoxes.mjs";

test("countLines groups client rects by line top", () => {
  const r = (top, width = 40) => ({ top, width, height: 18 });
  assert.equal(countLines([r(10), r(10.5), r(52), r(52.4), r(94)]), 3);
  assert.equal(countLines([r(10, 0)]), 0);
});

test("only engines before Chromium 105 get the line box fix", () => {
  assert.equal(needsLineBoxFix("Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/94.0.4606.128 Safari/537.36"), true);
  assert.equal(needsLineBoxFix("Mozilla/5.0 (Web0S; Linux/SmartTV) Chrome/108.0.5359.79 Safari/537.36"), false);
  assert.equal(needsLineBoxFix("no chrome here"), false);
});
