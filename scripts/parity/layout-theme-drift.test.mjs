import test from "node:test";
import assert from "node:assert/strict";
import { themeTextDrift } from "./layout-theme-drift.mjs";

const page = (...texts) => ({ elements: texts.map((text) => (typeof text === "string" ? { text } : text)) });

test("identical texts and theme picker labels are not drift", () => {
  assert.deepEqual(themeTextDrift(page("Device", "Dark", "Theme: Dark"), page("Device", "Light", "Theme: Light")), []);
});
test("a profile chip that differs between themes is drift", () => {
  assert.deepEqual(themeTextDrift(page("Device"), page("parity")), ["dark only: Device", "light only: parity"]);
});
test("volatile text is ignored", () => {
  assert.deepEqual(themeTextDrift(page({ text: "12:00", volatile: true }), page({ text: "12:01", volatile: true })), []);
});
