import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Playarr signed release platform selector", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../workflows/ios-release.yml", import.meta.url)),
    "utf8",
  );

  it("defaults to both platforms and validates the explicit platform choice", () => {
    assert.match(workflow, /platform:\n\s+description: [^\n]*tvOS[^\n]*\n\s+required: true\n\s+type: choice\n\s+options:\n\s+- both\n\s+- ios\n\s+- tvos\n\s+default: both/);
    assert.match(workflow, /PLATFORM_INPUT: \$\{\{ inputs\.platform \}\}/);
    assert.match(workflow, /platform="\$\{PLATFORM_INPUT:-both\}"/);
    assert.match(workflow, /\[\[ "\$platform" == both \|\| "\$platform" == ios \|\| "\$platform" == tvos \]\]/);
  });

  it("gates each signed upload independently and requires only its platform profile", () => {
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == ios \]\]; then[\s\S]*?APPLE_PROVISIONING_PROFILE_BASE64/);
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == tvos \]\]; then[\s\S]*?APPLE_TVOS_PROVISIONING_PROFILE_BASE64/);
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == ios \]\]; then\n\s+ARCHIVE_PATH="\$IOS_ARCHIVE_PATH"[\s\S]*?release\.sh "\$RELEASE_MODE" ios\n\s+fi/);
    assert.match(workflow, /if \[\[ "\$RELEASE_PLATFORM" == both \|\| "\$RELEASE_PLATFORM" == tvos \]\]; then\n\s+ARCHIVE_PATH="\$TVOS_ARCHIVE_PATH"[\s\S]*?release\.sh "\$RELEASE_MODE" tvos\n\s+fi/);
  });
});
