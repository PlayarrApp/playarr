import { describe, expect, it } from "vitest";
import { isAppRequest } from "./appSignal.js";

const req = (path = "/", headers = {}) => new Request(`https://playarr.app${path}`, { headers });

describe("isAppRequest", () => {
  it("is false for a plain browser visit", () => {
    expect(isAppRequest(req("/", { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/130", Cookie: "a=b" }))).toBe(false);
    expect(isAppRequest(req("/?utm_source=x"))).toBe(false);
  });

  it.each(["tv-vidaa", "tv-webos", "tv-tizen", "android-tv", "android-mobile", "xbox", "web", "some-new-client"])(
    "is true for ?platform=%s",
    (platform) => {
      expect(isAppRequest(req(`/?platform=${platform}`))).toBe(true);
    }
  );

  it.each(["", "../x", "<script>", "a".repeat(40)])("ignores a malformed platform %j", (platform) => {
    expect(isAppRequest(req(`/?platform=${encodeURIComponent(platform)}`))).toBe(false);
  });

  it.each([
    "Mozilla/5.0 (Linux; VIDAA 6.0) AppleWebKit/537.36",
    "Mozilla/5.0 (Linux; Hisense U7) AppleWebKit/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Xbox; Xbox One) Edge/44",
    "Mozilla/5.0 (Linux; Android 14) PlayarrAndroidTV/1.2.3",
    "Mozilla/5.0 (Linux; Android 14) PlayarrAndroidMobile/1.2.3",
  ])("is true for the app user agent %s", (ua) => {
    expect(isAppRequest(req("/", { "User-Agent": ua }))).toBe(true);
  });

  it.each(["playarr_signed_in=1", "a=b; playarr_app=1", "playarr_app=1; c=d"])("is true for the cookie %s", (cookie) => {
    expect(isAppRequest(req("/", { Cookie: cookie }))).toBe(true);
  });

  it.each(["playarr_app=0", "playarr_app=", "xplayarr_app=1", "playarr_signed_in="])("is false for the cookie %s", (cookie) => {
    expect(isAppRequest(req("/", { Cookie: cookie }))).toBe(false);
  });
});
