/**
 * Playlists (web `pages/Playlists.tsx`, TV layout): the viewer's playlists as rows (name, media class and whether it is
 * a System playlist, then the playlists nested in it), and opening one lists its items in order with an Open pill to
 * each title. Management as web: New playlist (a name, in a drawer), and in an open playlist Play all, Rename, Delete
 * (after a confirmation), and per item Up, Down and Remove. System playlists are managed by administrators only, so
 * a refused change shows the server's refusal as a message. Not here: adding titles (that is the title actions
 * panel's job) and moving a playlist between parents.
 */

import { nunito } from '../design/Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { tv } from '../design/Metrics';
import { PageShell } from '../design/components/PageShell';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';
import { Drawer } from '../design/components/Drawer';

import { getWorkDetail } from '../data/CatalogRepository';
import {
  listPlaylists,
  listPlaylistItems,
  createPlaylist,
  renamePlaylist,
  deletePlaylist,
  reorderPlaylistItems,
  removePlaylistItem,
} from '../data/PlaylistsRepository';
import { topLevelPlaylists, childPlaylists, playlistCaption, itemsInOrder, itemMediaFileId, moveId } from '../core/Playlists';
import type { QueueItem } from '../core/EndOfPlayback';
import type { PlaylistResponse } from '../core/Types/Playlists';

import { PLAYLISTS_NAV_ID } from '../navigation/NavItems';
import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams, PlayerRouteParams } from '../navigation/Routes';
import { getNavStack, pushRoute } from '../navigation/NavStack';

// Rows start where Search's results do: (826, 173), 1042 wide (the shared list look: Watchlist, Requests).
const LIST_LEFT: number = 826;
const LIST_TOP: number = 173;
const LIST_WIDTH: number = 1042;
const ROW_GAP: number = 11.52;
const ROW_PADDING: number = 19.2;
const ROW_RADIUS: number = 14;
const ROW_BG_ALPHA: number = 0.45;
const TITLE_SIZE_ROW: number = 16.32;
const META_SIZE: number = 13.4;
const COPY_GAP: number = 5.76;
const PILL_HEIGHT: number = 44;
const PILL_PADDING: number = 17.28;
const PILL_SIZE: number = 12.48;
const PILL_GAP: number = 9.6;
const PANEL_TEXT_SIZE: number = 13.44;
const MESSAGE_LEFT: number = 826;
const MESSAGE_TOP: number = 312;

type PlaylistsPhase = 'loading' | 'ready' | 'error';

/** One resolved item of an open playlist: its title (the work's) and the work to open. */
class ItemRow {
  public id: string = '';
  public title: string = '';
  public workId: string = '';
  /** The file Play all plays for this item; '' when nothing is playable yet. */
  public mediaFileId: string = '';
  /** Audio chains with no card (web's end-of-playback rule for tracks). */
  public immediate: boolean = false;
}

