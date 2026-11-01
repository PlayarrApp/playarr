/**
 * The real Player screen (design doc §7: "`/player/:id` -> `Player.tsx`
 * (584) -> `PlayerScreen.tsx`"), built on `VegaPlaybackEngine`/
 * `VegaVideoSurface` from `platform/media/`.
 *
 * ============================ MOUNTING CONTRACT ============================
 * Design doc §4.2/§4.3: `PlayerScreen` is SHELL-MOUNTED, not routed -- there
 * is no `ROUTES.player` and this file must never be registered against one.
 * A later stage mounts exactly one `<PlayerScreen ref={...} />` inside
 * `App.tsx`'s render tree (sibling to, not inside, `<AppShellNavigator>`'s
 * content stack), so it survives every navigation the same way tv-web's own
 * `<Player>` does at its `App.tsx:~470-540`. That later stage drives this
 * component entirely through the imperative handle below -- it never passes
 * a `mediaFileId` prop, because there is no `mediaFileId` to pass until
 * something (`WorkDetailScreen`'s `onPlay`, `MusicDetailScreen`'s inline
 * player, a resumed session) actually calls `show()`:
 *
 *   const playerRef = useRef<PlayerScreenHandle>(null);
 *   ...
 *   <PlayerScreen ref={playerRef} userId={currentProfile?.id} onClose={...} />
 *   ...
 *   <WorkDetailScreen onPlay={(mediaFileId) => playerRef.current?.show(mediaFileId)} />
 *
 * `show()`/`hide()`/`stop()`/`isVisible()` are the whole contract:
 *
 *  - `show(mediaFileId, options?)` negotiates playback and starts it. Safe
 *    to call again with a different `mediaFileId` while something is
 *    already playing -- the previous session is closed out cleanly first
 *    (`VegaPlaybackEngine.load()`'s own single-decoder teardown handles the
 *    native side; this file closes the previous analytics session before
 *    that).
 *  - `hide()` stops RENDERING the visual surface only -- playback continues
 *    underneath. This is deliberate, not a bug: design doc §4.2's whole
 *    reason `PlayerScreen` is shell-mounted rather than routed is "so a
 *    minimised music player survives navigation". A shell wiring a music
 *    detail screen's inline mini-player calls `hide()`, not `stop()`.
 *  - `stop()` pauses playback, closes the current analytics session,
 *    flushes final watch progress, and hides the surface -- the real "stop
 *    and go back" action. This screen's own Back-button handling calls
 *    `stop()` (after the controls overlay has been dismissed): exiting
 *    playback must stop audio and video and flush progress, awaited.
 *  - `isVisible()` lets the shell avoid remounting or re-showing a player
 *    that is already visible for the same title.
 * =============================================================================
 *
 * Deliberately narrowed scope, stated explicitly (this repo's own
 * established pattern -- see `WorkDetailScreen.tsx`/`ApiClientProvider.tsx`
 * for the same posture): quality-tier selection
 * (`settings/PlayerSettingsScreen.tsx`'s own "later, not-yet-built step"
 * comment), mid-session audio-track switching (tv-web's own
 * `usePlaybackEngine.ts` re-negotiates an entirely new on-demand HLS
 * session for this, real complexity this pass does not attempt), and a
 * playlist/next-episode queue are all left for a later pass. What genuinely
 * works end to end: negotiation, HLS playback via `VegaPlaybackEngine`,
 * sidecar subtitle tracks, play/pause/seek transport control (remote keys
 * and an on-screen bar), watch-progress persistence, and playback-session
 * analytics events.
 */
import React, {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, Text, View} from 'react-native';
import type {PlaybackQualityOption} from '@playarr-tv/api-client';
import type {PlaybackEventKind} from '@playarr-tv/api-client';
import {usePlaybackInfo} from '@playarr-tv/api-client/react';
import {TokenStore} from '@playarr-tv/device-auth';
import type {PlaybackEngineState} from '@playarr-tv/player-core';
import {useApiClient} from '../api/ApiClientProvider';
import {ensureFireTvAccessToken} from '../auth/session';
import {useAppForeground, useRemoteKey} from '../platform';
import {TvFocusScope, focusNode} from '../platform/focus';
import {reportQuery} from '../debug/parityControl';
import {audioCodecName, audioTrackLabel} from '../lib/trackLabels';
import {useBackLayer} from '../navigation/backPolicy';
import {DarkSurface} from '../theme/ThemeProvider';
import {PlayerChrome, type ChromeControl} from '../player/PlayerChrome';
import {QualityMenu, originalLabel} from '../player/QualityMenu';
import {Sheet, SheetOption} from '../tv/Sheet';
import {getSharedVegaPlaybackEngine} from '../platform/media/VegaPlaybackEngine';
import {VegaVideoSurface} from '../platform/media/VegaVideoSurface';
import {negotiationErrorText, playbackCapabilities} from '../lib/playbackCapabilities';
import {readPlayerDefaults} from '../lib/playerDefaults';
import {clearActivePlayerSession, readActivePlayerSession, writeActivePlayerSession} from '../lib/playerSession';
import {colour} from '../theme/tokens';
import {resumeSecondsFromServer, settleWithin, shouldWriteProgress} from '../lib/progressRules';
import {resolveBack, showSpinner} from './playerStage';
import {sh, sw} from '../theme/scale';

