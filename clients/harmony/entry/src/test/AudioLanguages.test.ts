// entry/src/test/AudioLanguages.test.ts: core/AudioLanguages.ts against web pages/settings/Player.tsx.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { AUDIO_LANGUAGES, audioLanguageLabel, normaliseAudioLanguage } from "../main/ets/core/AudioLanguages";

test("twelve languages in web order", () => {
  assert.equal(AUDIO_LANGUAGES.length, 12);
  assert.equal(AUDIO_LANGUAGES[0].value, "en");
  assert.equal(AUDIO_LANGUAGES[11].value, "th");
});

test("unknown server values read as English", () => {
  assert.equal(normaliseAudioLanguage("ja"), "ja");
  assert.equal(normaliseAudioLanguage("xx"), "en");
  assert.equal(audioLanguageLabel("fr"), "French");
  assert.equal(audioLanguageLabel("xx"), "English");
});
