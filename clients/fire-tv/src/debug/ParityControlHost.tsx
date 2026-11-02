/**
 * Mounts the parity control channel (see parityControl.ts) inside the theme and navigation providers, where it can reach the
 * navigator, the player and the theme preference. Renders nothing; absent from a normal build.
 */
import React, {useEffect, useRef} from 'react';
import {APP_SHELL_ROUTE} from '../navigation/AppShellNavigator';
import {ROUTES} from '../navigation/routes';
import {getSharedVegaPlaybackEngine} from '../platform/media/VegaPlaybackEngine';
import type {PlayerScreenHandle} from '../screens/PlayerScreen';
import {useTheme} from '../theme/ThemeProvider';
import {exportLayout, LayoutProbe, setCover} from './layoutExport';
import {currentFocus, currentQuery, installParityControl, PARITY_CONTROL, setPendingQuery} from './parityControl';

/** The slice of the navigation container ref this host uses (the typed ref's route-name union is narrower than the strings it is given). */
export interface NavRefLike {
  isReady(): boolean;
  getCurrentRoute(): {name: string; params?: object} | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigate(...args: any[]): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resetRoot(state: any): void;
}

const WEB_TO_ROUTE: Record<string, string> = {
  '/': ROUTES.home,
  '/home': ROUTES.home,
  '/search': ROUTES.search,
  '/series': ROUTES.series,
  '/movies': ROUTES.movies,
  '/music': ROUTES.music,
  '/playlists': ROUTES.playlists,
  '/downloads': ROUTES.downloads,
  '/watchlist': ROUTES.watchlist,
  '/requests': ROUTES.requests,
  '/calendar': ROUTES.calendar,
  '/settings': ROUTES.settings,
};

const ROUTE_TO_WEB: Record<string, string> = Object.fromEntries(Object.entries(WEB_TO_ROUTE).filter(([path]) => path !== '/home').map(([path, name]) => [name, path]));

export function ParityControlHost({navRef, playerRef}: {navRef: NavRefLike; playerRef: React.RefObject<PlayerScreenHandle>}): React.ReactElement | null {
  const {scheme, setPreference} = useTheme();
  const probeRef = useRef<LayoutProbe>(null);
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const setPreferenceRef = useRef(setPreference);
  setPreferenceRef.current = setPreference;

  useEffect(() => {
    if (!PARITY_CONTROL) return undefined;
    const engine = getSharedVegaPlaybackEngine();
    return installParityControl({
      location: () => {
        if (playerRef.current?.isVisible()) return `/player/${lastPlayed || 'current'}`;
        const route = navRef.isReady() ? navRef.getCurrentRoute() : undefined;
        if (!route) return null;
        if (route.name === ROUTES.profiles) return '/profiles';
        if (route.name === ROUTES.workDetail) {
          const params = route.params as {workId?: string; kind?: string} | undefined;
          return `/${params?.kind === 'series' ? 'series' : 'movies'}/${params?.workId ?? ''}`;
        }
        if (route.name.startsWith('Settings')) return '/settings';
        const web = ROUTE_TO_WEB[route.name] ?? `/${route.name.toLowerCase()}`;
        return web + currentQuery(web === '/calendar' ? ['view', 'panel'] : web === '/movies' || web === '/series' || web === '/music' ? ['panel'] : []);
      },
      route: (path) => {
        const base = path.split('?')[0] ?? '/';
        if (base === '/profiles') navRef.navigate(ROUTES.profiles);
        else if (WEB_TO_ROUTE[base]) {
          // A screen that is already up keeps its state, so leave through Home first and let the target mount with the query.
          navRef.navigate(APP_SHELL_ROUTE, {screen: ROUTES.home});
          setTimeout(() => {
            setPendingQuery(path);
            navRef.navigate(APP_SHELL_ROUTE, {screen: WEB_TO_ROUTE[base]});
          }, 800);
        }
        else throw new Error(`no route for ${path}`);
      },
      // The web opens a title by URL: nothing is behind it, so Back goes to its library page (the policy's parent). Reset the
      // stack to the detail page alone, so Back sees no previous entry either.
      open: (kind, id) =>
        navRef.resetRoot({
          index: 0,
          routes: [{name: APP_SHELL_ROUTE, state: {index: 0, routes: [{name: ROUTES.workDetail, params: {workId: id, kind, backTo: kind === 'series' ? ROUTES.series : ROUTES.movies}}]}}],
        }),
      play: (file) => {
        lastPlayed = file;
        playerRef.current?.show(file);
      },
      stop: () => void playerRef.current?.stop(),
      armPause: (ms, atMs) => {
        armedPause = ms;
        armedPauseAt = atMs ?? null;
      },
      setTheme: (name) => setPreferenceRef.current(name),
      player: () => {
        const state = engine.getState();
        return {state: state.state, positionSeconds: state.currentTimeSeconds, durationSeconds: state.durationSeconds, bufferedSeconds: state.bufferedSeconds, error: state.error?.message};
      },
      theme: () => schemeRef.current,
      cover: setCover,
      layout: async (debug) => {
        const elements = probeRef.current ? await exportLayout(probeRef.current, schemeRef.current === 'dark' ? '#151315' : '#f5f3f2', debug) : [];
        return JSON.stringify(elements);
      },
    });
  }, [navRef, playerRef]);

  // While the player is up the app logs heavily and the device log drops lines, so a one-off answer can go missing: repeat
  // the player's state every 2 s then, stamped with the device clock, for the driver to take the latest one.
  useEffect(() => {
    if (!PARITY_CONTROL) return undefined;
    const engine = getSharedVegaPlaybackEngine();
    // Pause on the app's own clock: a host-side poll would overshoot by the length of a slow log round trip.
    const pauser = setInterval(() => {
      if (armedPause === null) return;
      const state = engine.getState();
      if (state.state === 'playing' && state.currentTimeSeconds * 1000 >= armedPause) {
        armedPause = null;
        // Paused on the player's own reported position (no seek: a seek while paused leaves the video plane black on Vega).
        // The pause lands a variable few frames after the armed position, and the controls draw that position (label, bar fill):
        // put it on the requested one so every run shows the same controls. The video frame under the controls is a listed
        // exclusion (the video plane), so it may differ.
        const at = armedPauseAt;
        // Seek first, pause straight after: the player then decodes the target frame and holds it (a seek while already paused
        // leaves the video plane on the old frame).
        void (at === null ? Promise.resolve() : engine.seek(at / 1000)).then(() => engine.pause());
      }
    }, 10);
    const timer = setInterval(() => {
      if (!playerRef.current?.isVisible()) return;
      const state = engine.getState();
      console.log('PARITY ' + JSON.stringify({cmd: 'tick', t: Date.now(), route: `/player/${lastPlayed}`, focus: currentFocus(), player: {state: state.state, positionSeconds: state.currentTimeSeconds, durationSeconds: state.durationSeconds, bufferedSeconds: state.bufferedSeconds, error: state.error?.message}}));
    }, 2000);
    return () => {
      clearInterval(timer);
      clearInterval(pauser);
    };
  }, [playerRef]);

  return <LayoutProbe ref={probeRef} />;
}

let lastPlayed = '';
/** A position (ms) at which the player pauses itself, set by cmd=armPause. */
let armedPause: number | null = null;
/** The position (ms) to put the paused player on, set by cmd=armPause&at. */
let armedPauseAt: number | null = null;
