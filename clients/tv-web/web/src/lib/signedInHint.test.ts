import { describe, expect, it } from "vitest";
import { syncInstalledAppHint, syncSignedInHint } from "./signedInHint";

describe("syncSignedInHint", () => {
  it("sets the hint cookie for an active session", () => {
    const doc = { cookie: "" };
    syncSignedInHint(true, doc);
    expect(doc.cookie).toBe("playarr_signed_in=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
  });

  it("expires the hint cookie on sign-out", () => {
    const doc = { cookie: "" };
    syncSignedInHint(false, doc);
    expect(doc.cookie).toBe("playarr_signed_in=; Path=/; Max-Age=0; SameSite=Lax; Secure");
  });

  it("does nothing without a document", () => {
    expect(() => syncSignedInHint(true, undefined)).not.toThrow();
  });
});

describe("syncInstalledAppHint", () => {
  it("sets the installed-app cookie only for an installed app", () => {
    const installed = { cookie: "" };
    syncInstalledAppHint(true, installed);
    expect(installed.cookie).toBe("playarr_app=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure");
    const browser = { cookie: "" };
    syncInstalledAppHint(false, browser);
    expect(browser.cookie).toBe("");
  });
});
