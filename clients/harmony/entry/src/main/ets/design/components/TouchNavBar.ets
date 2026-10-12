/**
 * The phone's bottom navigation bar (web phone shell): one full-width bar at the foot of every page, holding the
 * profile avatar and the same destinations as the TV rail, icon only, the current one in a lighter rounded tile. It
 * scrolls sideways when the destinations do not fit. The kinds come from `GET /api/v1/catalog/kinds` like the rail.
 * Sizes are web CSS px, which are vp on the phone profile.
 */

import { activeColors, tintFilter, toResourceColor, toResourceColorWithAlpha } from '../Theme';
import type { ThemeModeSetting } from '../Theme';
import { ProfileAvatar } from './ProfileAvatar';
import { PROFILE_NAV_ID } from './NavRail';
import type { NavRailItem } from './NavRail';
import { resolveAvatarPreset } from '../../core/AvatarPreset';
import { getCatalogKinds } from '../../data/CatalogRepository';
import { buildNavRailItems, buildPrimaryNavItems, buildSecondaryNavItems, navigateFromRail } from '../../navigation/NavItems';

const BAR_HEIGHT: number = 64;
/** The bar spans the page less its 12 vp side margins. */
const NAV_WIDTH: string = 'calc(100% - 24vp)';
const TILE_WIDTH: number = 46;
const TILE_HEIGHT: number = 44;
const TILE_RADIUS: number = 14;
const ICON_SIZE: number = 22;
const AVATAR_SIZE: number = 28;

@Component
export struct TouchNavBar {
  /** The current page's nav id (home, a kind, calendar, search ...); empty selects none. */
  @Prop selectedId: string = '';

  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('currentProfileId') private profileId: string = '';

  @State private items: NavRailItem[] = [];

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    const kinds = await getCatalogKinds();
    const library: NavRailItem[] = buildNavRailItems(kinds.kind === 'ok' ? kinds.value : []);
    const home: NavRailItem[] = library.slice(0, 1);
    const kindItems: NavRailItem[] = library.slice(1);
    const secondary: NavRailItem[] = buildSecondaryNavItems();
    // Web order: Downloads, Search, Home, the library kinds, then Calendar and the rest.
    this.items = buildPrimaryNavItems().concat(home, kindItems, secondary.filter((i: NavRailItem): boolean => i.id === 'calendar'),
      secondary.filter((i: NavRailItem): boolean => i.id !== 'calendar'));
  }

  @Builder
  private tile(item: NavRailItem): void {
    Column() {
      Image(item.icon)
        .width(ICON_SIZE)
        .height(ICON_SIZE)
        .objectFit(ImageFit.Contain)
        .colorFilter(tintFilter(item.id === this.selectedId ? activeColors().bg : activeColors().inkMuted))
        .draggable(false)
        .focusable(false)
    }
    .width(TILE_WIDTH)
    .height(TILE_HEIGHT)
    .justifyContent(FlexAlign.Center)
    .borderRadius(TILE_RADIUS)
    .backgroundColor(item.id === this.selectedId ? toResourceColor(activeColors().ink) : Color.Transparent)
    .onClick(() => {
      navigateFromRail(item.id, this.selectedId);
    })
  }

  build() {
    Row() {
      Scroll() {
        Row({ space: 4 }) {
          Column() {
            ProfileAvatar({ presetId: resolveAvatarPreset(this.profileId), diameter: AVATAR_SIZE })
              .focusable(false)
          }
          .width(TILE_WIDTH)
          .height(TILE_HEIGHT)
          .justifyContent(FlexAlign.Center)
          .onClick(() => {
            navigateFromRail(PROFILE_NAV_ID, this.selectedId);
          })
          ForEach(this.items, (item: NavRailItem) => {
            this.tile(item)
          }, (item: NavRailItem): string => item.id)
        }
        .padding({ left: 8, right: 8 })
      }
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
      .width('100%')
      .height(BAR_HEIGHT)
    }
    .width(NAV_WIDTH)
    .height(BAR_HEIGHT)
    .alignItems(VerticalAlign.Center)
    .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceStrong, 0.94))
    .borderRadius(32)
    .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
    .margin({ left: 12, right: 12, bottom: 12, top: 4 })
  }
}
