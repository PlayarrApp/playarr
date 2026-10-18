import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./Profiles.tsx", import.meta.url), "utf8");

describe("Profiles client navigation", () => {
  it("links the profile picker to the public Clients page with TV focus metadata", () => {
    expect(source).toContain('id="profiles-clients"');
    expect(source).toContain('href="https://playarr.app/clients"');
    expect(source).toContain('data-navigation-focus-key="profiles:clients"');
    expect(source).toContain('isAndroidTv ? "#profiles-check-updates" : "#profiles-clients"');
  });

  it("hides the public Clients link in installed apps, which never show the marketing site", () => {
    expect(source).toMatch(/PLAYARR_CLIENT_PLATFORM === "web" \? \(\s*<a\s+id="profiles-clients"/);
  });

  it("shows the native update action only to the Android TV shell", () => {
    expect(source).toContain('PLAYARR_CLIENT_PLATFORM === "android-tv"');
    expect(source).toContain('id="profiles-check-updates"');
    expect(source).toContain('data-navigation-focus-key="profiles:check-updates"');
    expect(source).toContain('t("pages.profiles.checkForUpdates")');
  });
});
