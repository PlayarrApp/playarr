/**
 * Playlists, drawn on the web TV layout (`clients/tv-web/web/src/pages/Playlists.tsx`): the page copy on the left, the Create
 * and Filters tiles in the action column and a track of titles for each top-level playlist on the right (the web's directory
 * of playlists). With no playlists it is the web's empty state.
 *
 * Not on this platform yet: creating a playlist, sub-playlists and the filter drawer (their tiles are drawn); playlists are
 * made from a title page's "Add to Playlist".
 */
import React, {useEffect, useMemo, useState} from 'react';
import type {ApiClient, PlaylistItemResponse, PlaylistResponse, Work} from '@playarr-tv/api-client';
import {useAsyncData} from '@playarr-tv/api-client/react';
import {useApiClient} from '../api/ApiClientProvider';
import {preferredArtworkKind, workArtworkUrl} from '../api/artworkUrl';
import {useLanguage} from '../i18n/LanguageProvider';
import {useTvBackNavigation} from '../navigation/backPolicy';
import {ROUTES, type RouteName} from '../navigation/routes';
import {useTheme} from '../theme/ThemeProvider';
import {ActionTile} from '../tv/ActionTile';
import {EmptyState} from '../tv/EmptyState';
import {BalancedT, Box, T, u} from '../tv/kit';
import {PageHeader} from '../tv/PageHeader';
import {RailFrost, Stage} from '../tv/Stage';
import {TrackStack, type Track} from '../tv/TrackStack';
import {View} from 'react-native';
import {useAccessToken} from './LibraryScreen';
import {searchPlaylistScope, searchPlaylistTarget} from '../lib/searchModel';

interface ResolvedPlaylistItem {
  item: PlaylistItemResponse;
  work: Work | null;
}

/** Items shown per playlist track; a playlist can hold hundreds. */
const ITEMS_PER_TRACK = 24;

async function loadTracks(client: ApiClient, playlists: PlaylistResponse[]): Promise<Array<{playlist: PlaylistResponse; items: ResolvedPlaylistItem[]; total: number}>> {
  return Promise.all(
    playlists.map(async (playlist) => {
      const items = await client.listPlaylistItems(playlist.id).catch(() => [] as PlaylistItemResponse[]);
      const shown = await Promise.all(
        items.slice(0, ITEMS_PER_TRACK).map(async (item) => {
          try {
            // `getWork` returns the full detail; a card only needs its `.work`.
            const detail = await client.getWork(item.work_id);
            return {item, work: detail.work};
          } catch {
            return {item, work: null};
          }
        }),
      );
      return {playlist, items: shown, total: items.length};
    }),
  );
}

export interface PlaylistsScreenNavigation {
  navigate: (route: RouteName, params?: Record<string, unknown>) => void;
}

export interface PlaylistsScreenProps {
  route?: {params?: {playlistId?: string; trackId?: string; backTo?: RouteName}};
  navigation: PlaylistsScreenNavigation;
}

