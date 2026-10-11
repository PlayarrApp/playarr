import { useEffect, useState } from "react";
import { useApiClient } from "./ApiClientProvider";

/** What the platform's now-playing notification shows (Media Session API). */
export interface NowPlayingInfo {
  title: string;
  /** Artist for music, the series (or other context line) for video. */
  artist?: string;
  album?: string;
  artworkUrl?: string | null;
}

export function nowPlayingMetadataInit(info: NowPlayingInfo): MediaMetadataInit {
  return {
    title: info.title,
    artist: info.artist ?? "",
    album: info.album ?? "",
    artwork: info.artworkUrl ? [{ src: info.artworkUrl, sizes: "512x512" }] : [],
  };
}

/** Position state the Media Session API accepts: a finite duration and a position inside it. `null` when it would throw. */
export function nowPlayingPositionState(
  positionSeconds: number,
  durationSeconds: number
): MediaPositionState | null {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null;
  if (!Number.isFinite(positionSeconds)) return null;
  return {
    duration: durationSeconds,
    position: Math.min(Math.max(0, positionSeconds), durationSeconds),
    playbackRate: 1,
  };
}

/** Publishes title, artist, album and artwork to `navigator.mediaSession`, and clears them on unmount. */
export function useNowPlayingMetadata(info: NowPlayingInfo | null): void {
  const title = info?.title;
  const artist = info?.artist;
  const album = info?.album;
  const artworkUrl = info?.artworkUrl;
  useEffect(() => {
    const session = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!session || typeof MediaMetadata === "undefined" || !title) return;
    try {
      session.metadata = new MediaMetadata(nowPlayingMetadataInit({ title, artist, album, artworkUrl }));
    } catch {
      // A partially implemented Media Session must never affect playback.
    }
    return () => {
      try {
        session.metadata = null;
      } catch {
        // Same.
      }
    };
  }, [title, artist, album, artworkUrl]);
}

/** A poster of one work as a `blob:` URL for the notification (the artwork endpoint needs the session's token). */
export function useNowPlayingArtwork(workId: string | undefined): string | null {
  const client = useApiClient();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!workId) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    client
      .getWorkArtwork(workId, "poster", { width: 512 })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [client, workId]);
  return url;
}
