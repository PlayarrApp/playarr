import type {WorkKind} from '@playarr-tv/api-client';
import {visibleSearchMediaTypes} from './searchModel';

describe('visibleSearchMediaTypes', () => {
  it('keeps All, Playlists and Games when catalog kinds are unavailable', () => {
    expect(visibleSearchMediaTypes(null)).toEqual(['all', 'playlist', 'game']);
    expect(visibleSearchMediaTypes(new Set<WorkKind>())).toEqual(['all', 'playlist', 'game']);
  });

  it('includes only the work filters advertised by the server', () => {
    expect(visibleSearchMediaTypes(new Set<WorkKind>(['artist', 'movie', 'series']))).toEqual([
      'all', 'movie', 'series', 'artist', 'playlist', 'game',
    ]);
    expect(visibleSearchMediaTypes(new Set<WorkKind>(['site']))).toEqual([
      'all', 'site', 'playlist', 'game',
    ]);
  });

  it('shows all Search filters when every supported kind is available', () => {
    expect(visibleSearchMediaTypes(new Set<WorkKind>(['movie', 'series', 'site', 'artist']))).toEqual([
      'all', 'movie', 'series', 'site', 'artist', 'playlist', 'game',
    ]);
  });
});