export interface PlayerLaunchOptions {
  /** Absolute source timestamp to resume at, in seconds. `undefined` falls back to a persisted `lib/playerSession.ts` resume position for this `mediaFileId` (if any), then to the beginning. */
  startPositionSeconds?: number;
  /** Shown in the transport bar while real work metadata is unavailable (there is none here -- the caller usually already has the title from whatever screen launched playback). */
  title?: string;
  /** The saved quality for the file: its id and the transcoding profile (`null` or missing plays the original). */
  qualityId?: string;
  profile?: string | null;
  /** The titles that play one after another (an episode list, a playlist), in order; the launched file is one of them. Empty or missing is a single title. */
  queue?: {mediaFileId: string; title: string}[];
}

export interface PlayerScreenHandle {
  show(mediaFileId: string, options?: PlayerLaunchOptions): void;
  hide(): void;
  /** Resolves once the final progress write and session close have settled (bounded). */
  stop(): Promise<void>;
  isVisible(): boolean;
}

export interface PlayerScreenProps {
  /** The signed-in profile's id, purely to scope `lib/playerSession.ts`'s persisted resume bookkeeping per profile. `undefined` before a profile is selected. */
  userId?: string;
  /** Called when the user backs out of a visible player. NOT called for a programmatic `hide()`/`stop()` -- see this file's own top comment for the Back-vs-Stop distinction. */
  onClose?: () => void;
  /** Called whenever the player's surface appears or goes away (the shell hides the page under it while it is up). */
  onVisibleChange?: (visible: boolean) => void;
}

function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

interface ActiveSession {
  sessionId: string;
  mediaFileId: string;
  startedEvent: boolean;
  closed: boolean;
}

