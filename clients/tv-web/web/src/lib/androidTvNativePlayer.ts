import {
  BasePlaybackEngine,
  type ExternalSubtitleTrack,
  type PlaybackAudioTrack,
  type PlaybackSource,
  type PlaybackState,
  type PlaybackSubtitleTrack,
} from "@playarr-tv/player-core";

/**
 * The Android TV web view shell's native video plane.
 *
 * The shell (clients/android, `WebTvShellActivity`) runs this same web client inside the platform WebView and
 * decodes video with Media3 on a surface behind the page, the way the Tizen shell uses AVPlay: the page keeps
 * every control, the shell only plays. The shell injects `window.PlayarrAndroidTvPlayer` (calls into Media3) and
 * calls back `window.__playarrNativePlayerEvent(json)` with the player state.
 */
interface NativePlayerBridge {
  load(url: string, mimeType: string, sessionId: string, startSeconds: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  selectAudio(trackId: string): void;
  selectSubtitle(trackId: string): void;
  release(): void;
}

interface NativePlayerEvent {
  state: PlaybackState;
  positionSeconds: number;
  durationSeconds: number;
  bufferedSeconds: number;
  audioTracks: PlaybackAudioTrack[];
  subtitleTracks: PlaybackSubtitleTrack[];
  selectedAudioTrackId: string | null;
  selectedSubtitleTrackId: string | null;
  error?: { code: string; message: string; httpStatus?: number; requestUri?: string };
}

type NativePlayerWindow = Window & {
  PlayarrAndroidTvPlayer?: NativePlayerBridge;
  PlayarrAndroidTvShell?: { homeReady(): void };
  __playarrNativePlayerEvent?: (json: string) => void;
};

export function androidTvNativeBridge(): NativePlayerBridge | undefined {
  return typeof window === "undefined" ? undefined : (window as NativePlayerWindow).PlayarrAndroidTvPlayer;
}

export class AndroidTvNativeEngine extends BasePlaybackEngine {
  private readonly bridge: NativePlayerBridge;
  private sessionId = "";
  private pendingLoad: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private destroyed = false;

  constructor() {
    super();
    const bridge = androidTvNativeBridge();
    if (!bridge) throw new Error("Android TV native player bridge is unavailable");
    this.bridge = bridge;
    (window as NativePlayerWindow).__playarrNativePlayerEvent = (json) => this.onNativeEvent(json);
  }

  setPlaybackSessionId(sessionId: string | null): void {
    this.sessionId = sessionId ?? "";
  }

  getBytesReceived(): number {
    return 0;
  }

  resetBytesReceived(): void {}

  private onNativeEvent(json: string): void {
    if (this.destroyed) return;
    const event = JSON.parse(json) as NativePlayerEvent;
    const previous = this.state.state;
    this.setState({
      state: event.state,
      currentTimeSeconds: event.positionSeconds,
      durationSeconds: event.durationSeconds,
      bufferedSeconds: event.bufferedSeconds,
      audioTracks: event.audioTracks,
      subtitleTracks: event.subtitleTracks,
      selectedAudioTrackId: event.selectedAudioTrackId,
      selectedSubtitleTrackId: event.selectedSubtitleTrackId,
      error: event.error ? { ...event.error, fatal: true } : undefined,
    });
    const pending = this.pendingLoad;
    if (pending && event.state !== "loading" && previous !== event.state) {
      this.pendingLoad = null;
      if (event.state === "error") pending.reject(new Error(event.error?.message ?? "playback failed"));
      else pending.resolve();
    }
  }

  load(source: PlaybackSource): Promise<void> {
    this.setState({ state: "loading", currentTimeSeconds: 0, durationSeconds: 0, bufferedSeconds: 0, error: undefined });
    return new Promise<void>((resolve, reject) => {
      this.pendingLoad = { resolve, reject };
      this.bridge.load(source.url, source.mimeType, this.sessionId, source.startPositionSeconds ?? 0);
      this.sessionId = "";
    });
  }

  async play(): Promise<void> {
    this.bridge.play();
  }

  async pause(): Promise<void> {
    this.bridge.pause();
  }

  async seek(positionSeconds: number): Promise<void> {
    this.bridge.seek(positionSeconds);
    this.setState({ currentTimeSeconds: positionSeconds });
  }

  setVolume(volume: number): void {
    this.bridge.setVolume(volume);
    this.setState({ volume });
  }

  setMuted(muted: boolean): void {
    this.bridge.setMuted(muted);
    this.setState({ muted });
  }

  async selectAudioTrack(trackId: string): Promise<void> {
    this.bridge.selectAudio(trackId);
  }

  async addExternalSubtitleTracks(_tracks: ExternalSubtitleTrack[]): Promise<void> {}

  async selectSubtitleTrack(trackId: string | null): Promise<void> {
    this.bridge.selectSubtitle(trackId ?? "");
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.pendingLoad = null;
    this.bridge.release();
  }
}

/**
 * Tells the shell when Home content is on screen (the first Home card has been laid out and painted), so the shell can
 * log one cold-start marker. No-op outside the shell.
 */
export function installAndroidTvShellReadyMarker(): void {
  const shell = (window as NativePlayerWindow).PlayarrAndroidTvShell;
  if (!shell) return;
  const root = document.getElementById("root");
  if (!root) return;
  const done = () => {
    observer.disconnect();
    requestAnimationFrame(() => requestAnimationFrame(() => shell.homeReady()));
  };
  const observer = new MutationObserver(() => {
    if (root.querySelector(".tv-home-card")) done();
  });
  observer.observe(root, { childList: true, subtree: true });
}
