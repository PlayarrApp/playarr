/**
 * Same integration posture as `LibraryScreen.test.tsx`: real
 * `<ApiClientProvider>` + `useAsyncData`, only `global.fetch` mocked. Uses
 * fake timers to control the debounce window explicitly rather than
 * `waitFor`-polling real time, since `DEBOUNCE_MS` is an internal
 * implementation detail this test should not need to know the exact value
 * of just to pass reliably.
 */
import React from 'react';
import {act, create, type ReactTestRenderer} from 'react-test-renderer';
import {Pressable, Text, TextInput} from 'react-native';
import type {Work, WorkKind} from '@playarr-tv/api-client';
import {BalancedT} from '../tv/kit';
import {ApiClientProvider} from '../api/ApiClientProvider';
import {LanguageProvider} from '../i18n/LanguageProvider';
import {SearchScreen, type SearchScreenNavigation} from './SearchScreen';
import {ROUTES} from '../navigation/routes';
import {searchPlaylistTarget} from '../lib/searchModel';
import {CatalogKindsContext} from '../lib/catalogKindsContext';
import {reportFocus} from '../debug/parityControl';
import {focusNode, useDefaultFocus} from '../platform/focus';

jest.mock('../platform/focus', () => {
  const ReactValue = require('react') as typeof React;
  return {
    TvFocusScope: ({children}: {children: React.ReactNode}) => ReactValue.createElement(ReactValue.Fragment, null, children),
    focusNode: jest.fn(),
    useDefaultFocus: jest.fn(),
  };
});
jest.mock('../debug/parityControl', () => ({reportFocus: jest.fn(), clearFocus: jest.fn()}));

// See LibraryScreen.test.tsx's own comment for exactly why this is needed:
// ApiClientProvider.tsx (a concurrent Foundation-stage file, out of this
// task's scope to fix) renders JSX without importing React as a value.
(globalThis as unknown as {React: typeof React}).React = React;

const ALL_CATALOG_KINDS = new Set<WorkKind>(['movie', 'series', 'site', 'artist']);

function TestSearchScreen({navigation, kinds = ALL_CATALOG_KINDS}: {navigation: SearchScreenNavigation; kinds?: ReadonlySet<WorkKind> | null}): React.ReactElement {
  return <CatalogKindsContext.Provider value={kinds}><SearchScreen navigation={navigation} /></CatalogKindsContext.Provider>;
}

function work(overrides: Partial<Work> & Pick<Work, 'id' | 'title'>): Work {
  return {
    added_at: '2026-01-01T00:00:00Z',
    availability: 'available',
    external_refs: [],
    genres: [],
    images: [],
    kind: 'movie',
    monitored: true,
    overview: null,
    sort_title: overrides.title,
    tags: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

function mockSearchFetch(respond: () => Response | Promise<Response>, options: {playlists?: unknown; discovery?: unknown} = {}): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/api/v1/catalog/search')) return respond();
    if (url.includes('/api/v1/playlists')) return jsonResponse(options.playlists ?? []);
    if (url.includes('/api/v1/discover')) return jsonResponse(options.discovery ?? {titles: [], providers: []});
    return jsonResponse([]);
  });
}

function searchCalls(fetchMock: jest.SpyInstance): number {
  return fetchMock.mock.calls.filter(([input]) => String(input instanceof Request ? input.url : input).includes('/search')).length;
}

function callsFor(fetchMock: jest.SpyInstance, path: string): string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input instanceof Request ? input.url : input))
    .filter((url) => url.includes(path));
}

function chooseType(renderer: ReactTestRenderer, label: string): void {
  const filters = renderer.root.findByProps({accessibilityLabel: 'Filters'});
  act(() => filters.props.onFocus?.({}));
  act(() => filters.props.onPress());
  act(() => renderer.root.findByProps({accessibilityLabel: label}).props.onPress());
}

function fakeNavigation(): SearchScreenNavigation & {navigate: jest.Mock} {
  return {navigate: jest.fn()};
}

function allText(renderer: ReactTestRenderer): string {
  return renderer
    .root.findAllByType(Text)
    .map((node) => {
      const children = node.props.children;
      const fragments = Array.isArray(children) ? children : [children];
      return fragments.filter((value) => typeof value === 'string').join('');
    })
    .join(' | ');
}

