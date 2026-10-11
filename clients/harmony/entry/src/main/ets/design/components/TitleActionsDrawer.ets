/**
 * The long-press title actions (web `MediaContextMenu`): the shared right drawer with Play, Mark as watched and Mark
 * as unwatched. One component for every page that has title cards (Library, Search). Play hands the work to the
 * page (it opens the title page); the watched actions write progress for every file of the title and then tell the
 * page, which refreshes its watch marks. Not here: Download and the playlist actions.
 */

import { Drawer } from './Drawer';
import { ActionList } from './ActionList';
import type { ActionItem } from './ActionList';
import { setWorkWatched } from '../../data/PlaybackRepository';

const TITLE_ACTIONS: ActionItem[] = [
  { id: 'play', glyph: '▶', label: 'Play' },
  { id: 'watched', glyph: '✓', label: 'Mark as watched' },
  { id: 'unwatched', glyph: '○', label: 'Mark as unwatched' },
];

@Component
export struct TitleActionsDrawer {
  @Prop workId: string = '';
  @Prop workTitle: string = '';
  onClose: () => void = () => {};
  onPlay: (workId: string) => void = () => {};
  /** Called after a watched or unwatched write finished (or failed), so the page can reload its marks. */
  onWatchedChanged: () => void = () => {};

  @State private busyId: string = '';

  private async choose(id: string): Promise<void> {
    if (this.busyId.length > 0) {
      return;
    }
    if (id === 'play') {
      this.onClose();
      this.onPlay(this.workId);
      return;
    }
    this.busyId = id;
    await setWorkWatched(this.workId, id === 'watched');
    this.busyId = '';
    this.onClose();
    this.onWatchedChanged();
  }

  @Builder
  private body(): void {
    ActionList({
      actions: TITLE_ACTIONS,
      busyId: this.busyId,
      onChoose: (id: string): void => {
        this.choose(id);
      },
    })
  }

  build() {
    Drawer({
      kicker: 'Title actions',
      title: this.workTitle,
      onClose: (): void => {
        this.onClose();
      },
      body: (): void => {
        this.body();
      },
    })
  }
}
