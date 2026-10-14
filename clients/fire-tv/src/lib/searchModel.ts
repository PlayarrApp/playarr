import type {DiscoveryTitle, PlaylistResponse, TitleSnapshot, Work, WorkKind} from '@playarr-tv/api-client';

export type SearchMediaType = 'all' | 'movie' | 'series' | 'site' | 'artist' | 'playlist' | 'game';

export const SEARCH_MEDIA_TYPES: readonly SearchMediaType[] = ['all', 'movie', 'series', 'site', 'artist', 'playlist', 'game'];

const WORK_KINDS: readonly WorkKind[] = ['movie', 'series', 'site', 'artist'];

const SEARCH_TYPE_WORK_KIND: Partial<Record<SearchMediaType, WorkKind>> = {
  movie: 'movie',
  series: 'series',
  site: 'site',
  artist: 'artist',
};

/** Keep non-catalog Search types available while gating catalog filters on the server's advertised kinds. */
export function visibleSearchMediaTypes(availableKinds: ReadonlySet<WorkKind> | null): SearchMediaType[] {
  return SEARCH_MEDIA_TYPES.filter((type) => {
    const workKind = SEARCH_TYPE_WORK_KIND[type];
    return workKind === undefined || availableKinds?.has(workKind) === true;
  });
}

export function searchSourcePlan(type: SearchMediaType): {works: boolean; playlists: boolean; discovery: 'media' | 'games' | null} {
  return {
    works: type !== 'playlist' && type !== 'game',
    playlists: type === 'all' || type === 'playlist',
    discovery: type === 'game' ? 'games' : type === 'all' || type === 'movie' || type === 'series' ? 'media' : null,
  };
}

export function filterSearchWorks(works: Work[], type: SearchMediaType): Work[] {
  return works.filter((work) => WORK_KINDS.includes(work.kind) && (type === 'all' || type === 'movie' && work.kind === 'movie' || type === 'series' && work.kind === 'series' || type === 'site' && work.kind === 'site' || type === 'artist' && work.kind === 'artist'));
}

export function matchingSearchPlaylists(playlists: PlaylistResponse[], query: string): PlaylistResponse[] {
  const needle = query.toLocaleLowerCase();
  return playlists.filter((playlist) => playlist.name.toLocaleLowerCase().includes(needle));
}

export function searchPlaylistTarget(playlist: PlaylistResponse, playlists: PlaylistResponse[]): {playlistId: string; trackId?: string} {
  const byId = new Map(playlists.map((candidate) => [candidate.id, candidate]));
  let root = playlist;
  const visited = new Set([playlist.id]);
  while (root.parent_playlist_id) {
    if (visited.has(root.parent_playlist_id)) break;
    const parent = byId.get(root.parent_playlist_id);
    if (!parent) break;
    visited.add(parent.id);
    root = parent;
  }
  return root.id === playlist.id ? {playlistId: root.id} : {playlistId: root.id, trackId: playlist.id};
}

export function searchPlaylistScope(root: PlaylistResponse, playlists: PlaylistResponse[]): PlaylistResponse[] {
  const scope: PlaylistResponse[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string): void => {
    for (const child of playlists
      .filter((playlist) => playlist.parent_playlist_id === parentId)
      .sort((left, right) => left.name.localeCompare(right.name, undefined, {numeric: true, sensitivity: 'base'}))) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      scope.push(child);
      visit(child.id);
    }
  };
  visited.add(root.id);
  scope.push(root);
  visit(root.id);
  return scope;
}

export function discoveryLibraryWorkId(title: DiscoveryTitle): string | null {
  if (!['movie', 'series', 'site', 'artist'].includes(title.kind)) return null;
  return title.sources.find((source) => source.source === 'library' && source.work_id)?.work_id ?? null;
}

export function snapshotFromDiscoveryTitle(title: DiscoveryTitle): TitleSnapshot {
  return {
    kind: title.kind,
    title: title.title,
    year: title.year ?? null,
    work_id: title.sources.find((source) => source.source === 'library' && source.work_id)?.work_id ?? null,
    external_refs: title.external_refs,
    poster_url: title.poster_url ?? null,
  };
}

export function discoveryTitleIsRequestable(title: DiscoveryTitle): boolean {
  return title.sources.some((source) => source.source === 'request' && source.availability === 'requestable');
}
