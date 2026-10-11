import { describe, expect, it } from "vitest";
import { UNDECLARED_MEDIA_CAPS, detectMediaCaps } from "./deviceMediaCaps";

type Cfg = { video?: Record<string, unknown>; audio?: Record<string, unknown> };

function env(opts: {
  types?: string[];
  hdrDisplay?: boolean;
  videoOk?: (cfg: Cfg) => boolean;
  channels?: number;
  hasTypeApi?: boolean;
  hasMediaCapabilities?: boolean;
}) {
  return {
    hasTypeApi: opts.hasTypeApi ?? true,
    hasMediaCapabilities: opts.hasMediaCapabilities ?? true,
    isTypeSupported: (t: string) => (opts.types ?? []).some((s) => t.includes(s)),
    displayIsHdr: () => opts.hdrDisplay ?? false,
    decodingInfo: async (cfg: Cfg) => {
      if (cfg.audio) return Number(cfg.audio.channels) <= (opts.channels ?? 2);
      return opts.videoOk ? opts.videoOk(cfg) : true;
    },
  };
}

describe("detectMediaCaps", () => {
  it("is conservative without an environment or when probes are untrusted", async () => {
    expect(await detectMediaCaps(null)).toEqual(UNDECLARED_MEDIA_CAPS);
    expect(await detectMediaCaps(env({ types: ["hvc1"], hdrDisplay: true }), false)).toEqual(
      UNDECLARED_MEDIA_CAPS
    );
  });

  it("declares nothing when the type-probe API is absent", async () => {
    expect(await detectMediaCaps(env({ types: ["avc1"], hasTypeApi: false }))).toEqual(
      UNDECLARED_MEDIA_CAPS
    );
  });

  it("leaves channels undeclared when mediaCapabilities is absent", async () => {
    const caps = await detectMediaCaps(env({ types: ["avc1"], hasMediaCapabilities: false }));
    expect(caps.maxBitDepth).toBe(8);
    expect(caps).not.toHaveProperty("maxChannels");
  });

  it("reports SDR 8-bit stereo for a plain H.264 device", async () => {
    const caps = await detectMediaCaps(env({ types: ["avc1"] }));
    expect(caps).toMatchObject({ hdr: "", maxBitDepth: 8, maxChannels: 2, passthrough: "" });
  });

  it("reports HDR10, HLG and 10-bit only with an HDR display and a 10-bit decoder", async () => {
    const withDisplay = await detectMediaCaps(env({ types: ["hvc1"], hdrDisplay: true, channels: 6 }));
    expect(withDisplay).toMatchObject({ hdr: "hdr10,hlg", maxBitDepth: 10, maxChannels: 6 });
    const sdrDisplay = await detectMediaCaps(env({ types: ["hvc1"], channels: 6 }));
    expect(sdrDisplay).toMatchObject({ hdr: "", maxBitDepth: 10 });
  });

  it("lists the Dolby Vision profiles the decoder accepts", async () => {
    const caps = await detectMediaCaps(env({ types: ["hvc1", "dvh1.05", "dvh1.08"], hdrDisplay: true }));
    expect(caps.dvProfiles).toBe("5,8");
    expect(caps.hdr).toContain("dolby_vision");
  });

  it("detects passthrough codecs and a 1080p ceiling", async () => {
    const caps = await detectMediaCaps(
      env({
        types: ["avc1", "ec-3", "ac-3"],
        videoOk: (cfg) => Number(cfg.video?.width) <= 1920,
        channels: 8,
      })
    );
    expect(caps).toMatchObject({ passthrough: "eac3,ac3", maxChannels: 8, maxWidth: 1920, maxHeight: 1080 });
  });
});
