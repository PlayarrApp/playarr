import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text} from 'react-native';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {LanguageProvider} from '../i18n/LanguageProvider';
import {ROUTES} from '../navigation/routes';
import {TrackStack} from '../tv/TrackStack';
import {PlaylistsScreen, type PlaylistsScreenNavigation} from './PlaylistsScreen';

jest.mock('../platform/focus', () => {
  const ReactValue = require('react') as typeof React;
  return {TvFocusScope: ({children}: {children: React.ReactNode}) => ReactValue.createElement(ReactValue.Fragment, null, children), focusNode: jest.fn(), useDefaultFocus: jest.fn()};
});
jest.mock('../navigation/backPolicy', () => ({useTvBackNavigation: jest.fn()}));
(globalThis as unknown as {React: typeof React}).React = React;

const playlists = [
  {id: 'playlist-root', name: 'Neutral Root', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', media_type: 'video', is_system: false},
  {id: 'playlist-child', name: 'Neutral Child', parent_playlist_id: 'playlist-root', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', media_type: 'video', is_system: false},
];
const neutralWork = {id: 'work-neutral', title: 'Neutral Work', kind: 'movie', availability: 'available', added_at: '2026-01-01T00:00:00Z', external_refs: [], genres: [], images: [], monitored: true, overview: null, sort_title: 'Neutral Work', tags: []};
const mounted: ReactTestRenderer[] = [];

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {status: 200, headers: {'Content-Type': 'application/json'}});
}

function mockPlaylistFetch(): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/api/v1/playlists')) return jsonResponse(playlists);
    if (url.includes('/api/v1/playlists/playlist-child/items')) return jsonResponse([{id: 'item-neutral', playlist_id: 'playlist-child', position: 0, work_id: 'work-neutral', added_at: '2026-01-01T00:00:00Z'}]);
    if (url.includes('/api/v1/catalog/work-neutral')) return jsonResponse({work: neutralWork, runtime_ms: null});
    return jsonResponse([]);
  });
}

function navigation(): PlaylistsScreenNavigation & {navigate: jest.Mock} {
  return {navigate: jest.fn()};
}

function renderScreen(params: {playlistId?: string; trackId?: string; backTo?: typeof ROUTES.search} | undefined, nav = navigation()) {
  const renderer = create(<ApiClientProvider><LanguageProvider><PlaylistsScreen route={{params}} navigation={nav} /></LanguageProvider></ApiClientProvider>);
  mounted.push(renderer);
  return {renderer, nav};
}

describe('PlaylistsScreen route params from Search', () => {
  afterEach(() => {
    act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
    jest.restoreAllMocks();
  });

  it('opens the selected child playlist and preserves its root and child IDs when opening a track', async () => {
    mockPlaylistFetch();
    let renderer!: ReturnType<typeof renderScreen>['renderer'];
    const nav = navigation();
    await act(async () => {
      ({renderer} = renderScreen({playlistId: 'playlist-root', trackId: 'playlist-child', backTo: ROUTES.search}, nav));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renderer.root.findAllByType(Text).some((node) => node.props.children === 'Neutral Root')).toBe(true);
    expect(renderer.root.findByType(TrackStack).props.tracks.map((track: {id: string}) => track.id)).toEqual(['playlist-root', 'playlist-child']);
    expect(renderer.root.findByType(TrackStack).props.initial).toEqual({track: 1, item: 0});

    const track = renderer.root.findAllByType(Pressable).find((node) => node.props.accessibilityLabel === 'Neutral Work');
    expect(track).toBeDefined();
    act(() => track!.props.onPress());
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.workDetail, {
      workId: 'work-neutral',
      backTo: ROUTES.playlists,
      backParams: {playlistId: 'playlist-root', trackId: 'playlist-child', backTo: ROUTES.search},
    });

    // Re-enter the playlist route using the detail's back target and params; its header must still return to Search.
    const playlistReturn = renderScreen({playlistId: 'playlist-root', trackId: 'playlist-child', backTo: ROUTES.search}, nav);
    const back = playlistReturn.renderer.root.findByProps({accessibilityLabel: 'Back'});
    act(() => back.props.onPress());
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.search, undefined);
  });

  it('fails closed for an unknown playlist ID instead of showing the full collection', async () => {
    const fetchMock = mockPlaylistFetch();
    let renderer!: ReturnType<typeof renderScreen>['renderer'];
    await act(async () => {
      ({renderer} = renderScreen({playlistId: 'missing-playlist', backTo: ROUTES.search}));
      await Promise.resolve();
    });

    expect(renderer.root.findAllByType(Text).some((node) => node.props.children === 'Neutral Root')).toBe(false);
    expect(renderer.root.findAllByType(Text).some((node) => node.props.children === 'Neutral Child')).toBe(false);
    expect(fetchMock.mock.calls.map(([input]) => String(input instanceof Request ? input.url : input)).filter((url) => url.includes('/items'))).toHaveLength(0);
    const back = renderer.root.findByProps({accessibilityLabel: 'Back'});
    expect(() => act(() => back.props.onPress())).not.toThrow();
  });
});
