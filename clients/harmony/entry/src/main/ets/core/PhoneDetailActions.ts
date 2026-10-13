/** Action roles shown by the Harmony phone's series-detail action row. */

export type SeriesPhoneActionId = 'primary' | 'watchlist' | 'playlist';

/** Match the web series row: a primary action only for a resolved resume target, followed by watchlist and playlist. */
export function seriesPhoneActionIds(hasPlayableTarget: boolean): SeriesPhoneActionId[] {
  const actions: SeriesPhoneActionId[] = [];
  if (hasPlayableTarget) {
    actions.push('primary');
  }
  actions.push('watchlist', 'playlist');
  return actions;
}
