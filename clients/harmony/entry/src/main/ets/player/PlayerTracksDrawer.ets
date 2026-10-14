/**
 * The player's subtitles and audio picker (web's "CC" menu): the shared right-hand Drawer with one list of subtitle choices (Off first,
 * then the file's tracks) and, when the file has more than one audio track, a list of audio choices. The current choice carries a tick.
 * It only reports a pick; `pages/Player.ets` attaches the subtitle or renegotiates the audio.
 */

import { nunito } from '../design/Typography';
import { Drawer } from '../design/components/Drawer';
import { ActionList } from '../design/components/ActionList';
import type { ActionItem } from '../design/components/ActionList';
import { activeColors, toResourceColor } from '../design/Theme';
import { tv } from '../design/Metrics';
import type { AudioTrack, SubtitleTrack } from '../core/Types/Playback.ts';

const HEADING_SIZE: number = 14;
const SECTION_GAP: number = 18;
const TICK: string = '✓';

/** The id the picker reports for "Subtitles off". */
export const SUBTITLES_OFF_ID: string = '';

@Component
export struct PlayerTracksDrawer {
  @Prop subtitleTracks: SubtitleTrack[] = [];
  /** The chosen subtitle track id, or '' for off. */
  @Prop selectedSubtitleId: string = '';
  @Prop audioTracks: AudioTrack[] = [];
  @Prop selectedAudioId: string = '';
  onPickSubtitle: (id: string) => void = () => {};
  onPickAudio: (id: string) => void = () => {};
  onClose: () => void = () => {};

  private subtitleActions(): ActionItem[] {
    const items: ActionItem[] = [
      { id: 'sub:', glyph: this.selectedSubtitleId === SUBTITLES_OFF_ID ? TICK : '', label: 'Off' },
    ];
    for (const track of this.subtitleTracks) {
      items.push({ id: 'sub:' + track.id, glyph: this.selectedSubtitleId === track.id ? TICK : '', label: track.label });
    }
    return items;
  }

  private audioActions(): ActionItem[] {
    const items: ActionItem[] = [];
    for (const track of this.audioTracks) {
      items.push({ id: 'aud:' + track.id, glyph: this.selectedAudioId === track.id ? TICK : '', label: track.label });
    }
    return items;
  }

  @Builder
  private heading(text: string): void {
    Text(text).fontFamily(nunito(700))
      .fontSize(tv(HEADING_SIZE))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .width('100%')
  }

  @Builder
  private tracksBody(): void {
    Column({ space: tv(SECTION_GAP) }) {
      if (this.subtitleTracks.length > 0) {
        this.heading('Subtitles')
        ActionList({
          actions: this.subtitleActions(),
          onChoose: (id: string): void => {
            this.onPickSubtitle(id.substring(4));
          },
        })
      }
      if (this.audioTracks.length > 1) {
        this.heading('Audio')
        ActionList({
          actions: this.audioActions(),
          onChoose: (id: string): void => {
            this.onPickAudio(id.substring(4));
          },
        })
      }
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
  }

  build() {
    Drawer({
      kicker: 'Playback',
      title: 'Audio and subtitles',
      onClose: (): void => {
        this.onClose();
      },
      body: (): void => {
        this.tracksBody();
      },
    })
  }
}
