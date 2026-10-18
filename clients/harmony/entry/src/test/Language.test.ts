// entry/src/test/Language.test.ts: core/Language.ts and the generated core/Strings.ts against web lib/i18n.
import { test } from "node:test";
import { strict as assert } from "node:assert";

import { STRINGS } from "../main/ets/core/Strings";
import { normaliseLanguagePreference, resolveLanguage, setCurrentLanguage, t } from "../main/ets/core/Language";

test("every translated key exists in English (t falls back to English for the rest)", () => {
  for (const lang of ["th", "ja"]) {
    assert.deepEqual(Object.keys(STRINGS[lang]).filter((k) => !(k in STRINGS.en)), []);
  }
});

test("system follows the device base language, unsupported reads as English", () => {
  assert.equal(resolveLanguage("system", "th-TH"), "th");
  assert.equal(resolveLanguage("system", "ja_JP"), "ja");
  assert.equal(resolveLanguage("system", "fr-FR"), "en");
  assert.equal(resolveLanguage("ja", "th-TH"), "ja");
});

test("a stored value that is not a choice reads as system", () => {
  assert.equal(normaliseLanguagePreference("xx"), "system");
  assert.equal(normaliseLanguagePreference("th"), "th");
});

test("t uses the current language, then English, then the fallback", () => {
  setCurrentLanguage("ja");
  assert.equal(t("settings.index.language.title"), "言語");
  assert.equal(t("no.such.key", "Plain"), "Plain");
  setCurrentLanguage("en");
  assert.equal(t("shell.nav.home"), "Home");
});
