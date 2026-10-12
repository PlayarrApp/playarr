/**
 * A movie's playback settings (web's "Playback" drawer): the file's saved quality, audio and subtitle choices, edited with three select
 * fields and saved with PATCH /api/v1/media/{id}/playback-options. The next time the file plays it opens with these choices.
 */

import { Drawer } from './Drawer';
import { SelectField } from './SelectField';
import type { Choice } from './ChoiceSegments';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import { tv } from '../Metrics';
import { getMediaPlaybackOptions, updateMediaPlaybackOptions } from '../../data/PlaybackRepository';
import type { MediaPlaybackOptions, MediaPlaybackPreferences } from '../../core/Types/Playback.ts';

const SECTION_WIDTH: number = 268;
const SECTION_GAP: number = 14;
const HEADING_SIZE: number = 13;
const PILL_HEIGHT: number = 46;
const PILL_SIZE: number = 14;
const PILL_PADDING: number = 24;

/** The value of the "automatic" / "off" entries (no explicit track). */
const NONE: string = '';

@Component
export struct PlaybackOptionsDrawer {
  @Prop mediaFileId: string = '';
  @Prop workTitle: string = '';
  onClose: () => void = () => {};

  @State private options: MediaPlaybackOptions | null = null;
  @State private failed: boolean = false;
  @State private saving: boolean = false;
  @State private qualityId: string = 'original';
  @State private audioId: string = NONE;
  @State private subtitleId: string = NONE;

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    const result = await getMediaPlaybackOptions(this.mediaFileId);
    if (result.kind !== 'ok') {
      this.failed = true;
      return;
    }
    this.options = result.value;
    this.qualityId = result.value.preferences.quality_id;
    this.audioId = result.value.preferences.audio_track_id ?? NONE;
    this.subtitleId = result.value.preferences.subtitle_track_id ?? NONE;
  }

  private async save(): Promise<void> {
    if (this.saving) {
      return;
    }
    this.saving = true;
    const preferences: MediaPlaybackPreferences = {
      quality_id: this.qualityId,
      audio_track_id: this.audioId.length > 0 ? this.audioId : null,
      subtitle_track_id: this.subtitleId.length > 0 ? this.subtitleId : null,
    };
    const result = await updateMediaPlaybackOptions(this.mediaFileId, preferences);
    this.saving = false;
    if (result.kind === 'ok') {
      this.onClose();
      return;
    }
    this.failed = true;
  }

  private qualityChoices(options: MediaPlaybackOptions): Choice[] {
    return options.quality_options.map((quality): Choice => ({ value: quality.id, label: quality.label }));
  }

  private audioChoices(options: MediaPlaybackOptions): Choice[] {
    const choices: Choice[] = [{ value: NONE, label: 'Automatic' }];
    for (const track of options.audio_tracks) {
      choices.push({ value: track.id, label: track.label });
    }
    return choices;
  }

  private subtitleChoices(options: MediaPlaybackOptions): Choice[] {
    const choices: Choice[] = [{ value: NONE, label: 'Off' }];
    for (const track of options.subtitle_tracks) {
      choices.push({ value: track.id, label: track.label });
    }
    return choices;
  }

  @Builder
  private heading(text: string): void {
    Text(text)
      .fontSize(tv(HEADING_SIZE))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .width(tv(SECTION_WIDTH))
  }

  @Builder
  private pill(label: string, onTap: () => void): void {
    Text(label)
      .fontSize(tv(PILL_SIZE))
      .fontColor(toResourceColor(activeColors().ink))
      .height(tv(PILL_HEIGHT))
      .padding({ left: tv(PILL_PADDING), right: tv(PILL_PADDING) })
      .borderRadius(tv(PILL_HEIGHT / 2))
      .backgroundColor(toResourceColor(activeColors().surfaceSoft))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.15) })
      .focusable(true)
      .onClick(onTap)
  }

  @Builder
  private optionsBody(): void {
    Column({ space: tv(SECTION_GAP) }) {
      if (this.options !== null) {
        this.heading('Quality')
        SelectField({
          options: this.qualityChoices(this.options),
          value: this.qualityId,
          selectWidth: SECTION_WIDTH,
          onChange: (value: string): void => {
            this.qualityId = value;
          },
        })
        this.heading('Audio')
        SelectField({
          options: this.audioChoices(this.options),
          value: this.audioId,
          selectWidth: SECTION_WIDTH,
          onChange: (value: string): void => {
            this.audioId = value;
          },
        })
        this.heading('Subtitles')
        SelectField({
          options: this.subtitleChoices(this.options),
          value: this.subtitleId,
          selectWidth: SECTION_WIDTH,
          onChange: (value: string): void => {
            this.subtitleId = value;
          },
        })
        this.pill(this.saving ? 'Saving' : 'Save', (): void => {
          void this.save();
        })
      } else if (this.failed) {
        Text('Playback options could not be loaded')
          .fontSize(tv(HEADING_SIZE))
          .fontColor(toResourceColor(activeColors().danger))
          .width(tv(SECTION_WIDTH))
      }
    }
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Drawer({
      kicker: 'Movie',
      title: 'Playback settings',
      onClose: (): void => {
        this.onClose();
      },
      body: (): void => {
        this.optionsBody();
      },
    })
  }
}