describe('SearchScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows the idle prompt before anything is typed', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <TestSearchScreen navigation={fakeNavigation()} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    expect(allText(renderer)).toContain('Start typing to search.');
  });

  it('offers the seven web Search type filters and omits the removed Library option', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    chooseType(renderer, 'Movies');
    // Selection closes the drawer; reopening exposes the full option set with Movies selected.
    const filters = renderer.root.findByProps({accessibilityLabel: 'Filters'});
    act(() => filters.props.onFocus?.({}));
    act(() => filters.props.onPress());
    const options = renderer.root.findAllByType(Pressable).filter((node) => ['All', 'Movies', 'Series', 'Sites', 'Music', 'Playlists', 'Games', 'Library'].includes(node.props.accessibilityLabel));
    expect(options.map((node) => node.props.accessibilityLabel)).toEqual(['All', 'Movies', 'Series', 'Sites', 'Music', 'Playlists', 'Games']);
    expect(options[1]?.props.accessibilityState?.selected).toBe(true);
  });

  it('shows only server-advertised work kinds and keeps Filters focus restoration', async () => {
    let renderer!: ReactTestRenderer;
    const kinds = new Set<WorkKind>(['movie', 'series', 'artist']);
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <TestSearchScreen navigation={fakeNavigation()} kinds={kinds} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    const target = ((useDefaultFocus as jest.Mock).mock.calls as Array<[object, boolean?]>).find(([, active]) => active)?.[0];
    const filters = renderer.root.findByProps({accessibilityLabel: 'Filters'});
    act(() => filters.props.onPress());
    const labels = renderer.root.findAllByType(Pressable)
      .map((node) => node.props.accessibilityLabel)
      .filter((label) => ['All', 'Movies', 'Series', 'Sites', 'Music', 'Playlists', 'Games'].includes(label));

    expect(labels).toEqual(['All', 'Movies', 'Series', 'Music', 'Playlists', 'Games']);
    act(() => renderer.root.findByProps({accessibilityLabel: 'Close'}).props.onPress());
    expect(focusNode).toHaveBeenCalledWith(target);
    act(() => renderer.unmount());
  });

  it('reports the page-scoped Filters identity when focused', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    const filters = renderer.root.findByProps({accessibilityLabel: 'Filters'});
    act(() => filters.props.onFocus?.({}));
    expect(reportFocus).toHaveBeenLastCalledWith('search filters');
  });

  it('registers the Search Filters tile as its default native focus target', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    expect(useDefaultFocus).toHaveBeenCalledWith(expect.any(Object), true);
    act(() => renderer.unmount());
  });

  it('restores native focus to the Filters opener as soon as the drawer closes', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });
    const target = ((useDefaultFocus as jest.Mock).mock.calls as Array<[object, boolean?]>).find(([, active]) => active)?.[0];
    expect(target).toBeDefined();

    act(() => renderer.root.findByProps({accessibilityLabel: 'Filters'}).props.onPress());
    act(() => renderer.root.findByProps({accessibilityLabel: 'Close'}).props.onPress());

    expect(focusNode).toHaveBeenCalledWith(target);
    act(() => renderer.unmount());
  });

  it('reports the canonical Search type identity when a filter chip receives focus', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    const filters = renderer.root.findByProps({accessibilityLabel: 'Filters'});
    act(() => filters.props.onPress());
    const movieFilter = renderer.root.findByProps({accessibilityLabel: 'Movies'});
    act(() => movieFilter.props.onFocus?.({}));

    expect(reportFocus).toHaveBeenLastCalledWith('search filter movie', undefined, expect.any(Object));
    expect(movieFilter.props.onPress).toBeDefined();
  });

  it('opens the Filters drawer on activation without a prior focus callback', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    const filters = renderer.root.findByProps({accessibilityLabel: 'Filters'});
    act(() => filters.props.onPress());
    expect(renderer.root.findByProps({accessibilityLabel: 'All'})).toBeTruthy();
  });

  it('reports the stable Search input identity when focused', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onFocus?.({}));
    expect(reportFocus).toHaveBeenLastCalledWith('search input');
  });

  it('debounces keystrokes into a single search request', async () => {
    const fetchMock = mockSearchFetch(() => jsonResponse({items: [work({id: 'w1', title: 'Test Movie A'})]}));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <TestSearchScreen navigation={fakeNavigation()} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    const input = renderer.root.findByType(TextInput);
    act(() => {
      input.props.onChangeText('d');
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    act(() => {
      input.props.onChangeText('du');
    });
    act(() => {
      jest.advanceTimersByTime(100);
    });
    act(() => {
      input.props.onChangeText('dune');
    });

    // No request yet -- every keystroke above reset the debounce timer.
    expect(searchCalls(fetchMock)).toBe(0);

    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(searchCalls(fetchMock)).toBe(1);
    expect(allText(renderer)).toContain('Test Movie A');
    const layeredButtons = renderer.root.findAllByType(Pressable)
      .filter((node) => ['Test Movie A', 'Filters'].includes(node.props.accessibilityLabel))
      .map((node) => node.props.accessibilityLabel);
    expect(layeredButtons).toEqual(['Test Movie A', 'Filters']);
  });

  it('shows the empty state for a query with no matches', async () => {
    mockSearchFetch(() => jsonResponse({items: []}));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <TestSearchScreen navigation={fakeNavigation()} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('nonexistent'));
    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(allText(renderer)).toContain('No matching titles or playlists.');
  });

  it('opens a search result on the correct detail screen by kind', async () => {
    mockSearchFetch(() => jsonResponse({items: [work({id: 'a1', title: 'A Band', kind: 'artist'})]}));
    const navigation = fakeNavigation();

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <ApiClientProvider>
          <LanguageProvider>
            <SearchScreen navigation={navigation} />
          </LanguageProvider>
        </ApiClientProvider>
      );
    });

    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('band'));
    await act(async () => {
      jest.advanceTimersByTime(400);
      await Promise.resolve();
    });

    act(() => {
      renderer.root.findByProps({accessibilityLabel: 'A Band'}).props.onPress();
    });

    expect(navigation.navigate).toHaveBeenCalledWith(ROUTES.musicDetail, {workId: 'a1', backTo: ROUTES.search});
  });

  it('filters catalog results by type and requests available-only works plus matching media discovery', async () => {
    const fetchMock = mockSearchFetch(() => jsonResponse({items: [
      work({id: 'w1', title: 'Neutral Movie A'}),
      work({id: 'w2', title: 'Neutral Movie B'}),
      work({id: 'w3', title: 'Neutral Series', kind: 'series'}),
    ]}));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('neutral'));
    await act(async () => { jest.advanceTimersByTime(400); await Promise.resolve(); });
    const playlistCallsBeforeTypeChange = callsFor(fetchMock, '/api/v1/playlists').length;

    act(() => renderer.root.findByProps({accessibilityLabel: 'Neutral Series'}).props.onFocus());
    chooseType(renderer, 'Movies');
    await act(async () => { await Promise.resolve(); });

    expect(allText(renderer)).toContain('Neutral Movie A');
    expect(allText(renderer)).not.toContain('Neutral Series');
    expect(renderer.root.findByType(BalancedT).props.children).toBe('Neutral Movie A');
    expect(callsFor(fetchMock, '/api/v1/catalog/search').some((url) => url.includes('available_only=true'))).toBe(true);
    expect(callsFor(fetchMock, '/api/v1/discover').some((url) => url.includes('scope=media'))).toBe(true);
    expect(callsFor(fetchMock, '/api/v1/playlists')).toHaveLength(playlistCallsBeforeTypeChange);
  });

  it('shows case-insensitive playlist name matches and uses the playlist-only branch', async () => {
    const fetchMock = mockSearchFetch(() => jsonResponse({items: []}), {playlists: [
      {id: 'p1', name: 'Green Shelf', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', media_type: 'mixed', is_system: false},
      {id: 'p2', name: 'Blue Shelf', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', media_type: 'mixed', is_system: false},
    ]});
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    chooseType(renderer, 'Playlists');
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('green'));
    await act(async () => { jest.advanceTimersByTime(400); await Promise.resolve(); });

    expect(allText(renderer)).toContain('Green Shelf');
    expect(allText(renderer)).not.toContain('Blue Shelf');
    expect(callsFor(fetchMock, '/api/v1/playlists')).toHaveLength(1);
    expect(callsFor(fetchMock, '/api/v1/catalog/search')).toHaveLength(0);
    expect(callsFor(fetchMock, '/api/v1/discover')).toHaveLength(0);
  });

  it('opens a matching child playlist at its root playlist and selected track', async () => {
    mockSearchFetch(() => jsonResponse({items: []}), {playlists: [
      {id: 'playlist-root', name: 'Neutral Root', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', media_type: 'video', is_system: false},
      {id: 'playlist-child', name: 'Neutral Child', parent_playlist_id: 'playlist-root', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', media_type: 'video', is_system: false},
    ]});
    const nav = fakeNavigation();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={nav} /></LanguageProvider></ApiClientProvider>); });
    chooseType(renderer, 'Playlists');
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('neutral'));
    await act(async () => { jest.advanceTimersByTime(400); await Promise.resolve(); });
    act(() => renderer.root.findByProps({accessibilityLabel: 'Neutral Child'}).props.onPress());
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.playlists, {playlistId: 'playlist-root', trackId: 'playlist-child', backTo: ROUTES.search});
    expect(searchPlaylistTarget({id: 'playlist-root', parent_playlist_id: null} as never, [
      {id: 'playlist-root', parent_playlist_id: null},
      {id: 'playlist-child', parent_playlist_id: 'playlist-root'},
    ] as never)).toEqual({playlistId: 'playlist-root'});
  });

  it('shows game discovery results and uses the games-only branch', async () => {
    const fetchMock = mockSearchFetch(() => jsonResponse({items: []}), {discovery: {providers: [], titles: [
      {title_key: 'game:neutral', title: 'Neutral Game', kind: 'game', sources: [], editions: [], external_refs: []},
    ]}});
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={fakeNavigation()} /></LanguageProvider></ApiClientProvider>);
    });

    chooseType(renderer, 'Games');
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('neutral'));
    await act(async () => { jest.advanceTimersByTime(400); await Promise.resolve(); });

    expect(allText(renderer)).toContain('Neutral Game');
    expect(callsFor(fetchMock, '/api/v1/discover').some((url) => url.includes('scope=games'))).toBe(true);
    expect(callsFor(fetchMock, '/api/v1/catalog/search')).toHaveLength(0);
    expect(callsFor(fetchMock, '/api/v1/playlists')).toHaveLength(0);
    expect(renderer.root.findAllByProps({accessibilityLabel: 'Request'})).toHaveLength(0);
    expect(renderer.root.findByProps({accessibilityLabel: 'Add to watchlist'})).toBeDefined();
  });

  it('keeps DiscoveryExtras out of the result count and exposes only supported request/watchlist/detail actions', async () => {
    const requestableDiscovery = {
      title_key: 'neutral-discovery-key', title: 'Neutral Discovery', kind: 'movie', year: 2024, editions: ['Standard'], overview: 'Neutral overview', poster_url: null,
      external_refs: [], in_watchlist: true,
      sources: [
        {source: 'library', availability: 'available', label: 'Library', work_id: 'library-work'},
        {source: 'request', availability: 'requestable', label: 'Request source'},
      ],
    };
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (input: unknown) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/api/v1/catalog/search')) return jsonResponse({items: [work({id: 'primary-work', title: 'Neutral Primary'})]});
      if (url.includes('/api/v1/playlists')) return jsonResponse([]);
      if (url.endsWith('/api/v1/discover/resolve')) return jsonResponse({title: {title_key: 'neutral-discovery-key'}, in_watchlist: true});
      if (url.endsWith('/api/v1/discover/request')) return jsonResponse({});
      if (url.includes('/api/v1/discover')) return jsonResponse({providers: [], titles: [requestableDiscovery]});
      return jsonResponse([]);
    });
    const nav = fakeNavigation();
    let renderer!: ReactTestRenderer;
    await act(async () => { renderer = create(<ApiClientProvider><LanguageProvider><TestSearchScreen navigation={nav} /></LanguageProvider></ApiClientProvider>); });
    const input = renderer.root.findByType(TextInput);
    act(() => input.props.onChangeText('neutral'));
    await act(async () => { jest.advanceTimersByTime(400); await Promise.resolve(); await Promise.resolve(); });

    expect(allText(renderer)).toContain('Neutral Primary');
    expect(allText(renderer)).toContain('Neutral Discovery');
    expect(allText(renderer)).toContain('1 result');
    expect(renderer.root.findByProps({accessibilityLabel: 'Request'})).toBeDefined();
    expect(renderer.root.findByProps({accessibilityLabel: 'Remove from watchlist'})).toBeDefined();
    act(() => renderer.root.findByProps({accessibilityLabel: 'Neutral Discovery'}).props.onPress());
    expect(nav.navigate).toHaveBeenCalledWith(ROUTES.workDetail, {workId: 'library-work', backTo: ROUTES.search});
    await act(async () => {
      renderer.root.findByProps({accessibilityLabel: 'Request'}).props.onPress();
      await Promise.resolve();
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input instanceof Request ? input.url : input).endsWith('/api/v1/discover/request'))).toBe(true);
  });
});
