import type { PlaybackCapabilities } from "@playarr-tv/api-client/react";

/** What the platform reports about decoding and showing video and audio; the server decides from it. */
export type DetectedMediaCaps = Pick<
  PlaybackCapabilities,
  "hdr" | "dvProfiles" | "maxBitDepth" | "maxWidth" | "maxHeight" | "maxFps" | "maxChannels" | "passthrough"
>;

/**
 * Nothing is detectable (no probe API, or a browser known to over-report): send no capability
 * fields, so the server keeps its legacy rules instead of trusting guesses.
 */
export const UNDECLARED_MEDIA_CAPS: DetectedMediaCaps = {};

interface DecodingConfig {
  type: "media-source";
  video?: Record<string, unknown>;
  audio?: Record<string, unknown>;
}

interface Env {
  /** `MediaSource`/`ManagedMediaSource` exists, so type probes mean something. */
  hasTypeApi: boolean;
  /** `navigator.mediaCapabilities` exists, so decodingInfo answers are real. */
  hasMediaCapabilities: boolean;
  isTypeSupported(type: string): boolean;
  decodingInfo(config: DecodingConfig): Promise<boolean>;
  displayIsHdr(): boolean;
}

function browserEnv(): Env | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  const isTypeSupported = (type: string): boolean => {
    try {
      if (typeof MediaSource !== "undefined") return MediaSource.isTypeSupported(type);
      const managed = (globalThis as { ManagedMediaSource?: { isTypeSupported(t: string): boolean } })
        .ManagedMediaSource;
      return managed ? managed.isTypeSupported(type) : false;
    } catch {
      return false;
    }
  };
  const mc = (navigator as Navigator & {
    mediaCapabilities?: { decodingInfo(c: DecodingConfig): Promise<{ supported: boolean }> };
  }).mediaCapabilities;
  const managed = (globalThis as { ManagedMediaSource?: unknown }).ManagedMediaSource;
  return {
    hasTypeApi: typeof MediaSource !== "undefined" || managed !== undefined,
    hasMediaCapabilities: mc !== undefined,
    isTypeSupported,
    decodingInfo: async (config) => {
      if (!mc) return false;
      try {
        return (await mc.decodingInfo(config)).supported;
      } catch {
        return false;
      }
    },
    displayIsHdr: () => {
      try {
        return typeof matchMedia === "function" && matchMedia("(dynamic-range: high)").matches;
      } catch {
        return false;
      }
    },
  };
}

const HEVC_10 = 'video/mp4; codecs="hvc1.2.4.L153.B0"';
const VIDEO_10_PROBES = [HEVC_10, 'video/mp4; codecs="vp09.02.10.10"', 'video/mp4; codecs="av01.0.08M.10"'];

/**
 * Detects HDR, Dolby Vision, bit depth, 4K and audio abilities. Everything unknown stays at the
 * conservative value. `trustTypeProbes` is false for browsers known to over-report (Xbox Edge).
 */
export async function detectMediaCaps(env: Env | null = browserEnv(), trustTypeProbes = true): Promise<DetectedMediaCaps> {
  if (!env || !trustTypeProbes || !env.hasTypeApi) return UNDECLARED_MEDIA_CAPS;
  const video = (contentType: string, extra: Record<string, unknown> = {}, width = 1920, height = 1080) =>
    env.decodingInfo({
      type: "media-source",
      video: { contentType, width, height, bitrate: 20_000_000, framerate: 24, ...extra },
    });
  const tenBit = VIDEO_10_PROBES.some((probe) => env.isTypeSupported(probe));
  const hdrDisplay = env.displayIsHdr();

  const hdr: string[] = [];
  if (hdrDisplay && tenBit) {
    if (await video(HEVC_10, { transferFunction: "pq", colorGamut: "rec2020", hdrMetadataType: "smpteSt2086" })) hdr.push("hdr10");
    if (await video(HEVC_10, { transferFunction: "hlg", colorGamut: "rec2020" })) hdr.push("hlg");
  }
  // Dolby Vision is a decoder feature of the TV, so the codec string alone is the signal.
  const dvProfiles = [5, 7, 8].filter((profile) =>
    env.isTypeSupported(`video/mp4; codecs="dvh1.0${profile}.06"`)
  );
  if (dvProfiles.length > 0) hdr.push("dolby_vision");

  const uhd = (await video(HEVC_10, {}, 3840, 2160)) || (await video('video/mp4; codecs="avc1.640033"', {}, 3840, 2160));
  const hd = await video('video/mp4; codecs="avc1.640028"');
  const audio = (channels: string) =>
    env.decodingInfo({ type: "media-source", audio: { contentType: 'audio/mp4; codecs="mp4a.40.2"', channels } });
  // Without mediaCapabilities nothing answers for channels: leave it undeclared (no downmix).
  const maxChannels = !env.hasMediaCapabilities ? undefined : (await audio("8")) ? 8 : (await audio("6")) ? 6 : 2;
  const passthrough = (
    [
      ["eac3", "ec-3"],
      ["ac3", "ac-3"],
      ["dts", "dtsc"],
      ["truehd", "mlpa"],
    ] as const
  )
    .filter(([, tag]) => env.isTypeSupported(`audio/mp4; codecs="${tag}"`))
    .map(([name]) => name);

  return {
    hdr: hdr.join(","),
    dvProfiles: dvProfiles.join(","),
    maxBitDepth: tenBit ? 10 : 8,
    // Only a measured 1080p ceiling is sent; an unknown size stays uncapped.
    ...(!uhd && hd ? { maxWidth: 1920, maxHeight: 1080 } : {}),
    ...(maxChannels === undefined ? {} : { maxChannels }),
    passthrough: passthrough.join(","),
  };
}

let detected: DetectedMediaCaps = UNDECLARED_MEDIA_CAPS;
let detection: Promise<DetectedMediaCaps> | null = null;

/** Starts detection once; resolves with the result and updates [`currentMediaCaps`]. */
export function startMediaCapsDetection(trustTypeProbes = true): Promise<DetectedMediaCaps> {
  detection ??= detectMediaCaps(browserEnv(), trustTypeProbes)
    .catch(() => UNDECLARED_MEDIA_CAPS)
    .then((caps) => (detected = caps));
  return detection;
}

/** Resolves once detection has finished (never rejects), so the first negotiation can wait for it. */
export function mediaCapsReady(): Promise<void> {
  return (detection ?? Promise.resolve(detected)).then(
    () => undefined,
    () => undefined
  );
}

export function currentMediaCaps(): DetectedMediaCaps {
  return detected;
}
