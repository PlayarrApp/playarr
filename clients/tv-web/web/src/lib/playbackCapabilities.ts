import type { PlaybackCapabilities } from "@playarr-tv/api-client/react";
import { currentMediaCaps, mediaCapsReady, startMediaCapsDetection } from "./deviceMediaCaps";
import type { ApiClient, PlaybackInfo, PlaybackInfoParams } from "@playarr-tv/api-client";
import { readPlayerDefaults } from "./playerDefaults";
import {
  PLAYARR_CLIENT_PLATFORM,
  type PlayarrWebPlatform,
} from "./clientPlatform";

/**
 * Reasonable, documented default for a modern desktop browser's Shaka Player (MSE + EME) pipeline.
 * HEVC is claimed only when MSE says it can decode it: Chrome on Linux and Firefox cannot, and a
 * false claim makes the server copy HEVC video the page then never renders (TASKS 20.260).
 */
function browserPlaybackCapabilities(hevc: boolean): PlaybackCapabilities {
  return {
    containers: "mp4,webm,mp3,flac,m4a,ogg,opus,wav",
    videoCodecs: hevc ? "h264,h265,vp9,av1" : "h264,vp9,av1",
    audioCodecs: "aac,opus,mp3,flac,vorbis,pcm_s16le,pcm_s24le",
  };
}

const HEVC_PROBE = 'video/mp4; codecs="hvc1.2.4.L153.B0"';

/**
 * Whether this browser decodes 10-bit 4K HEVC, the usual shape of an HEVC library file. MSE first;
 * iPhone Safari has only ManagedMediaSource, and a browser with neither plays HLS natively, so the
 * `<video>` element answers last.
 */
export function browserDecodesHevc(): boolean {
  try {
    if (typeof MediaSource !== "undefined") return MediaSource.isTypeSupported(HEVC_PROBE);
    const managed = (globalThis as { ManagedMediaSource?: { isTypeSupported(type: string): boolean } })
      .ManagedMediaSource;
    if (managed) return managed.isTypeSupported(HEVC_PROBE);
    if (typeof document === "undefined") return false;
    return document.createElement("video").canPlayType(HEVC_PROBE) !== "";
  } catch {
    return false;
  }
}

// HEVC is not claimed on the other vendor TV shells until fragmented-MP4 HEVC HLS
// (the server's video-copy path) is verified on each one (TASKS 20.260 review);
// until then HEVC sources reach them as an H.264 transcode.
/**
 * Subset for VIDAA's embedded browser and media pipeline. HEVC is claimed when MSE reports it: the Hisense
 * MT9602 reports hvc1 and Dolby Vision profiles 5/7/8, and plays the server's HEVC copy (verified on 55A5HX, a
 * profile 5 4K title plays at its original bitrate). Without the claim a profile 5 source needs a GPU
 * transcode the node may not have, and playback is refused ("colour format can't be converted").
 */
function vidaaPlaybackCapabilities(hevc: boolean): PlaybackCapabilities {
  return {
    containers: "mp4,webm,mp3,m4a",
    videoCodecs: hevc ? "h264,h265,vp9" : "h264,vp9",
    audioCodecs: "aac,opus,mp3",
  };
}

/**
 * Verified subset for Xbox's built-in Chromium/Edge browser (MSE), not the
 * native Xbox UWP client under `clients/xbox/` -- those are genuinely
 * different decode paths on the same hardware. This browser reliably plays
 * h264+aac and vp9 (including vp9-in-webm) and has solid MSE Opus support.
 * It falsely reports hevc and av1 as supported via canPlayType/isTypeSupported:
 * hevc doesn't actually decode, and av1 only software-decodes and stutters
 * (no Xbox has AV1 hardware decode at all, the same reason the native client
 * excludes it from every console profile), so both are excluded here. There
 * is no Matroska demuxer, so mkv is excluded too, even though the native
 * client does support it. ac3/eac3 aren't claimed for this MSE path since
 * they're unverified here, unlike the native client's separate decode path.
 */
const XBOX_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,m4v,webm,mp3,m4a",
  videoCodecs: "h264,vp9",
  audioCodecs: "aac,opus",
};

/** Conservative direct-play subset common to current LG webOS TV models. */
const WEBOS_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,mp3,m4a",
  videoCodecs: "h264",
  audioCodecs: "aac,mp3",
};

/** Conservative direct-play subset for Samsung AVPlay across supported Tizen generations. */
const TIZEN_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: "mp4,mp3,m4a",
  videoCodecs: "h264",
  audioCodecs: "aac,mp3",
};

export function playbackCapabilitiesForPlatform(
  platform: PlayarrWebPlatform,
  hevc: boolean = browserDecodesHevc()
): PlaybackCapabilities {
  switch (platform) {
    case "tv-vidaa":
      return vidaaPlaybackCapabilities(hevc);
    case "tv-webos":
      return WEBOS_PLAYBACK_CAPABILITIES;
    case "tv-tizen":
      return TIZEN_PLAYBACK_CAPABILITIES;
    case "xbox":
      return XBOX_PLAYBACK_CAPABILITIES;
    default:
      return browserPlaybackCapabilities(hevc);
  }
}

// Platforms whose browser over-reports decode support (see the Xbox note above).
const UNTRUSTED_TYPE_PROBES: readonly PlayarrWebPlatform[] = ["xbox"];

void startMediaCapsDetection(!UNTRUSTED_TYPE_PROBES.includes(PLAYARR_CLIENT_PLATFORM));

/**
 * Capabilities sent with every playback negotiation: the platform's codec/container profile, the
 * detected HDR/bit-depth/audio abilities and the "Force direct" player settings. Read per request,
 * because detection finishes shortly after start-up and the settings can change at any time.
 */
export function currentPlaybackCapabilities(): PlaybackCapabilities {
  return { ...WEB_PLAYBACK_CAPABILITIES, ...currentMediaCaps(), ...forceFlags() };
}

function forceFlags(): Pick<PlaybackCapabilities, "forceDirectVideo" | "forceDirectAudio"> {
  const { forceDirectVideo, forceDirectAudio } = readPlayerDefaults();
  return {
    ...(forceDirectVideo ? { forceDirectVideo: true } : {}),
    ...(forceDirectAudio ? { forceDirectAudio: true } : {}),
  };
}

/**
 * `ApiClient.getPlaybackInfo` after device detection has finished: detected abilities and the force
 * flags fill any key the caller's params (built earlier, perhaps before detection) left out.
 */
export async function getPlaybackInfoReady(
  client: ApiClient,
  mediaFileId: string,
  params: PlaybackInfoParams
): Promise<PlaybackInfo> {
  await mediaCapsReady();
  // The force settings are read now, not taken from params captured earlier.
  const { forceDirectVideo: _v, forceDirectAudio: _a, ...rest } = params;
  return client.getPlaybackInfo(mediaFileId, { ...currentMediaCaps(), ...rest, ...forceFlags() });
}

export const WEB_PLAYBACK_CAPABILITIES: PlaybackCapabilities =
  playbackCapabilitiesForPlatform(PLAYARR_CLIENT_PLATFORM);