export const PlayerScreen = forwardRef<PlayerScreenHandle, PlayerScreenProps>(function PlayerScreen(
  {userId, onClose, onVisibleChange},
  ref
): JSX.Element | null {
  const client = useApiClient();
  // One VegaPlaybackEngine for the app's whole lifetime (design doc §6.3's
  // single-decoder discipline) -- see getSharedVegaPlaybackEngine's own
  // comment. `new TokenStore()` here matches the established precedent
  // `ApiClientProvider.tsx`'s own doc comment states explicitly: multiple
  // independent TokenStore() instances all read/write the same underlying
  // storage, so there is nothing to share by threading one through props.
  const engine = useMemo(() => getSharedVegaPlaybackEngine(), []);
  const tokenStore = useMemo(() => new TokenStore(), []);
  const foreground = useAppForeground();

  const [mediaFileId, setMediaFileId] = useState<string | null>(null);
  const [launchOptions, setLaunchOptions] = useState<PlayerLaunchOptions>({});
  const [visible, setVisible] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [focusedControl, setFocusedControl] = useState<ChromeControl | null>('play');
  // What the native focus really is (set by the controls' own onFocus), for the retries that put it on Play.
  const nativeControl = useRef<ChromeControl | null>(null);
  const [menu, setMenu] = useState<'quality' | 'subtitles' | 'audio' | 'playlist' | 'info' | 'cast' | null>(null);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [quality, setQuality] = useState<{id: string; profile?: string}>({id: 'original'});
  const [engineState, setEngineState] = useState<PlaybackEngineState>(() => engine.getState());

  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  // Read once per player: the switches change in Settings, not while a title plays.
  const [forceDefaults] = useState(readPlayerDefaults);
  const negotiation = usePlaybackInfo(
    client,
    mediaFileId ?? undefined,
    quality.profile ? playbackCapabilities(forceDefaults, {profile: quality.profile, forceTranscode: true}) : playbackCapabilities(forceDefaults),
  );

  const loadedSessionIdRef = useRef<string | null>(null);
  const sessionRef = useRef<ActiveSession | null>(null);
  const latestPlaybackRef = useRef({positionMs: 0, durationMs: 0});
  latestPlaybackRef.current = {
    positionMs: Math.max(0, Math.round(engineState.currentTimeSeconds * 1000)),
    durationMs: Math.max(0, Math.round(engineState.durationSeconds * 1000)),
  };

  // Mirrors `ApiClientProvider.tsx`'s `getAccessToken` seam, but through
  // `ensureFireTvAccessToken` rather than a raw stored token: playback can
  // run for hours, comfortably longer than a short-lived access token's
  // lifetime, and `player-shaka`'s `setAuthHeaderProvider` contract (which
  // `VegaPlaybackEngine` mirrors by name) is called on every single Shaka
  // request specifically so a mid-session refresh is transparent to
  // in-flight playback. A rejected refresh resolves to `undefined` here
  // rather than throwing -- `attachAuth` (`platform/media/authTransport.ts`)
  // already treats a missing token as "send the request unauthenticated",
  // a real, visible 401 rather than an unhandled rejection inside Shaka's
  // own request pipeline.
  useEffect(() => {
    engine.setAuthHeaderProvider(() =>
      ensureFireTvAccessToken(client, tokenStore).catch(() => undefined)
    );
  }, [client, engine, tokenStore]);

  useEffect(() => engine.onStateChange(setEngineState), [engine]);

  // True once this load really reached "playing"; a stalled or failed start
  // must never write position 0 or overwrite the server's resume point.
  const playbackStartedRef = useRef(false);
  useEffect(() => {
    if (engineState.state === 'playing') playbackStartedRef.current = true;
  }, [engineState.state]);

  const flushProgress = useCallback(
    (completed: boolean): Promise<void> => {
      if (!mediaFileId) return Promise.resolve();
      const {positionMs, durationMs} = latestPlaybackRef.current;
      if (!shouldWriteProgress({positionMs, completed, playbackStarted: playbackStartedRef.current})) {
        return Promise.resolve();
      }
      return client
        .updateWatchProgress(mediaFileId, {positionMs, durationMs, completed})
        .then(() => undefined)
        .catch(() => {
          // Progress must never interrupt playback -- the next heartbeat or
          // state transition retries with the latest position.
        });
    },
    [client, mediaFileId]
  );

  const closeSession = useCallback(
    (event: PlaybackEventKind, completed: boolean): Promise<void> => {
      const session = sessionRef.current;
      if (!session || session.closed) return Promise.resolve();
      session.closed = true;
      const saved = flushProgress(completed);
      const closed = client.recordPlaybackEvent(session.sessionId, event).catch(() => {
        // Teardown stays best-effort: a dead network must not wedge the exit.
      });
      return Promise.all([saved, closed]).then(() => undefined);
    },
    [client, flushProgress]
  );

  const recordEvent = useCallback(
    (event: PlaybackEventKind) => {
      const session = sessionRef.current;
      if (!session || session.closed) return;
      void client.recordPlaybackEvent(session.sessionId, event).catch(() => undefined);
    },
    [client]
  );

  // Negotiates and loads whenever `show()` sets a fresh `mediaFileId` and
  // negotiation resolves -- guarded by `loadedSessionIdRef` so an unrelated
  // re-render (e.g. `engineState` ticking on every `timeupdate`) never
  // re-triggers this. A brand-new `session_id` always means a genuinely new
  // negotiation happened (a fresh `show()` call, or a retried negotiation
  // after a transient failure), which is exactly when a reload is correct.
  useEffect(() => {
    if (negotiation.status !== 'ready' || !mediaFileId) return;
    const info = negotiation.data;
    if (loadedSessionIdRef.current === info.session_id) return;
    loadedSessionIdRef.current = info.session_id;

    // Close out whatever session was previously open (e.g. the user picked
    // a different title while one was already playing) before starting the
    // new one -- VegaPlaybackEngine.load() itself handles tearing down the
    // previous native player; this is the analytics-session half of that.
    // `flushProgress` is bound to the NEW media id here, so never write the old position to it.
    playbackStartedRef.current = false;
    closeSession({kind: 'stop', position_ms: latestPlaybackRef.current.positionMs, reason: 'user_stopped'}, false);

    engine.setPlaybackSessionId(info.session_id);
    engine.setDurationHint(info.duration_ms / 1000);
    sessionRef.current = {sessionId: info.session_id, mediaFileId, startedEvent: false, closed: false};

    playbackStartedRef.current = false;
    const persisted = readActivePlayerSession(userId);
    const localSeconds = persisted?.mediaFileId === mediaFileId ? persisted.startPositionSeconds : undefined;

    // Resume point: an explicit launch position, else the server's row (the
    // same call the web client makes), else the local session if the server
    // could not be reached.
    const resolveStart: Promise<number | undefined> =
      launchOptions.startPositionSeconds !== undefined
        ? Promise.resolve(launchOptions.startPositionSeconds)
        : client.getWatchProgress(mediaFileId).then(
            (progress) => resumeSecondsFromServer(progress),
            () => localSeconds
          );

    void resolveStart
      .then((startPositionSeconds) => {
        writeActivePlayerSession(userId, {mediaFileId, startPositionSeconds, title: launchOptions.title});
        return engine.load({url: client.resolveUrl(info.url), mimeType: info.mime_type, startPositionSeconds});
      })
      // Start first: a sidecar subtitle that never resolves or fails must not leave a loaded title paused.
      .then(() => engine.play())
      .then(async () => {
        if (info.subtitle_tracks.length === 0) return;
        try {
          await engine.addExternalSubtitleTracks(
            info.subtitle_tracks.map((track) => ({
              id: track.id,
              url: client.resolveUrl(track.url),
              label: track.label,
              language: track.language ?? undefined,
              forced: track.forced,
            }))
          );
          await engine.selectSubtitleTrack(info.selected_subtitle_track_id ?? null);
        } catch {
          // Subtitles are optional; playback carries on without them.
        }
      })
      .catch(() => {
        // A rejected load()/play() already lands in engine.getState().error
        // via VegaPlaybackEngine's own reportFatalError -- this catch
        // exists only so it does not ALSO surface as an unhandled
        // rejection here.
      });
  }, [negotiation, mediaFileId, client, engine, launchOptions, userId, closeSession]);

  // Drives session-lifecycle events off real engine state transitions,
  // rather than off the actions (play()/pause()/seek()) that caused them --
  // this also correctly reports state changes the engine makes on its own
  // (e.g. buffering resolving back to "playing" needs no event; ending
  // naturally does).
  const previousEngineStateRef = useRef(engineState.state);
  useEffect(() => {
    const previous = previousEngineStateRef.current;
    previousEngineStateRef.current = engineState.state;
    const session = sessionRef.current;
    if (!session || session.mediaFileId !== mediaFileId || session.closed) return;

    if (engineState.state === 'ready' && !session.startedEvent) {
      session.startedEvent = true;
      recordEvent({kind: 'start'});
    } else if (engineState.state === 'playing' && previous === 'paused') {
      recordEvent({kind: 'resume', position_ms: latestPlaybackRef.current.positionMs});
    } else if (engineState.state === 'paused' && previous === 'playing') {
      recordEvent({kind: 'pause', position_ms: latestPlaybackRef.current.positionMs});
      flushProgress(false);
    } else if (engineState.state === 'ended') {
      closeSession({kind: 'stop', position_ms: latestPlaybackRef.current.positionMs, reason: 'completed'}, true);
      clearActivePlayerSession();
    } else if (engineState.state === 'error' && engineState.error) {
      closeSession({kind: 'error', message: engineState.error.message}, false);
    }
  }, [engineState.state, engineState.error, mediaFileId, recordEvent, flushProgress, closeSession]);

  // A lightweight heartbeat while genuinely playing -- ten seconds matches
  // tv-web's own `usePlaybackEngine.ts` cadence, frequent enough for a
  // useful resume position without hammering the backend.
  useEffect(() => {
    if (engineState.state !== 'playing') return;
    const interval = setInterval(() => {
      recordEvent({kind: 'heartbeat', position_ms: latestPlaybackRef.current.positionMs});
      flushProgress(false);
    }, 10_000);
    return () => clearInterval(interval);
  }, [engineState.state, recordEvent, flushProgress]);

  // Design doc §6.3's certification requirement: release/pause when the app
  // backgrounds. A full `engine.destroy()` (rather than just pausing) on
  // every background transition is deliberately NOT attempted here -- doing
  // that safely (re-negotiating and reloading the exact same position on
  // return to foreground, without a visible stutter or a lost resume point)
  // is real additional complexity this pass does not take on; pausing
  // already stops active decode/render work, which is the part a Fire TV
  // Stick's constrained resources actually care about moment to moment.
  const wasForegroundRef = useRef(foreground);
  useEffect(() => {
    if (wasForegroundRef.current && !foreground && engineState.state === 'playing') {
      void engine.pause();
      void flushProgress(false);
    }
    wasForegroundRef.current = foreground;
  }, [foreground, engine, engineState.state, flushProgress]);

  const stop = useCallback((): Promise<void> => {
    // Pause first so audio and video stop at once, then close the session and
    // flush progress; the returned promise is the awaited, bounded save.
    const paused = engine.pause().catch(() => undefined);
    const closed = closeSession(
      {kind: 'stop', position_ms: latestPlaybackRef.current.positionMs, reason: 'user_stopped'},
      false
    );
    clearActivePlayerSession();
    setVisible(false);
    setMenu(null);
    // Clearing `mediaFileId` (rather than leaving it set) is what makes a
    // later `show()` call for the SAME title negotiate a genuinely fresh
    // session instead of silently reusing the one `closeSession` just
    // closed: `usePlaybackInfo`'s own `enabled` gate is `Boolean(mediaFileId)`,
    // so `null -> mediaFileId` is a real dependency change even when the id
    // itself is unchanged, which re-runs negotiation and produces a new
    // `session_id` the loading effect above will treat as fresh.
    setMediaFileId(null);
    loadedSessionIdRef.current = null;
    return settleWithin(Promise.all([paused, closed]), 4000);
  }, [engine, closeSession]);

  const show = useCallback((id: string, options?: PlayerLaunchOptions) => {
    setControlsVisible(true);
    setFocusedControl('play');
    setMenu(null);
    setSeekTarget(null);
    setQuality(options?.profile ? {id: options.qualityId ?? 'original', profile: options.profile} : {id: 'original'});
    setMediaFileId(id);
    setLaunchOptions(options ?? {});
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
    setControlsVisible(true);
  }, []);

  const isVisible = useCallback(() => visibleRef.current, []);

  useImperativeHandle(ref, () => ({show, hide, stop, isVisible}), [show, hide, stop, isVisible]);

  // ---- Controls: visibility, key handling, layered Back (docs: PLAYER-SPEC) ----------------------------------------
  const controlsRef = useRef(controlsVisible);
  controlsRef.current = controlsVisible;
  const swallowPress = useRef(false);
  const lastInputAt = useRef(Date.now());
  const qualityPillRef = useRef<View>(null);
  const playRef = useRef<View>(null);
  const keyedSinceOpen = useRef(false);
  const rootRef = useRef<View>(null);
  const subtitlesRef = useRef<View>(null);

  // Hiding the controls must not take focus away from Play: a Back with nothing focused is not delivered to the layer below.
  useEffect(() => {
    if (!visible || controlsVisible) return undefined;
    const timer = setTimeout(() => focusNode(playRef), 60);
    return () => clearTimeout(timer);
  }, [visible, controlsVisible]);

  const reveal = useCallback(() => {
    lastInputAt.current = Date.now();
    setControlsVisible(true);
  }, []);

  // Back unwinds one layer per press: an open menu closes first (its own layer), then the controls hide, then playback exits.
  useBackLayer(visible, () => {
    if (controlsRef.current) {
      // The ref moves now, not at the next render: a second Back right behind the first must find the controls hidden.
      controlsRef.current = false;
      setControlsVisible(false);
      return;
    }
    // The player leaves the route at once; the bounded save of the progress runs behind it.
    const stopped = stop();
    onClose?.();
    void stopped;
  });

  // The parity driver reads whether the quality, audio or subtitles panel (the web's .player-quality-menu) is open.
  useEffect(() => {
    reportQuery('playerMenu', menu === 'quality' || menu === 'subtitles' || menu === 'audio' ? menu : null);
    return () => reportQuery('playerMenu', null);
  }, [menu]);

  // Auto-hide after about five seconds without input while playing; never while paused or with a menu open.
  useEffect(() => {
    if (!visible || !controlsVisible || menu !== null || engineState.state !== 'playing' || seekTarget !== null) return undefined;
    const timer = setInterval(() => {
      if (Date.now() - lastInputAt.current >= 5000) setControlsVisible(false);
    }, 500);
    return () => clearInterval(timer);
  }, [visible, controlsVisible, menu, engineState.state, seekTarget]);

  // The page under the player stays mounted and focusable: put focus on Play once the controls are up (the focus guide traps the D-pad).
  useEffect(() => {
    if (!visible) return undefined;
    // The engine can place focus on another control while the row mounts: retry until Play really holds it.
    nativeControl.current = null;
    keyedSinceOpen.current = false;
    // The engine can also move focus later (the first focusable to mount wins): until the first key, Play takes it back.
    const timer = setInterval(() => {
      if (keyedSinceOpen.current || nativeControl.current === 'play') return;
      focusNode(playRef);
    }, 150);
    const stopTimer = setTimeout(() => clearInterval(timer), 8000);
    return () => {
      clearInterval(timer);
      clearTimeout(stopTimer);
    };
  }, [visible]);

  const togglePlay = useCallback(() => {
    void (engineState.state === 'playing' ? engine.pause() : engine.play());
  }, [engine, engineState.state]);

  // Seeking: each press moves a pending target; the seek itself commits once the viewer settles (rapid presses, one request).
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekStreak = useRef({count: 0, at: 0});
  const stepSeek = useCallback(
    (direction: 1 | -1, fromKey: boolean) => {
      const now = Date.now();
      const streak = seekStreak.current;
      streak.count = now - streak.at < 350 ? streak.count + 1 : 0;
      streak.at = now;
      const step = fromKey ? 10 * Math.min(6, 1 + Math.floor(streak.count / 4)) : 10;
      setSeekTarget((current) => {
        const base = current ?? latestPlaybackRef.current.positionMs / 1000;
        const duration = latestPlaybackRef.current.durationMs / 1000;
        const next = Math.max(0, Math.min(duration > 0 ? duration : Number.MAX_SAFE_INTEGER, base + direction * step));
        if (seekTimer.current) clearTimeout(seekTimer.current);
        seekTimer.current = setTimeout(() => {
          seekTimer.current = null;
          void engine.seek(next);
          setSeekTarget(null);
        }, 450);
        return next;
      });
    },
    [engine],
  );
  useEffect(
    () => () => {
      if (seekTimer.current) clearTimeout(seekTimer.current);
    },
    [],
  );

  useRemoteKey((key) => {
    if (!visible) return;
    keyedSinceOpen.current = true;
    // The dedicated Play/Pause key always toggles playback and shows the controls.
    if (key === 'playPause') {
      reveal();
      togglePlay();
      return;
    }
    if (key === 'skipForward' || key === 'skipBackward') {
      reveal();
      stepSeek(key === 'skipForward' ? 1 : -1, true);
      return;
    }
    if (key === 'back' || key === 'menu') return;
    // The first input with the controls hidden only reveals them: it must not pause, seek or activate anything.
    if (!controlsRef.current) {
      // The native focus engine still walks on this key although the controls are hidden; the web keeps focus where it was.
      const held = nativeControl.current;
      if (held === 'play' || held === null) setTimeout(() => focusNode(playRef), 60);
      swallowPress.current = true;
      setTimeout(() => {
        swallowPress.current = false;
      }, 400);
      reveal();
      return;
    }
    reveal();
    // The web's Down from the seek bar focuses Play (the row's first control), not the nearest view below.
    if (focusedControl === 'scrubber' && menu === null && key === 'down') setTimeout(() => focusNode(playRef), 40);
    if (focusedControl === 'scrubber' && menu === null && (key === 'left' || key === 'right')) stepSeek(key === 'right' ? 1 : -1, true);
    if (focusedControl === 'volume' && menu === null && (key === 'left' || key === 'right')) stepVolume(key === 'right' ? 1 : -1);
  });

  const guarded = useCallback((action: () => void) => () => {
    if (swallowPress.current) {
      swallowPress.current = false;
      return;
    }
    action();
  }, []);

  const closeMenu = useCallback(() => {
    const opener = menu;
    setMenu(null);
    // Focus returns to the control that opened the menu.
    setTimeout(() => focusNode(opener === 'quality' ? qualityPillRef : opener === 'subtitles' ? subtitlesRef : playRef), 50);
  }, [menu]);

  const selectQuality = useCallback(
    (option: PlaybackQualityOption) => {
      setMenu(null);
      if (option.id === quality.id) return;
      // A new quality is a new negotiation: the player reloads at the position it was at.
      setLaunchOptions((current) => ({...current, startPositionSeconds: latestPlaybackRef.current.positionMs / 1000}));
      setQuality({id: option.id, profile: option.profile ?? undefined});
      setTimeout(() => focusNode(qualityPillRef), 50);
    },
    [quality.id],
  );

  // The queue: previous and next play the neighbours of the current file; a single title has neither.
  const queue = launchOptions.queue ?? [];
  const queueIndex = mediaFileId ? queue.findIndex((entry) => entry.mediaFileId === mediaFileId) : -1;
  const hasPrev = queueIndex > 0;
  const hasNext = queueIndex >= 0 && queueIndex < queue.length - 1;
  const playQueueItem = useCallback(
    (index: number) => {
      const entry = queue[index];
      if (!entry) return;
      show(entry.mediaFileId, {queue, title: entry.title});
    },
    [queue, show],
  );
  // As the web does for HLS: the audio list is the one the server negotiated (source tracks plus any dub), labelled the web's way.
  const sourceAudio = negotiation.status === 'ready' ? negotiation.data.audio_tracks : [];
  const audioTracks: {id: string; label: string; language?: string | null}[] =
    sourceAudio.length > 0
      ? sourceAudio.map((track) => ({id: track.id, label: audioTrackLabel({label: track.label, language: track.language, codec: track.codec_label?.trim() || audioCodecName(track.codec), channels: track.channels}), language: track.language}))
      : engineState.audioTracks;
  const selectedAudioId = sourceAudio.length > 0 ? (negotiation.status === 'ready' ? negotiation.data.selected_audio_track_id : null) ?? sourceAudio[0].id : engineState.selectedAudioTrackId;
  const audioLabel = audioTracks.length > 0 ? audioTracks.find((track) => track.id === selectedAudioId)?.label ?? audioTracks[0].label : null;
  const stepVolume = useCallback(
    (direction: 1 | -1) => {
      engine.setMuted(false);
      engine.setVolume(Math.round((engineState.volume + direction * 0.05) * 100) / 100);
    },
    [engine, engineState.volume],
  );

  const qualityOptions = negotiation.status === 'ready' ? negotiation.data.quality_options : [];
  const selectedQualityId = negotiation.status === 'ready' ? negotiation.data.selected_quality_id : quality.id;
  const qualityLabel =
    selectedQualityId === 'original' ? originalLabel(qualityOptions.find((option) => option.id === 'original')) : qualityOptions.find((option) => option.id === selectedQualityId)?.label ?? 'Original';

  if (!visible) return null;

  const videoPlayer = engine.getVideoPlayer();
  const isBuffering = engineState.state === 'loading' || engineState.state === 'buffering';
  const negotiationFailed = negotiation.status === 'error';
  const hasFatalError = engineState.state === 'error' && Boolean(engineState.error?.fatal);

  return (
    <View ref={rootRef} style={styles.root}>
      {videoPlayer ? <VegaVideoSurface videoPlayer={videoPlayer} style={styles.surface} mediaControlFocus={false} /> : null}

      {showSpinner({
        negotiation: negotiation.status,
        buffering: isBuffering,
        failed: negotiationFailed || hasFatalError,
      }) ? (
        <View style={styles.centeredOverlay}>
          <ActivityIndicator color={colour.focusRing} size="large" />
        </View>
      ) : null}

      {negotiationFailed || hasFatalError ? (
        <View style={styles.centeredOverlay}>
          <Text style={styles.errorTitle}>This title cannot be played as it is</Text>
          <Text style={styles.errorMessage}>
            {negotiationFailed
              ? negotiationErrorText(negotiation.status === 'error' ? negotiation.message : '')
              : 'This device cannot decode it (often its audio format). Choose a quality below to have the server convert it.'}
          </Text>
          <View style={{flexDirection: 'row'}}>
            {qualityOptions.length > 1 ? (
              <Pressable accessibilityRole="button" style={[styles.backButton, {marginRight: sw(16)}]} onPress={() => setMenu('quality')} hasTVPreferredFocus>
                <Text style={styles.backButtonLabel}>Choose quality</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" style={styles.backButton} onPress={() => void stop().then(() => onClose?.())} hasTVPreferredFocus={qualityOptions.length <= 1}>
              <Text style={styles.backButtonLabel}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']} style={StyleSheet.absoluteFill}>
        <DarkSurface>
        <PlayerChrome
          visible={controlsVisible}
          playing={engineState.state === 'playing'}
          positionSeconds={engineState.currentTimeSeconds}
          durationSeconds={engineState.durationSeconds}
          bufferedSeconds={engineState.bufferedSeconds}
          seekTargetSeconds={seekTarget}
          qualityLabel={qualityLabel}
          hasSubtitles={engineState.subtitleTracks.length > 0}
          subtitlesOn={engineState.selectedSubtitleTrackId !== null}
          focused={focusedControl}
          onFocusControl={(control) => {
            nativeControl.current = control;
            setFocusedControl(control);
            reveal();
          }}
          onTogglePlay={guarded(togglePlay)}
          onClose={guarded(() => void stop().then(() => onClose?.()))}
          onOpenQuality={guarded(() => setMenu('quality'))}
          onOpenSubtitles={guarded(() => setMenu('subtitles'))}
          volume={engineState.volume}
          muted={engineState.muted}
          hasPrev={hasPrev}
          hasNext={hasNext}
          onPrev={guarded(() => playQueueItem(queueIndex - 1))}
          onNext={guarded(() => playQueueItem(queueIndex + 1))}
          onToggleMute={guarded(() => engine.setMuted(!engineState.muted))}
          audioLabel={audioLabel}
          onOpenAudio={guarded(() => setMenu('audio'))}
          queueCount={Math.max(1, queue.length)}
          onOpenPlaylist={guarded(() => setMenu('playlist'))}
          onOpenInfo={guarded(() => setMenu('info'))}
          onOpenCast={guarded(() => setMenu('cast'))}
          onToggleFullscreen={guarded(() => setControlsVisible(false))}
          qualityRef={qualityPillRef}
          playRef={playRef}
          subtitlesRef={subtitlesRef}
        />
        </DarkSurface>
      </TvFocusScope>

      {menu === 'quality' ? <QualityMenu options={qualityOptions} selectedId={selectedQualityId} onSelect={selectQuality} onClose={closeMenu} /> : null}
      {menu === 'subtitles' ? (
        <Sheet title="Subtitles" onClose={closeMenu}>
          <SheetOption
            label="Off"
            selected={engineState.selectedSubtitleTrackId === null}
            hasTVPreferredFocus={engineState.selectedSubtitleTrackId === null}
            onPress={() => {
              void engine.selectSubtitleTrack(null);
              closeMenu();
            }}
          />
          {engineState.subtitleTracks.map((track) => (
            <SheetOption
              key={track.id}
              label={track.label}
              detail={track.language}
              selected={engineState.selectedSubtitleTrackId === track.id}
              hasTVPreferredFocus={engineState.selectedSubtitleTrackId === track.id}
              onPress={() => {
                void engine.selectSubtitleTrack(track.id);
                closeMenu();
              }}
            />
          ))}
        </Sheet>
      ) : null}
      {menu === 'audio' ? (
        <Sheet title="Audio" onClose={closeMenu}>
          {audioTracks.map((track) => (
            <SheetOption
              key={track.id}
              label={track.label}
              detail={track.language ?? undefined}
              selected={selectedAudioId === track.id}
              hasTVPreferredFocus={selectedAudioId === track.id}
              onPress={() => {
                if (engineState.audioTracks.some((candidate) => candidate.id === track.id)) void engine.selectAudioTrack(track.id);
                closeMenu();
              }}
            />
          ))}
        </Sheet>
      ) : null}
      {menu === 'playlist' ? (
        <Sheet title="Playlist" onClose={closeMenu}>
          {(queue.length > 0 ? queue : [{mediaFileId: mediaFileId ?? '', title: launchOptions.title ?? 'Now playing'}]).map((entry, index) => (
            <SheetOption
              key={`${entry.mediaFileId}-${index}`}
              label={entry.title}
              selected={index === Math.max(0, queueIndex)}
              hasTVPreferredFocus={index === Math.max(0, queueIndex)}
              onPress={() => {
                setMenu(null);
                if (index !== queueIndex && queue.length > 0) playQueueItem(index);
              }}
            />
          ))}
        </Sheet>
      ) : null}
      {menu === 'info' ? (
        <Sheet title="Info and playback health" onClose={closeMenu}>
          <SheetOption label={`State: ${engineState.state}`} onPress={closeMenu} hasTVPreferredFocus />
          <SheetOption label={`Position: ${formatClock(engineState.currentTimeSeconds)} of ${formatClock(engineState.durationSeconds)}`} onPress={closeMenu} />
          <SheetOption label={`Buffered to: ${formatClock(engineState.bufferedSeconds)}`} onPress={closeMenu} />
          <SheetOption label={`Quality: ${qualityLabel}`} onPress={closeMenu} />
          <SheetOption label={`Volume: ${engineState.muted ? 'muted' : `${Math.round(engineState.volume * 100)}%`}`} onPress={closeMenu} />
        </Sheet>
      ) : null}
      {menu === 'cast' ? (
        <Sheet title="Play on another device" onClose={closeMenu}>
          <SheetOption label="No other devices are paired with this one" onPress={closeMenu} hasTVPreferredFocus />
        </Sheet>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // The web's player page is black behind the video.
    backgroundColor: '#000000',
  },
  surface: {
    ...StyleSheet.absoluteFillObject,
  },
  centeredOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: sw(80),
  },
  errorTitle: {
    color: colour.ink,
    fontSize: sh(28),
    fontWeight: '700',
    marginBottom: sh(8),
  },
  errorMessage: {
    color: colour.inkSoft,
    fontSize: sh(18),
    textAlign: 'center',
    marginBottom: sh(24),
  },
  backButton: {
    paddingVertical: sh(10),
    paddingHorizontal: sw(24),
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
  },
  backButtonLabel: {
    color: colour.ink,
  },
  transportBarHidden: {
    opacity: 0,
  },
  transportBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: sw(56),
    paddingVertical: sh(28),
    backgroundColor: 'rgba(21, 19, 21, 0.72)',
  },
  title: {
    color: colour.ink,
    fontSize: sh(20),
    fontWeight: '600',
    marginBottom: sh(12),
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  transportButton: {
    paddingVertical: sh(10),
    paddingHorizontal: sw(18),
    borderRadius: 8,
    backgroundColor: colour.surfaceStrong,
    marginRight: sw(12),
  },
  transportButtonLabel: {
    color: colour.ink,
  },
  clock: {
    color: colour.inkSoft,
    marginLeft: 'auto',
  },
});