@Component
export struct PlaylistsScreen {
  @State private phase: PlaylistsPhase = 'loading';
  @State private playlists: PlaylistResponse[] = [];
  /** The open playlist's id, or '' for the directory. */
  @State private openId: string = '';
  @State private itemsPhase: PlaylistsPhase = 'loading';
  @State private items: ItemRow[] = [];
  /** The open drawer: 'create', 'rename' or 'delete'; '' for none. */
  @State private drawer: string = '';
  @State private nameDraft: string = '';
  @State private busy: boolean = false;
  @State private notice: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.phase = 'loading';
    const result = await listPlaylists();
    if (result.kind === 'ok') {
      this.playlists = result.value;
      this.phase = 'ready';
    } else {
      this.phase = 'error';
    }
  }

  private openedPlaylist(): PlaylistResponse | undefined {
    for (const playlist of this.playlists) {
      if (playlist.id === this.openId) {
        return playlist;
      }
    }
    return undefined;
  }

  private async open(id: string): Promise<void> {
    this.openId = id;
    this.itemsPhase = 'loading';
    this.items = [];
    const result = await listPlaylistItems(id);
    if (result.kind !== 'ok') {
      this.itemsPhase = 'error';
      return;
    }
    const rows: ItemRow[] = [];
    for (const item of itemsInOrder(result.value)) {
      const row = new ItemRow();
      row.id = item.id;
      row.workId = item.work_id;
      const detail = await getWorkDetail(item.work_id);
      row.title = detail.kind === 'ok' ? detail.value.work.title : 'Unavailable title';
      if (detail.kind === 'ok') {
        const fileId = itemMediaFileId(detail.value, item.track_id);
        row.mediaFileId = fileId !== null ? fileId : '';
        row.immediate = detail.value.work.kind === 'artist';
      }
      rows.push(row);
    }
    if (this.openId === id) {
      this.items = rows;
      this.itemsPhase = 'ready';
    }
  }

  /** Runs one change, reports a refusal, and reloads. */
  private async change(run: () => Promise<boolean>, after: () => void): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.notice = '';
    const ok = await run();
    this.busy = false;
    if (!ok) {
      this.notice = 'The change could not be made. System playlists can only be changed by an administrator.';
      return;
    }
    after();
  }

  private async saveName(): Promise<void> {
    const name = this.nameDraft.trim();
    if (name.length === 0) {
      return;
    }
    const opened = this.openedPlaylist();
    const creating = this.drawer === 'create';
    await this.change(async (): Promise<boolean> => {
      if (creating) {
        // A new playlist inside an open one nests under it and shares its media class; at the top it is video.
        const result = await createPlaylist(name, opened !== undefined ? opened.media_type : 'video', opened !== undefined ? opened.id : null);
        return result.kind === 'ok';
      }
      if (opened === undefined) {
        return false;
      }
      const result = await renamePlaylist(opened.id, name, opened.parent_playlist_id !== undefined ? opened.parent_playlist_id : null);
      return result.kind === 'ok';
    }, (): void => {
      this.drawer = '';
      this.load();
    });
  }

  private async removeOpened(): Promise<void> {
    const opened = this.openedPlaylist();
    if (opened === undefined) {
      return;
    }
    await this.change(async (): Promise<boolean> => {
      const result = await deletePlaylist(opened.id);
      return result.kind === 'ok';
    }, (): void => {
      this.drawer = '';
      this.openId = '';
      this.load();
    });
  }

  private async moveItem(index: number, delta: number): Promise<void> {
    const ids: string[] = this.items.map((row: ItemRow): string => row.id);
    const next = moveId(ids, index, delta);
    if (next.join(',') === ids.join(',')) {
      return;
    }
    const playlistId = this.openId;
    await this.change(async (): Promise<boolean> => {
      const result = await reorderPlaylistItems(playlistId, next);
      return result.kind === 'ok';
    }, (): void => {
      const reordered: ItemRow[] = [];
      for (const id of next) {
        for (const row of this.items) {
          if (row.id === id) {
            reordered.push(row);
          }
        }
      }
      this.items = reordered;
    });
  }

  private async removeItem(itemId: string): Promise<void> {
    const playlistId = this.openId;
    await this.change(async (): Promise<boolean> => {
      const result = await removePlaylistItem(playlistId, itemId);
      return result.kind === 'ok';
    }, (): void => {
      this.items = this.items.filter((row: ItemRow): boolean => row.id !== itemId);
    });
  }

  /** Plays the first playable item and queues the rest (web's Play all). */
  private playAll(): void {
    const playable: ItemRow[] = this.items.filter((row: ItemRow): boolean => row.mediaFileId.length > 0);
    if (playable.length === 0) {
      this.notice = 'Nothing in this playlist can be played yet.';
      return;
    }
    const queue: QueueItem[] = [];
    for (let i = 1; i < playable.length; i++) {
      const next: QueueItem = {
        mediaFileId: playable[i].mediaFileId,
        workId: playable[i].workId,
        title: playable[i].title,
        immediate: playable[i].immediate,
      };
      queue.push(next);
    }
    const params: PlayerRouteParams = {
      mediaFileId: playable[0].mediaFileId,
      workId: playable[0].workId,
      queue: queue,
    };
    pushRoute(getNavStack(), ROUTES.Player, params);
  }

  private openTitle(workId: string): void {
    const params: DetailRouteParams = { workId: workId };
    pushRoute(getNavStack(), ROUTES.Detail, params);
  }

  /** The playlists shown: the directory's top level, or the open playlist's nested ones. */
  private shownPlaylists(): PlaylistResponse[] {
    return this.openId.length === 0 ? topLevelPlaylists(this.playlists) : childPlaylists(this.playlists, this.openId);
  }

  @Builder
  private pill(label: string, onTap: () => void): void {
    Text(label).fontFamily(nunito(400))
      .fontSize(tv(PILL_SIZE))
      .fontColor(toResourceColor(activeColors().ink))
      .height(tv(PILL_HEIGHT))
      .padding({ left: tv(PILL_PADDING), right: tv(PILL_PADDING) })
      .borderRadius(tv(PILL_HEIGHT / 2))
      .backgroundColor(toResourceColor(activeColors().surfaceSoft))
      .focusable(true)
      .onClick(onTap)
  }

  @Builder
  private rowShell(title: string, meta: string, actionLabel: string, onAction: () => void): void {
    Row() {
      Column({ space: tv(COPY_GAP) }) {
        Text(title).fontFamily(nunito(700))
          .fontSize(tv(TITLE_SIZE_ROW))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (meta.length > 0) {
          Text(meta).fontFamily(nunito(400))
            .fontSize(tv(META_SIZE))
            .fontColor(toResourceColor(activeColors().inkMuted))
        }
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
      this.pill(actionLabel, onAction)
    }
    .width(tv(LIST_WIDTH))
    .padding(tv(ROW_PADDING))
    .borderRadius(tv(ROW_RADIUS))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, ROW_BG_ALPHA))
    .alignItems(VerticalAlign.Center)
  }

  @Builder
  private itemRow(item: ItemRow, index: number): void {
    Row({ space: tv(PILL_GAP) }) {
      Text(item.title).fontFamily(nunito(700))
        .fontSize(tv(TITLE_SIZE_ROW))
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().ink))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      this.pill('Open', (): void => {
        this.openTitle(item.workId);
      })
      this.pill('Up', (): void => {
        this.moveItem(index, -1);
      })
      this.pill('Down', (): void => {
        this.moveItem(index, 1);
      })
      this.pill('Remove', (): void => {
        this.removeItem(item.id);
      })
    }
    .width(tv(LIST_WIDTH))
    .padding(tv(ROW_PADDING))
    .borderRadius(tv(ROW_RADIUS))
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, ROW_BG_ALPHA))
    .alignItems(VerticalAlign.Center)
  }

  /** The drawer for a name (New playlist, Rename) or the delete confirmation. */
  @Builder
  private drawerBody(): void {
    Column({ space: tv(16) }) {
      if (this.drawer === 'delete') {
        Text('Deleting removes this playlist and its nested playlists. Titles in it are not deleted.').fontFamily(nunito(400))
          .fontSize(tv(PANEL_TEXT_SIZE))
          .fontColor(toResourceColor(activeColors().inkSoft))
          .width(tv(268))
        this.pill('Delete playlist', (): void => {
          this.removeOpened();
        })
      } else {
        TextInput({ text: this.nameDraft, placeholder: 'Playlist name' })
          .fontSize(tv(15.36))
          .fontColor(toResourceColor(activeColors().ink))
          .placeholderColor(toResourceColor(activeColors().inkMuted))
          .backgroundColor(toResourceColor(activeColors().surfaceSoft))
          .width(tv(268))
          .height(tv(PILL_HEIGHT + 8))
          .defaultFocus(true)
          .onChange((value: string) => {
            this.nameDraft = value;
          })
        this.pill('Save', (): void => {
          this.saveName();
        })
      }
      this.pill('Cancel', (): void => {
        this.drawer = '';
      })
      if (this.notice.length > 0) {
        Text(this.notice).fontFamily(nunito(400))
          .fontSize(tv(PANEL_TEXT_SIZE))
          .fontColor(toResourceColor(activeColors().danger))
          .width(tv(268))
      }
    }
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private message(title: string, description: string): void {
    Column({ space: tv(8) }) {
      Text(title).fontFamily(nunito(500))
        .fontSize(tv(26.4))
        .fontWeight(FontWeight.Medium)
        .letterSpacing(tv(-0.924))
        .fontColor(toResourceColor(activeColors().ink))
      if (description.length > 0) {
        Text(description).fontFamily(nunito(400))
          .fontSize(tv(13.824))
          .fontColor(toResourceColor(activeColors().inkSoft))
      }
    }
    .alignItems(HorizontalAlign.Start)
    .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
  }

  @Builder
  private pageContent(): void {
    if (this.phase === 'loading') {
      AsyncState({ kind: AsyncStateKind.Loading })
        .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else if (this.phase === 'error') {
      AsyncState({
        kind: AsyncStateKind.Error,
        message: "Couldn't load your playlists",
        retryLabel: 'Try again',
        retry: (): void => {
          this.load();
        },
      })
        .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else if (this.openId.length > 0 && this.itemsPhase === 'loading') {
      AsyncState({ kind: AsyncStateKind.Loading })
        .position({ x: tv(MESSAGE_LEFT), y: tv(MESSAGE_TOP) })
    } else if (this.openId.length > 0 && this.itemsPhase === 'error') {
      this.message("Couldn't load this playlist", 'Go back to all playlists and try again.')
    } else if (this.openId.length === 0 && this.shownPlaylists().length === 0) {
      this.message('No playlists yet', 'Playlists you create or that your server shares show up here.')
    } else {
      List({ space: tv(ROW_GAP) }) {
        ListItem() {
          Row({ space: tv(PILL_GAP) }) {
            if (this.openId.length > 0) {
              this.pill('All playlists', (): void => {
                this.openId = '';
                this.notice = '';
              })
              this.pill('Play all', (): void => {
                this.playAll();
              })
              this.pill('Rename', (): void => {
                this.nameDraft = this.openedPlaylist() !== undefined ? (this.openedPlaylist() as PlaylistResponse).name : '';
                this.notice = '';
                this.drawer = 'rename';
              })
              this.pill('Delete', (): void => {
                this.notice = '';
                this.drawer = 'delete';
              })
            }
            this.pill('New playlist', (): void => {
              this.nameDraft = '';
              this.notice = '';
              this.drawer = 'create';
            })
          }
        }
        if (this.notice.length > 0 && this.drawer === '') {
          ListItem() {
            Text(this.notice).fontFamily(nunito(400))
              .fontSize(tv(META_SIZE))
              .fontColor(toResourceColor(activeColors().danger))
          }
        }
        ForEach(this.shownPlaylists(), (playlist: PlaylistResponse) => {
          ListItem() {
            this.rowShell(playlist.name, playlistCaption(playlist), 'Open', (): void => {
              this.open(playlist.id);
            })
          }
        }, (playlist: PlaylistResponse): string => playlist.id)
        if (this.openId.length > 0) {
          ForEach(this.items, (item: ItemRow, index: number) => {
            ListItem() {
              this.itemRow(item, index)
            }
          }, (item: ItemRow): string => item.id)
          if (this.items.length === 0 && this.shownPlaylists().length === 0) {
            ListItem() {
              Text('This playlist is empty.').fontFamily(nunito(400))
                .fontSize(tv(META_SIZE))
                .fontColor(toResourceColor(activeColors().inkSoft))
            }
          }
        }
      }
      .width(tv(LIST_WIDTH))
      .height(tv(1080))
      .padding({ top: tv(LIST_TOP), bottom: tv(LIST_TOP) })
      .scrollBar(BarState.Off)
      .position({ x: tv(LIST_LEFT), y: 0 })
    }
    if (this.drawer.length > 0) {
      Drawer({
        kicker: 'Playlists',
        title: this.drawer === 'create' ? 'New playlist' : (this.drawer === 'rename' ? 'Rename playlist' : 'Delete playlist'),
        onClose: (): void => {
          this.drawer = '';
        },
        body: (): void => {
          this.drawerBody();
        },
      })
    }
  }

  build() {
    NavDestination() {
      PageShell({
        title: this.openedPlaylist() !== undefined ? (this.openedPlaylist() as PlaylistResponse).name : 'Playlists',
        selectedId: PLAYLISTS_NAV_ID,
        kicker: this.openedPlaylist() !== undefined ? playlistCaption(this.openedPlaylist() as PlaylistResponse) : '',
        content: (): void => {
          this.pageContent();
        },
      })
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Playlists` route's `buildFunction`. */
@Builder
export function PlaylistsBuilder(): void {
  PlaylistsScreen()
}
