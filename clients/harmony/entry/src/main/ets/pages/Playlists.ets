/**
 * Playlists (web `pages/Playlists.tsx`, TV layout, read-only): the viewer's playlists as rows (name, media class and
 * whether it is a System playlist, then the playlists nested in it), and opening one lists its items in order with an
 * Open pill to each title. Not here: creating, renaming, reordering and removing (web's management actions) and
 * playing a whole playlist.
 */

import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { tv } from '../design/Metrics';
import { PageShell } from '../design/components/PageShell';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import { getWorkDetail } from '../data/CatalogRepository';
import { listPlaylists, listPlaylistItems } from '../data/PlaylistsRepository';
import { topLevelPlaylists, childPlaylists, playlistCaption, itemsInOrder } from '../core/Playlists';
import type { PlaylistResponse } from '../core/Types/Playlists';

import { PLAYLISTS_NAV_ID } from '../navigation/NavItems';
import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams } from '../navigation/Routes';
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
const MESSAGE_LEFT: number = 826;
const MESSAGE_TOP: number = 312;

type PlaylistsPhase = 'loading' | 'ready' | 'error';

/** One resolved item of an open playlist: its title (the work's) and the work to open. */
class ItemRow {
  public id: string = '';
  public title: string = '';
  public workId: string = '';
}

@Component
export struct PlaylistsScreen {
  @State private phase: PlaylistsPhase = 'loading';
  @State private playlists: PlaylistResponse[] = [];
  /** The open playlist's id, or '' for the directory. */
  @State private openId: string = '';
  @State private itemsPhase: PlaylistsPhase = 'loading';
  @State private items: ItemRow[] = [];

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
      rows.push(row);
    }
    if (this.openId === id) {
      this.items = rows;
      this.itemsPhase = 'ready';
    }
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
    Text(label)
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
        Text(title)
          .fontSize(tv(TITLE_SIZE_ROW))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().ink))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (meta.length > 0) {
          Text(meta)
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
  private message(title: string, description: string): void {
    Column({ space: tv(8) }) {
      Text(title)
        .fontSize(tv(26.4))
        .fontWeight(FontWeight.Medium)
        .letterSpacing(tv(-0.924))
        .fontColor(toResourceColor(activeColors().ink))
      if (description.length > 0) {
        Text(description)
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
        if (this.openId.length > 0) {
          ListItem() {
            this.pill('All playlists', (): void => {
              this.openId = '';
            })
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
          ForEach(this.items, (item: ItemRow) => {
            ListItem() {
              this.rowShell(item.title, '', 'Open', (): void => {
                this.openTitle(item.workId);
              })
            }
          }, (item: ItemRow): string => item.id)
          if (this.items.length === 0 && this.shownPlaylists().length === 0) {
            ListItem() {
              Text('This playlist is empty.')
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
