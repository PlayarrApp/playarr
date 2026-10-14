/**
 * Web-equivalent artwork order for playable series episode cards. Pure so
 * the exact production selector can be exercised without the Harmony SDK.
 */
export type EpisodeArtworkSource = 'episode-still' | 'media-thumbnail' | 'series-artwork';

export interface EpisodeArtworkSourceInput {
  mediaFileId: string | null | undefined;
  hasEpisodeThumb: boolean;
}

/** Unresolved episodes are ineligible. Eligible episodes try the cached
 * server still when advertised, then the default 30-second media frame,
 * then the detail page's backdrop-before-poster artwork. */
export function selectEpisodeArtworkSources(input: EpisodeArtworkSourceInput): EpisodeArtworkSource[] {
  if (input.mediaFileId === null || input.mediaFileId === undefined || input.mediaFileId.length === 0) {
    return [];
  }
  const sources: EpisodeArtworkSource[] = [];
  if (input.hasEpisodeThumb) {
    sources.push('episode-still');
  }
  sources.push('media-thumbnail');
  sources.push('series-artwork');
  return sources;
}