export function PlaylistsScreen({route, navigation}: PlaylistsScreenProps): React.ReactElement {
  const client = useApiClient();
  const token = useAccessToken(client);
  const baseUrl = client.resolveUrl('/');
  const {t} = useLanguage();
  const {colour, scheme} = useTheme();
  useTvBackNavigation(route?.params?.backTo ?? ROUTES.home);

  const playlistsState = useAsyncData(() => client.listPlaylists(), [client]);
  const requestedPlaylistId = route?.params?.playlistId;
  const availablePlaylists = playlistsState.status === 'ready' ? playlistsState.data : [];
  const requestedPlaylist = requestedPlaylistId ? availablePlaylists.find((playlist) => playlist.id === requestedPlaylistId) ?? null : null;
  const selectedPlaylist = requestedPlaylist
    ? availablePlaylists.find((playlist) => playlist.id === searchPlaylistTarget(requestedPlaylist, availablePlaylists).playlistId) ?? null
    : null;
  const topLevel = useMemo(
    () => requestedPlaylistId ? (selectedPlaylist ? searchPlaylistScope(selectedPlaylist, availablePlaylists) : []) : availablePlaylists.filter((playlist) => !playlist.parent_playlist_id),
    [requestedPlaylistId, selectedPlaylist, availablePlaylists],
  );
  const tracksState = useAsyncData(() => loadTracks(client, topLevel), [client, topLevel.map((playlist) => playlist.id).join(',')], {enabled: playlistsState.status === 'ready' && topLevel.length > 0});
  const [focus, setFocus] = useState<{track: number; item: number} | null>(null);
  useEffect(() => setFocus(null), [topLevel.length, selectedPlaylist?.id]);

  const tracks: Track[] = useMemo(
    () =>
      tracksState.status === 'ready'
        ? tracksState.data.map(({playlist, items, total}) => ({
            id: playlist.id,
            title: playlist.name,
            meta: total === 1 ? t('pages.playlists.itemCountOne', {count: total}) : t('pages.playlists.itemCountOther', {count: total}),
            items: items
              .filter((entry): entry is {item: PlaylistItemResponse; work: Work} => entry.work !== null)
              .map(({item, work}) => {
                const kind = preferredArtworkKind(work, ['backdrop', 'poster']);
                return {
                  id: item.id,
                  art: kind ? workArtworkUrl(baseUrl, work.id, kind) : undefined,
                  small: work.kind === 'series' ? t('pages.home.workKind.series') : work.kind === 'artist' ? t('pages.home.workKind.artist') : t('pages.home.workKind.movie'),
                  title: work.title,
                  onPress: () => navigation.navigate(work.kind === 'artist' ? ROUTES.musicDetail : ROUTES.workDetail, {
                    workId: work.id,
                    backTo: ROUTES.playlists,
                    backParams: {playlistId: route?.params?.playlistId ?? selectedPlaylist?.id, trackId: route?.params?.trackId, backTo: route?.params?.backTo},
                  }),
                };
              }),
          }))
        : [],
    [tracksState, baseUrl, t, navigation],
  );

  const count = topLevel.length;
  const empty = playlistsState.status === 'ready' && count === 0;

  return (
    <Stage>
      <PageHeader
        title={selectedPlaylist ? t('pages.playlists.titleWithName', {name: selectedPlaylist.name}) : t('pages.playlists.title')}
        detail={playlistsState.status === 'ready' ? (count === 1 ? t('pages.playlists.playlistCountOne', {count}) : t('pages.playlists.playlistCountOther', {count})) : undefined}
        onBack={() => navigation.navigate(route?.params?.backTo ?? ROUTES.home, route?.params?.backTo === ROUTES.search ? undefined : {playlistId: route?.params?.playlistId, trackId: route?.params?.trackId})}
      />
      <Box x={153.6} y={259.2} w={540}>
        <T size={12.288} weight={820} ls={0.983} lh={18.4} color="#cf3157" upper>
          {selectedPlaylist ? `${t(selectedPlaylist.media_type === 'audio' ? 'pages.playlists.mediaTypeAudio' : 'pages.playlists.mediaTypeVideo')} · ${t(selectedPlaylist.is_system ? 'pages.playlists.sharedPlaylist' : 'pages.playlists.yourPlaylist')}` : t('pages.playlists.yourCollection')}
        </T>
        <View style={{marginTop: u(25.9)}}>
          {selectedPlaylist ? (
            <BalancedT width={520} size={49.92} weight={560} ls={-2.2} lh={50} color={colour.ink}>
              {selectedPlaylist.name}
            </BalancedT>
          ) : (
            <T size={69.12} weight={560} ls={-4.9766} lh={62.2} color={colour.ink}>
              {t('pages.playlists.title')}
            </T>
          )}
        </View>
        {!selectedPlaylist ? <View style={{marginTop: u(27), width: u(324)}}>
          <T size={12.864} weight={400} lh={20.3} color={colour.inkMuted}>
            {t('pages.playlists.createPlaylistPrompt')}
          </T>
        </View> : null}
      </Box>
      <RailFrost dark={scheme === 'dark'} soft={colour.surfaceSoft} strong={colour.surfaceStrong} />
      <ActionTile icon="plus" label={t('pages.playlists.create')} slot={0} />
      <ActionTile icon="filters" label={t('pages.playlists.filters')} slot={1} />
      {empty ? <EmptyState x={729.6} width={1100} y={412} title={t('pages.playlists.noPlaylistsYetTitle')} description={t('pages.playlists.createPlaylistPrompt')} /> : null}
      {playlistsState.status === 'error' ? <EmptyState x={729.6} width={1100} y={412} title={t('pages.playlists.loadErrorTitle')} description={playlistsState.message} tone="error" /> : null}
      {tracks.length > 0 ? <TrackStack tracks={tracks} token={token} restY={410} focus={focus} onFocus={setFocus} initial={selectedPlaylist ? {track: Math.max(0, tracks.findIndex((track) => track.id === route?.params?.trackId)), item: 0} : null} /> : null}
    </Stage>
  );
}
