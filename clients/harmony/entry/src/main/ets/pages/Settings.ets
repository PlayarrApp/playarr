/**
 * Settings workspace, TV layout (web `pages/settings/SettingsIndex.tsx` with `SettingsLayout`): "Preferences"
 * with the open section as a pink kicker, the numbered section list on the left (480x92 rows from (154, 162),
 * the open one on surface-soft) and the open section's panel on the right. Geometry copies the live web TV
 * DOM at 1920x1080. Section numbers are web's own (they are ids, not positions).
 *
 * Here so far: Appearance (colour theme, saved for the next start), Player (the default audio language, on the
 * profile) and Server connection (the address in use). The other web sections land with 13.10018's later steps.
 */

import { activeColors, setThemeModeSetting, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import type { ThemeModeSetting } from '../design/Theme';
import { tv, TvGeometry } from '../design/Metrics';
import { PageShell } from '../design/components/PageShell';
import { ChoiceSegments } from '../design/components/ChoiceSegments';
import { SelectField, THEME_CHOICES } from '../design/components/SelectField';
import type { AudioLanguage } from '../core/AudioLanguages';
import { AUDIO_LANGUAGES, normaliseAudioLanguage, audioLanguageLabel } from '../core/AudioLanguages';
import { getPlayerPreferences, updatePlayerPreferences } from '../data/ProfileRepository';
import type { Choice } from '../design/components/ChoiceSegments';

import { getServerDirectory, saveThemeChoice, loadPlayerDefaults, savePlayerDefault } from '../AppContainer';
import { QualityMatrix } from '../design/components/QualityMatrix';
import { ORIGINAL_QUALITY, normaliseQuality, normaliseSubtitleMode, normaliseSubtitleLanguage } from '../core/PlayerDefaults';


interface SettingsSection {
  id: string;
  number: string;
  title: string;
}

const APPEARANCE: string = 'appearance';
const PLAYER: string = 'player';
const SERVER: string = 'server';
const SECTIONS: SettingsSection[] = [
  { id: APPEARANCE, number: '01', title: 'Appearance' },
  { id: PLAYER, number: '04', title: 'Player' },
  { id: SERVER, number: '05', title: 'Server connection' },
];
const SUBTITLE_MODE_CHOICES: Choice[] = [
  { value: 'off', label: 'Off' },
  { value: 'forced', label: 'Forced only' },
  { value: 'always', label: 'Always on' },
];
const AUDIO_CHOICES: Choice[] = AUDIO_LANGUAGES.map((language: AudioLanguage): Choice => ({ value: language.value, label: language.label }));

// Web `.settings-option`: 480x92 rows from (154, 162); number at +32/+24, title at +92, arrow at +432.
const LIST_TOP: number = 162;
const ROW_WIDTH: number = 480;
const ROW_HEIGHT: number = 92;
const NUMBER_LEFT: number = 32;
const NUMBER_TOP: number = 24;
const NUMBER_SIZE: number = 9.92;
const TITLE_LEFT: number = 92;
const TITLE_SIZE: number = 29.6;
const TITLE_LETTER_SPACING: number = -1.036;
const ARROW_LEFT: number = 432;
const ARROW_SIZE: number = 20.8;
// Web `.settings-section-content`: the panel copy starts at (774, 210), 1042 wide.
const PANEL_LEFT: number = 774;
const PANEL_TOP: number = 210;
const PANEL_WIDTH: number = 1042;
const PANEL_TEXT_SIZE: number = 13.824;

@Component
export struct SettingsScreen {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private openSection: string = APPEARANCE;
  @State private audioLanguage: string = 'en';
  /** Web's player preference status: loading, ready, saving or an error message. */
  @State private audioStatus: string = 'loading';
  /** Device-local playback defaults (web lib/playerDefaults). */
  @State private defaultQuality: string = ORIGINAL_QUALITY;
  @State private subtitleMode: string = 'off';
  @State private subtitleLanguage: string = 'en';
  @State private audioError: string = '';

  aboutToAppear(): void {
    this.loadAudioLanguage();
    this.loadDefaults();
  }

  private async loadDefaults(): Promise<void> {
    const stored = await loadPlayerDefaults();
    this.defaultQuality = normaliseQuality(stored[0]);
    this.subtitleMode = normaliseSubtitleMode(stored[1]);
    this.subtitleLanguage = normaliseSubtitleLanguage(stored[2]);
  }

  private setDefault(which: string, value: string): void {
    if (which === 'quality') {
      this.defaultQuality = value;
    } else if (which === 'subtitleMode') {
      this.subtitleMode = value;
    } else {
      this.subtitleLanguage = value;
    }
    savePlayerDefault(which, value);
  }

  private async loadAudioLanguage(): Promise<void> {
    const result = await getPlayerPreferences();
    if (result.kind === 'ok') {
      this.audioLanguage = normaliseAudioLanguage(result.value.preferred_audio_language);
      this.audioStatus = 'ready';
    } else {
      this.audioStatus = 'error';
      this.audioError = 'The server could not be reached.';
    }
  }

  private async chooseAudioLanguage(next: string): Promise<void> {
    if (next === this.audioLanguage || this.audioStatus === 'loading' || this.audioStatus === 'saving') {
      return;
    }
    const previous = this.audioLanguage;
    this.audioLanguage = next;
    this.audioStatus = 'saving';
    const result = await updatePlayerPreferences({ preferred_audio_language: next });
    if (result.kind === 'ok') {
      this.audioLanguage = normaliseAudioLanguage(result.value.preferred_audio_language);
      this.audioStatus = 'ready';
    } else {
      this.audioLanguage = previous;
      this.audioStatus = 'error';
      this.audioError = 'The server could not be reached.';
    }
  }

  private audioStatusText(): string {
    const language = audioLanguageLabel(this.audioLanguage);
    if (this.audioStatus === 'loading') {
      return 'Loading your player preference…';
    }
    if (this.audioStatus === 'saving') {
      return 'Saving ' + language + '…';
    }
    if (this.audioStatus === 'error') {
      return 'Could not update the player preference (' + this.audioError + ').';
    }
    return language + ' will be selected when it is available.';
  }

  private sectionTitle(): string {
    const open = SECTIONS.find((section: SettingsSection) => section.id === this.openSection);
    return open !== undefined ? open.title : '';
  }

  @Builder
  private sectionRow(section: SettingsSection): void {
    Stack({ alignContent: Alignment.TopStart }) {
      Text(section.number)
        .fontSize(tv(NUMBER_SIZE))
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().ink))
        .position({ x: tv(NUMBER_LEFT), y: tv(NUMBER_TOP) })
      Text(section.title)
        .fontSize(tv(TITLE_SIZE))
        .fontWeight(FontWeight.Medium)
        .letterSpacing(tv(TITLE_LETTER_SPACING))
        .fontColor(toResourceColor(activeColors().ink))
        .height(tv(ROW_HEIGHT))
        .position({ x: tv(TITLE_LEFT), y: 0 })
      Text('→')
        .fontSize(tv(ARROW_SIZE))
        .fontColor(toResourceColor(activeColors().ink))
        .height(tv(ROW_HEIGHT))
        .position({ x: tv(ARROW_LEFT), y: 0 })
    }
    .width(tv(ROW_WIDTH))
    .height(tv(ROW_HEIGHT))
    .backgroundColor(section.id === this.openSection ? toResourceColor(activeColors().surfaceSoft) : Color.Transparent)
    .focusable(true)
    .onFocus(() => {
      this.openSection = section.id;
    })
    .onClick(() => {
      this.openSection = section.id;
    })
  }

  @Builder
  private appearancePanel(): void {
    ChoiceSegments({
      heading: 'Colour theme',
      choices: THEME_CHOICES,
      selected: this.themeSetting,
      large: true,
      sectionWidth: PANEL_WIDTH,
      onChoose: (value: string) => {
        setThemeModeSetting(value as ThemeModeSetting);
        saveThemeChoice(value as ThemeModeSetting);
      },
    })
  }

  @Builder
  private panelHeading(title: string, description: string): void {
    Text(title)
      .fontSize(tv(26.4))
      .fontWeight(FontWeight.Medium)
      .letterSpacing(tv(-0.924))
      .fontColor(toResourceColor(activeColors().ink))
    Text(description)
      .fontSize(tv(PANEL_TEXT_SIZE))
      .fontColor(toResourceColor(activeColors().inkSoft))
  }

  /** Web's Player section: Default quality, Default subtitles, Default audio track, then the device note. */
  @Builder
  private playerPanel(): void {
    Scroll() {
      Column({ space: tv(16) }) {
        this.panelHeading('Default quality', 'Start playback at this quality when your connection allows it.')
        QualityMatrix({
          selected: this.defaultQuality,
          matrixWidth: PANEL_WIDTH,
          onChoose: (id: string): void => {
            this.setDefault('quality', id);
          },
        })
        this.panelHeading('Default subtitles', 'Choose when subtitles start, and in which language.')
        ChoiceSegments({
          heading: '',
          choices: SUBTITLE_MODE_CHOICES,
          selected: this.subtitleMode,
          sectionWidth: PANEL_WIDTH,
          onChoose: (value: string): void => {
            this.setDefault('subtitleMode', value);
          },
        })
        if (this.subtitleMode !== 'off') {
          SelectField({
            options: AUDIO_CHOICES,
            value: this.subtitleLanguage,
            selectWidth: PANEL_WIDTH,
            onChange: (value: string): void => {
              this.setDefault('subtitleLanguage', value);
            },
          })
        }
        this.panelHeading('Default audio track', 'Prefer this audio language whenever a matching track is available.')
        SelectField({
          options: AUDIO_CHOICES,
          value: this.audioLanguage,
          selectWidth: PANEL_WIDTH,
          disabled: this.audioStatus === 'loading' || this.audioStatus === 'saving',
          onChange: (value: string): void => {
            this.chooseAudioLanguage(value);
          },
        })
        Text(this.audioStatusText())
          .fontSize(tv(PANEL_TEXT_SIZE))
          .fontColor(toResourceColor(this.audioStatus === 'error' ? activeColors().danger : activeColors().inkSoft))
        Text('Quality and subtitle defaults are saved on this device. Audio language follows your profile.')
          .fontSize(tv(PANEL_TEXT_SIZE))
          .fontColor(toResourceColor(activeColors().inkMuted))
      }
      .alignItems(HorizontalAlign.Start)
      .padding({ bottom: tv(60) })
    }
    .width(tv(PANEL_WIDTH))
    .height(tv(1080 - PANEL_TOP))
    .scrollBar(BarState.Off)
    .align(Alignment.TopStart)
  }

  @Builder
  private serverPanel(): void {
    Column({ space: tv(16) }) {
      Text('Server connection')
        .fontSize(tv(26.4))
        .fontWeight(FontWeight.Medium)
        .letterSpacing(tv(-0.924))
        .fontColor(toResourceColor(activeColors().ink))
      Text(getServerDirectory().getActiveBaseUrl() ?? 'No server connected.')
        .fontSize(tv(PANEL_TEXT_SIZE))
        .fontColor(toResourceColor(activeColors().inkSoft))
    }
    .width(tv(PANEL_WIDTH))
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private pageContent(): void {
    Column() {
      ForEach(SECTIONS, (section: SettingsSection) => {
        this.sectionRow(section)
      }, (section: SettingsSection): string => `${section.id}:${section.id === this.openSection}`)
    }
    .position({ x: tv(TvGeometry.titlePanelLeft), y: tv(LIST_TOP) })
    Column() {
      if (this.openSection === APPEARANCE) {
        this.appearancePanel()
      } else if (this.openSection === PLAYER) {
        this.playerPanel()
      } else {
        this.serverPanel()
      }
    }
    .position({ x: tv(PANEL_LEFT), y: tv(PANEL_TOP) })
  }

  build() {
    NavDestination() {
      PageShell({
        title: 'Preferences',
        selectedId: '',
        kicker: this.sectionTitle(),
        content: (): void => {
          this.pageContent();
        },
      })
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Settings` route's `buildFunction`. */
@Builder
export function SettingsBuilder(): void {
  SettingsScreen()
}
