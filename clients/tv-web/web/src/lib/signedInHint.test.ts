import { describe, expect, it } from "vitest";
import { syncSignedInHint } from "./signedInHint";

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
