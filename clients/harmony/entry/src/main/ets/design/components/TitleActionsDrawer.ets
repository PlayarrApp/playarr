/**
 * The long-press title actions (web `MediaContextMenu`): the shared right drawer with Play, Download, Add to Playlist,
 * Mark as watched and Mark as unwatched. One component for every page that has title cards (Library, Search, Home).
 * Play hands the work to the page (it opens the title page); the watched actions write progress for every file of the
 * title and then tell the page, which refreshes its watch marks. Download opens a quality and keep-until choice
 * (sizes from the server, "~" marking an estimate) and queues every file of the title; Add to Playlist lists the
 * playlists that take this kind of title and adds it to the one chosen.
 */

import { Drawer } from './Drawer';
import { ActionList } from './ActionList';
import type { ActionItem } from './ActionList';
import { SelectField } from './SelectField';
import type { Choice } from './ChoiceSegments';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { tv } from '../Metrics';
import { setWorkWatched } from '../../data/PlaybackRepository';
import { getWorkDetail } from '../../data/CatalogRepository';
import { enqueueDownload, getDownloadOptions } from '../../data/DownloadsRepository';
import { listPlaylists, addPlaylistItem } from '../../data/PlaylistsRepository';
import { downloadTargets } from '../../core/DownloadTargets';
import type { DownloadTarget } from '../../core/DownloadTargets';
import { downloadOptionLabel, keepPresets, keepUntilFromPreset, validQuality } from '../../core/DownloadEngine';
import type { DownloadOption, KeepPreset } from '../../core/DownloadEngine';
import { playlistsForKind } from '../../core/Playlists';
import type { PlaylistResponse } from '../../core/Types/Playlists';

const TITLE_ACTIONS: ActionItem[] = [
  { id: 'play', glyph: '▶', label: 'Play' },
  { id: 'download', glyph: '⇩', label: 'Download' },
  { id: 'playlist', glyph: '＋', label: 'Add to Playlist' },
  { id: 'watched', glyph: '✓', label: 'Mark as watched' },
  { id: 'unwatched', glyph: '○', label: 'Mark as unwatched' },
];

const SECTION_WIDTH: number = 268;
const TEXT_SIZE: number = 13.44;
const PILL_HEIGHT: number = 44;
const PILL_PADDING: number = 17.28;
const PILL_SIZE: number = 12.48;
const SECTION_GAP: number = 16;

@Component
export struct TitleActionsDrawer {
  @Prop workId: string = '';
  @Prop workTitle: string = '';
  onClose: () => void = () => {};
  onPlay: (workId: string) => void = () => {};
  /** Called after a watched or unwatched write finished (or failed), so the page can reload its marks. */
  onWatchedChanged: () => void = () => {};

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  /** The step: 'actions', 'quality' or 'playlists'. */
  @State private view: string = 'actions';
  @State private busyId: string = '';
  @State private notice: string = '';
  @State private workKind: string = '';
  @State private targets: DownloadTarget[] = [];
  @State private options: DownloadOption[] = [];
  @State private qualityId: string = 'original';
  @State private keepChoice: string = 'forever';
  @State private playlists: PlaylistResponse[] = [];

  private async choose(id: string): Promise<void> {
    if (this.busyId.length > 0) {
      return;
    }
    if (id === 'play') {
      this.onClose();
      this.onPlay(this.workId);
      return;
    }
    if (id === 'download') {
      await this.openQuality();
      return;
    }
    if (id === 'playlist') {
      await this.openPlaylists();
      return;
    }
    this.busyId = id;
    await setWorkWatched(this.workId, id === 'watched');
    this.busyId = '';
    this.onClose();
    this.onWatchedChanged();
  }

  /** Loads what the title downloads and the qualities its first file offers (they are the same for every file). */
  private async openQuality(): Promise<void> {
    this.busyId = 'download';
    this.notice = '';
    const detail = await getWorkDetail(this.workId);
    if (detail.kind !== 'ok') {
      this.busyId = '';
      this.notice = 'This title could not be loaded.';
      return;
    }
    this.workKind = detail.value.work.kind;
    this.targets = downloadTargets(detail.value);
    if (this.targets.length === 0) {
      this.busyId = '';
      this.notice = 'Nothing in this title can be downloaded yet.';
      return;
    }
    const result = await getDownloadOptions(this.targets[0].mediaFileId);
    this.busyId = '';
    if (result.kind !== 'ok') {
      this.notice = result.kind === 'http_failure' && result.status === 403 ?
        'Downloads are not allowed for this account.' : 'The download choices could not be loaded.';
      return;
    }
    this.options = result.value.options;
    this.qualityId = validQuality(this.options, 'original');
    this.keepChoice = 'forever';
    this.view = 'quality';
  }

