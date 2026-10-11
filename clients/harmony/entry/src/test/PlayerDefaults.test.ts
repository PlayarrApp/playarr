// entry/src/test/PlayerDefaults.test.ts: core/PlayerDefaults.ts against web lib/playerDefaults.ts.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { QUALITY_TIERS, normaliseQuality, normaliseSubtitleLanguage, normaliseSubtitleMode } from "../main/ets/core/PlayerDefaults";

test("four tiers of three levels, highest tier first", () => {
  assert.deepEqual(QUALITY_TIERS.map((tier) => tier.id), ["uhd", "fhd", "hd", "sd"]);
  assert.ok(QUALITY_TIERS.every((tier) => tier.options.length === 3));
});

test("quality: known ids stay, anything else is Original", () => {
  assert.equal(normaliseQuality("h264-1080p-8mbps"), "h264-1080p-8mbps");
  assert.equal(normaliseQuality("original"), "original");
  assert.equal(normaliseQuality("h264-1080p-9mbps"), "original");
  assert.equal(normaliseQuality(""), "original");
});

test("subtitles: mode and language", () => {
  assert.equal(normaliseSubtitleMode("forced"), "forced");
  assert.equal(normaliseSubtitleMode("loud"), "off");
  assert.equal(normaliseSubtitleLanguage(" FR "), "fr");
  assert.equal(normaliseSubtitleLanguage("  "), "en");
});
