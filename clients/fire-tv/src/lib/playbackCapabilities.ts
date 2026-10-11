/**
 * The Vega codec/container capability set advertised to `GET /api/v1/playback/{media_file_id}`.
 *
 * The first design advertised nothing, to force `mode: "hls"` on every title, because `VideoPlayer.src` cannot carry an
 * `Authorization` header and Shaka's request filter can. That does not hold up on a real server: HLS needs an on-demand
 * transcode, and a node with no transcode capacity answers 503 `no_transcode_capacity`, so nothing played at all. A direct
 * stream URL needs no header: the negotiation response embeds a `playback_session_id` in it and the media endpoint
 * accepts that alone (checked against the live server with an unauthenticated ranged GET: 206). So the device advertises
 * what its decoders really play and the server picks `direct` whenever it can, falling back to HLS through Shaka (with
 * the header filter) only when the file's container or codec is not in this list.
 *
 * Fire TV Stick 4K Select (Vega OS): H.264 and HEVC in MP4, Matroska and MPEG-TS, with AAC and Dolby audio.
 */
import type {PlaybackCapabilities} from '@playarr-tv/api-client/react';
import type {PlayerDefaults} from './playerDefaults';

export const VEGA_PLAYBACK_CAPABILITIES: PlaybackCapabilities = {
  containers: 'mp4,m4v,mov,mkv,ts,mp3,m4a,flac',
  videoCodecs: 'h264,hevc',
  audioCodecs: 'aac,eac3,ac3,mp3,flac,opus,pcm_s16le,pcm_s24le',
  // The decoder and display limits of a Fire TV Stick 4K Select (Vega has no MediaCodecList to ask, so these are the
  // published figures, kept conservative): HEVC Main 10 up to 3840x2160 at 60 fps, HDR10 and HLG on the display, up to 6
  // channels with Dolby Digital and Digital Plus passthrough. Dolby Vision is not claimed (no dv_profiles), so the server
  // tone-maps it; HDR is declared, so a title with an HDR format the display lacks is converted rather than shown wrong.
  hdr: 'hdr10,hlg',
  maxBitDepth: 10,
  videoProfiles: 'hevc:main 10',
  maxWidth: 3840,
  maxHeight: 2160,
  maxFps: 60,
  maxChannels: 6,
  passthrough: 'eac3,ac3',
};

/** The negotiation query: the device's capabilities plus the user's Force direct switches, which are sent only when on. */
export function playbackCapabilities(defaults: Pick<PlayerDefaults, 'forceDirectVideo' | 'forceDirectAudio'>, extra: Partial<PlaybackCapabilities> = {}): PlaybackCapabilities {
  return {
    ...VEGA_PLAYBACK_CAPABILITIES,
    ...(defaults.forceDirectVideo ? {forceDirectVideo: true} : {}),
    ...(defaults.forceDirectAudio ? {forceDirectAudio: true} : {}),
    ...extra,
  };
}

/** What the player says when the negotiation fails. A 422 is the server's final answer about the colour format: no retry. */
export function negotiationErrorText(message: string): string {
  if (/\b422\b/.test(message)) return "This title's colour format can't be converted for this device.";
  if (/\b503\b/.test(message)) return 'The server is busy with other playback. Try again in a moment.';
  return 'The server could not prepare it for this device.';
}