  private confirmDownload(): void {
    const keepUntil = keepUntilFromPreset(this.keepChoice, Date.now());
    for (const target of this.targets) {
      enqueueDownload(target.mediaFileId, this.workId, target.title, this.workKind, this.qualityId, keepUntil);
    }
    this.onClose();
  }

  private async openPlaylists(): Promise<void> {
    this.busyId = 'playlist';
    this.notice = '';
    const detail = await getWorkDetail(this.workId);
    const result = await listPlaylists();
    this.busyId = '';
    if (detail.kind !== 'ok' || result.kind !== 'ok') {
      this.notice = 'Playlists could not be loaded.';
      return;
    }
    this.workKind = detail.value.work.kind;
    this.playlists = playlistsForKind(result.value, this.workKind, false);
    if (this.playlists.length === 0) {
      this.notice = 'You have no playlists for this kind of title yet. Create one on the Playlists page.';
      return;
    }
    this.view = 'playlists';
  }

  private async addTo(playlistId: string): Promise<void> {
    if (this.busyId.length > 0) {
      return;
    }
    this.busyId = playlistId;
    const result = await addPlaylistItem(playlistId, this.workId, null);
    this.busyId = '';
    if (result.kind === 'ok') {
      this.onClose();
      return;
    }
    this.notice = result.kind === 'http_failure' && result.status === 409 ?
      'It is already in that playlist.' : 'It could not be added to that playlist.';
  }

  private optionChoices(): Choice[] {
    return this.options.map((option: DownloadOption): Choice => ({ value: option.id, label: downloadOptionLabel(option, this.targets.length) }));
  }

  private keepChoices(): Choice[] {
    return keepPresets(Date.now()).map((preset: KeepPreset): Choice => ({ value: preset.value, label: preset.label }));
  }

  private playlistActions(): ActionItem[] {
    return this.playlists.map((playlist: PlaylistResponse): ActionItem => ({ id: playlist.id, glyph: '＋', label: playlist.name }));
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
  private noticeText(): void {
    if (this.notice.length > 0) {
      Text(this.notice)
        .fontSize(tv(TEXT_SIZE))
        .fontColor(toResourceColor(activeColors().danger))
        .width(tv(SECTION_WIDTH))
    }
  }

  @Builder
  private body(): void {
    Column({ space: tv(SECTION_GAP) }) {
      if (this.view === 'quality') {
        Text(this.targets.length > 1 ? 'Download ' + String(this.targets.length) + ' items' : 'Download')
          .fontSize(tv(TEXT_SIZE))
          .fontColor(toResourceColor(activeColors().inkSoft))
          .width(tv(SECTION_WIDTH))
        SelectField({
          options: this.optionChoices(),
          value: this.qualityId,
          selectWidth: SECTION_WIDTH,
          onChange: (value: string): void => {
            this.qualityId = value;
          },
        })
        SelectField({
          options: this.keepChoices(),
          value: this.keepChoice,
          selectWidth: SECTION_WIDTH,
          onChange: (value: string): void => {
            this.keepChoice = value;
          },
        })
        this.pill('Download', (): void => {
          this.confirmDownload();
        })
        this.pill('Back', (): void => {
          this.view = 'actions';
        })
      } else if (this.view === 'playlists') {
        ActionList({
          actions: this.playlistActions(),
          busyId: this.busyId,
          onChoose: (id: string): void => {
            this.addTo(id);
          },
        })
        this.pill('Back', (): void => {
          this.view = 'actions';
          this.notice = '';
        })
      } else {
        ActionList({
          actions: TITLE_ACTIONS,
          busyId: this.busyId,
          onChoose: (id: string): void => {
            this.choose(id);
          },
        })
      }
      this.noticeText()
    }
    .alignItems(HorizontalAlign.Start)
  }

  build() {
    Drawer({
      kicker: this.view === 'quality' ? 'Download' : (this.view === 'playlists' ? 'Add to Playlist' : 'Title actions'),
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
