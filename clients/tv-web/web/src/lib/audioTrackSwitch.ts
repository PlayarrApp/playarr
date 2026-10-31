import type { PlaybackAudioTrack } from "@playarr-tv/player-core";

/** The slice of an `HTMLMediaElement.audioTracks` entry the switch needs (Safari implements it). */
export interface NativeAudioTrackLike {
  enabled: boolean;
}

export interface NativeAudioTrackListLike {
  readonly length: number;
  [index: number]: NativeAudioTrackLike;
}

/**
 * Whether the picker lists the negotiated source audio tracks. HLS keeps the single-track list it always had;
 * any other mode (direct play) needs 2+ tracks, because a lone track gives nothing to choose.
 */
export function shouldExposeSourceAudioTracks(
  negotiation: { kind: string; mode?: string },
  trackCount: number
): boolean {
  if (negotiation.kind !== "ready") return false;
  return negotiation.mode === "hls" ? trackCount > 0 : trackCount >= 2;
}

/**
 * The browser's own audio track list when it can drive a direct-play switch: it exists and has one entry per
 * source track, in the same order. Chromium and Firefox hide the list behind a flag, so they renegotiate.
 */
export function nativeAudioTracksFor(
  video: object | null | undefined,
  mode: string | undefined,
  sourceTrackCount: number
): NativeAudioTrackListLike | null {
  if (mode !== "direct" || !video) return null;
  const list = (video as { audioTracks?: NativeAudioTrackListLike }).audioTracks;
  if (!list || typeof list.length !== "number") return null;
  if (sourceTrackCount < 2 || list.length !== sourceTrackCount) return null;
  return list;
}

/** Enable only the picked track on the native list. Returns false when the id is not in the source list. */
export function switchNativeAudioTrack(
  list: NativeAudioTrackListLike,
  sourceTracks: readonly Pick<PlaybackAudioTrack, "id">[],
  trackId: string
): boolean {
  const target = sourceTracks.findIndex((track) => track.id === trackId);
  if (target < 0 || target >= list.length) return false;
  for (let index = 0; index < list.length; index += 1) {
    list[index]!.enabled = index === target;
  }
  return true;
}

/** The playback-info request for a renegotiated audio pick: resume at the current position with the new stream. */
export function audioSwitchRequest<T extends object>(
  base: T,
  absolutePositionSeconds: number,
  audioStreamIndex: number
): T & { startPositionMs: number; audioStreamIndex: number } {
  return {
    ...base,
    startPositionMs: Math.max(0, Math.round(absolutePositionSeconds * 1000)),
    audioStreamIndex,
  };
}
