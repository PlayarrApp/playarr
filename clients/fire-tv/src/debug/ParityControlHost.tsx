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
import {currentQuery, installParityControl, PARITY_CONTROL, setPendingQuery} from './parityControl';

/** The slice of the navigation container ref this host uses (the typed ref's route-name union is narrower than the strings it is given). */
export interface NavRefLike {
  isReady(): boolean;
  getCurrentRoute(): {name: string; params?: object} | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  navigate(...args: any[]): void;
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
  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;
  const setPreferenceRef = useRef(setPreference);
  setPreferenceRef.current = setPreference;

  useEffect(() => {
    if (!PARITY_CONTROL) return undefined;
    const engine = getSharedVegaPlaybackEngine();
    return installParityControl({
      location: () => {
        if (playerRef.current?.isVisible()) return `/player/${lastPlayed}`;
        const route = navRef.isReady() ? navRef.getCurrentRoute() : undefined;
        if (!route) return null;
        if (route.name === ROUTES.profiles) return '/profiles';
        if (route.name === ROUTES.workDetail) {
          const params = route.params as {workId?: string; kind?: string} | undefined;
          return `/${params?.kind === 'series' ? 'series' : 'movies'}/${params?.workId ?? ''}`;
        }
        if (route.name.startsWith('Settings')) return '/settings';
        const web = ROUTE_TO_WEB[route.name] ?? `/${route.name.toLowerCase()}`;
        return web + currentQuery(web === '/calendar' ? ['view'] : web === '/movies' || web === '/series' || web === '/music' ? ['panel'] : []);
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
      open: (kind, id) => navRef.navigate(APP_SHELL_ROUTE, {screen: ROUTES.workDetail, params: {workId: id, kind}}),
      play: (file) => {
        lastPlayed = file;
        playerRef.current?.show(file);
      },
      stop: () => void playerRef.current?.stop(),
      setTheme: (name) => setPreferenceRef.current(name),
      player: () => {
        const state = engine.getState();
        return {state: state.state, positionSeconds: state.currentTimeSeconds, durationSeconds: state.durationSeconds, error: state.error?.message};
      },
      theme: () => schemeRef.current,
    });
  }, [navRef, playerRef]);

  // While the player is up the app logs heavily and the device log drops lines, so a one-off answer can go missing: repeat
  // the player's state every 2 s then, stamped with the device clock, for the driver to take the latest one.
  useEffect(() => {
    if (!PARITY_CONTROL) return undefined;
    const engine = getSharedVegaPlaybackEngine();
    const timer = setInterval(() => {
      if (!playerRef.current?.isVisible()) return;
      const state = engine.getState();
      console.log('PARITY ' + JSON.stringify({cmd: 'tick', t: Date.now(), route: `/player/${lastPlayed}`, player: {state: state.state, positionSeconds: state.currentTimeSeconds, durationSeconds: state.durationSeconds, error: state.error?.message}}));
    }, 2000);
    return () => clearInterval(timer);
  }, [playerRef]);

  return null;
}

let lastPlayed = '';
