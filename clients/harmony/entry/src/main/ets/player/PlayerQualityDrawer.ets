/**
 * The player's quality picker (web's "HD Original" menu): the shared right-hand Drawer with the negotiated file's quality options,
 * "Original" first, the current one ticked. It only reports a pick; `pages/Player.ets` renegotiates with that profile.
 */

import { Drawer } from '../design/components/Drawer';
import { ActionList } from '../design/components/ActionList';
import type { ActionItem } from '../design/components/ActionList';
import type { QualityOption } from '../core/Types/Playback.ts';

const TICK: string = '✓';

@Component
export struct PlayerQualityDrawer {
  @Prop options: QualityOption[] = [];
  @Prop selectedId: string = '';
  onPick: (id: string) => void = () => {};
  onClose: () => void = () => {};

  private actions(): ActionItem[] {
    const items: ActionItem[] = [];
    for (const option of this.options) {
      items.push({ id: option.id, glyph: this.selectedId === option.id ? TICK : '', label: option.label });
    }
    return items;
  }

  @Builder
  private qualityBody(): void {
    ActionList({
      actions: this.actions(),
      onChoose: (id: string): void => {
        this.onPick(id);
      },
    })
  }

  build() {
    Drawer({
      kicker: 'Playback',
      title: 'Quality',
      onClose: (): void => {
        this.onClose();
      },
      body: (): void => {
        this.qualityBody();
      },
    })
  }
}
