/**
 * The release calendar (web `pages/Calendar.tsx`). TV opens on the agenda: 30 days from today grouped by local
 * day, each entry a card whose left border shows availability (have it versus not, never the library), with a
 * details panel on the left that follows focus. The Filters drawer switches to the week view (seven day
 * columns) or the month view (a grid of whole weeks with one line per entry). Previous/Today/Next page by
 * the view's period, as web. Rules live in `core/CalendarAgenda.ts`; geometry copies the live web TV DOM.
 *
 * Not yet here (13.10016): the range picker, series-per-day grouping, type/status filters, the details
 * panel's actions and the Calendar link tile.
 */

import { nunito } from '../design/Typography';
import { activeColors, toResourceColor, toResourceColorWithAlpha } from '../design/Theme';
import { ActionTile } from '../design/components/ActionTile';
import { Drawer } from '../design/components/Drawer';
import { CalendarLinkPanel } from '../design/components/CalendarLinkPanel';
import { PeriodPicker } from '../design/components/PeriodPicker';
import { ChoiceSegments } from '../design/components/ChoiceSegments';
import type { Choice } from '../design/components/ChoiceSegments';
import { MultiSelect } from '../design/components/MultiSelect';
import {
  CALENDAR_STATUSES,
  CALENDAR_TYPE_PARAMS,
  activeFilterCount,
  applyCalendarFilters,
  calendarStatusLabel,
  calendarTypeLabel,
} from '../core/CalendarFilters';
import type { CalendarFilters } from '../core/CalendarFilters';
import { BRAND_PINK } from '../core/Tokens';
import type { RgbaColor } from '../core/Tokens';
import type { ThemeModeSetting } from '../design/Theme';
import { isTvMetrics, tv, TvGeometry } from '../design/Metrics';
import { PageShell } from '../design/components/PageShell';
import { TouchIconButton } from '../design/components/TouchIconButton';
import { Stage } from '../design/components/Stage';
import { AsyncState, AsyncStateKind } from '../design/components/AsyncState';

import { getCalendar } from '../data/CalendarRepository';
import { addToWatchlist, removeFromWatchlist, resolveTitle } from '../data/WatchlistRepository';
import { planItemActions } from '../core/CalendarActions';
import type { CalendarActionPlan } from '../core/CalendarActions';

import {
  addDays,
  buildMonthGrid,
  buildWeekDays,
  dayHeading,
  dayOfMonth,
  rangeLabel,
  shiftAnchor,
  startOfMonth,
  visibleRange,
  WEEKDAY_SHORT,
  groupSeriesEpisodes,
  itemAvailable,
  itemLineText,
  itemPillTone,
  itemSubtitle,
  entryPillTone,
  entrySubtitle,
  entryTimeLabel,
  entryWhenLabel,
  groupByLocalDay,
  localDayOf,
  mediaKindLabel,
  pillLabel,
  releaseTypeLabel,
} from '../core/CalendarAgenda';
import type { CalendarCell, CalendarItem, CalendarView, DayGroup, EntryPillTone } from '../core/CalendarAgenda';
import type { CalendarEntry } from '../core/Types/Calendar';

import { CALENDAR_NAV_ID } from '../navigation/NavItems';
import { ROUTES } from '../navigation/Routes';
import type { DetailRouteParams, PlayerRouteParams } from '../navigation/Routes';
import { getNavStack, pushRoute } from '../navigation/NavStack';

// Web `.calendar-days-agenda`: from x=783 (53 into the x=730 column), first day heading at y=162, 1033 wide.
const LIST_INSET_LEFT: number = 53;
const LIST_TOP: number = 162;
const LIST_WIDTH: number = 1033;
const LIST_BOTTOM: number = 40;
// Day heading 18.4/640 on a 44 high band; 32 from the band to the first card; 32 between days; 14 between cards.
const DAY_HEADING_SIZE: number = 18.4;
const DAY_HEADING_HEIGHT: number = 44;
const DAY_HEADING_GAP: number = 32;
const DAY_GAP: number = 32;
const ENTRY_GAP: number = 13;
const TODAY_TAG_SIZE: number = 11.2;
const TODAY_TAG_LETTER_SPACING: number = 0.896;
// Web `.calendar-entry`: 107 high, 12 radius, 1px line border with a 4px availability edge, surfaceStrong.
const ENTRY_HEIGHT: number = 107;
const ENTRY_RADIUS: number = 12;
const ENTRY_EDGE: number = 4;
const ENTRY_PADDING_LEFT: number = 12;
const POSTER_WIDTH: number = 40;
const POSTER_HEIGHT: number = 60;
const POSTER_RADIUS: number = 6;
const POSTER_GAP: number = 15;
const ENTRY_TITLE_SIZE: number = 19.2;
const ENTRY_META_SIZE: number = 12.8;
/** Web phone agenda card, measured on the 360 vp reference: smaller type and a 92 vp card than the TV's. */
const PHONE_ENTRY_TITLE_SIZE: number = 16;
const PHONE_ENTRY_META_SIZE: number = 14;
const PHONE_ENTRY_HEIGHT: number = 92;
/** A card without a subtitle line (a movie) is 15 vp shorter on web. */
const PHONE_ENTRY_HEIGHT_NO_SUBTITLE: number = 77;
const PHONE_PILL_SIZE: number = 11.2;
const PHONE_PILL_HEIGHT: number = 22.5;
const PHONE_DAY_HEADING_SIZE: number = 14.4;
const PHONE_ENTRY_GAP: number = 15;
const PHONE_ENTRY_TEXT_GAP: number = 3;
const PHONE_AGENDA_CARD_MIN_WIDTH: number = 390;
const PHONE_CONTROL_FONT: number = 11.2;
const ENTRY_META_GAP: number = 12;
// Web `.status-pill`: 13.44/750, tone at 14% over the surface with a 60% tone border.
const PILL_SIZE: number = 13.44;
const PILL_HEIGHT: number = 27;
const PILL_PADDING_H: number = 10;
// Header controls: web `.page-actions-navigation`, 50 high pills at the right edge.
const HEADER_CONTROL_SIZE: number = 50;
const HEADER_CONTROL_FONT: number = 14.72;
const HEADER_CONTROL_GAP: number = 15;
const HEADER_RIGHT: number = 1844;
// Web's period panel: under the range button (its right edge at about x=1609), 8 below it.
const PERIOD_PANEL_LEFT: number = 1297;
const PERIOD_PANEL_TOP: number = 114;
// Details panel extras under the meta line.
const PANEL_GAP: number = 17;
const OVERVIEW_SIZE: number = 13.824;
const OVERVIEW_LINE_HEIGHT: number = 22;
const OVERVIEW_MAX_LINES: number = 5;
const OVERVIEW_WIDTH: number = 348;
// Web details panel buttons: 58 high pills, 14.72/720.
const PANEL_BUTTON_HEIGHT: number = 58;
const PANEL_BUTTON_FONT: number = 14.72;
const PANEL_BUTTON_PADDING: number = 21;
const PANEL_BUTTON_GAP: number = 10;

// Web `.calendar-days-week` and `.calendar-month`: from (154, 174), 1663 wide, 787 high.
const GRID_LEFT: number = 154;
const GRID_TOP: number = 174;
const GRID_WIDTH: number = 1663;
const GRID_HEIGHT: number = 787;
const WEEK_COLUMN_WIDTH: number = 440;
const WEEK_COLUMN_GAP: number = 20;
const WEEK_HEADING_HEIGHT: number = 28;
const WEEK_HEADING_GAP: number = 6;
const MONTH_HEAD_HEIGHT: number = 31;
const MONTH_WEEKDAY_SIZE: number = 12;
const MONTH_LINE_HEIGHT: number = 25;
const TOUCH_MONTH_LINE_HEIGHT: number = 22;
const MONTH_LINE_SIZE: number = 12.48;
const MONTH_DOT_SIZE: number = 9;
const MONTH_FOOT_HEIGHT: number = 44;
/** Conservative phone cell inset: 2vp top padding plus a 2vp border on each edge. */
const TOUCH_MONTH_CELL_VERTICAL_INSET: number = 6;
const MONTH_CELL_PADDING: number = 5;
const MONTH_DAY_SIZE: number = 12.8;

/** Web phone month track minimum width, shared by the weekday header and every week row. */
const TOUCH_MONTH_GRID_MIN_WIDTH: number = 720;

// Web drawer: 30 px between filter sections; choice tiles 56 px, 12 px radius, 10.56 px labels, 268 wide.
const FILTER_SECTION_GAP: number = 30;
const FILTER_WIDTH: number = 268;
const CHOICE_HEIGHT: number = 56;
const CHOICE_RADIUS: number = 12;
const CHOICE_FONT: number = 10.56;
const TYPE_CHOICES: Choice[] = CALENDAR_TYPE_PARAMS.map((value: string): Choice => {
  const choice: Choice = { value: value, label: calendarTypeLabel(value) };
  return choice;
});
const STATUS_CHOICES: Choice[] = CALENDAR_STATUSES.map((value: string): Choice => {
  const choice: Choice = { value: value, label: calendarStatusLabel(value) };
  return choice;
});
const VIEW_CHOICES: Choice[] = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** ForEach key: the day plus its entries, so a cell is rebuilt when its entries change. */
function cellKey(cell: CalendarCell): string {
  return cell.day + ':' + cell.entries.map((entry: CalendarEntry): string => entry.id).join(',');
}

/** Web `.status-pill` / `.calendar-dot` tones. */
function toneColor(tone: EntryPillTone): RgbaColor {
  if (tone === 'available') {
    return activeColors().success;
  }
  if (tone === 'upcoming') {
    return BRAND_PINK;
  }
  return tone === 'missing' ? activeColors().danger : activeColors().inkSoft;
}

/** The preview bridge can pin the capture clock (AppStorage 'clockPin', an ISO instant); '' is the real clock. */
function pinnedNow(): Date {
  const pin: string | undefined = AppStorage.get<string>('clockPin');
  return pin !== undefined && pin.length > 0 ? new Date(pin) : new Date();
}

@Component
export struct ReleaseCalendar {
  @StorageProp('colorMode') private sysColorMode: ColorMode = ColorMode.LIGHT;
  @StorageProp('themeModeSetting') private themeSetting: ThemeModeSetting = 'system';
  @StorageProp('tvScaleFactor') private trackedTvScale: number = 1;

  @State private today: string = localDayOf(pinnedNow());
  @State private anchor: string = localDayOf(pinnedNow());
  @State private touchMonthViewportHeight: number = 0;
  @State private view: CalendarView = 'agenda';
  @State private filtersOpen: boolean = false;
  @State private linkOpen: boolean = false;
  @State private periodOpen: boolean = false;
  @State private groups: DayGroup[] = [];
  /** The loaded window before filtering; `regroup` applies the filters (web filters on the client). */
  private entries: CalendarEntry[] = [];
  @State private filters: CalendarFilters = { types: [], statuses: [], monitoredOnly: false };
  @State private selected: CalendarEntry | undefined = undefined;
  @State private selectedItem: CalendarItem | undefined = undefined;
  /** Watchlist state of the selected title: from the server's action at selection, then the toggle. */
  @State private listed: boolean = false;
  @State private watchlistBusy: boolean = false;
  @State private loading: boolean = true;
  @State private errorMessage: string = '';

  aboutToAppear(): void {
    this.load();
  }

  private async load(): Promise<void> {
    this.loading = true;
    const range = visibleRange(this.view, this.anchor);
    // Entries are bucketed by local day, up to a day either side of UTC: pad the window by a day.
    const result = await getCalendar(addDays(range.start, -1), addDays(range.end, 1));
    if (result.kind === 'ok') {
      this.entries = result.value.entries;
      this.regroup();
      this.errorMessage = '';
    } else {
      this.entries = [];
      this.groups = [];
      this.select(undefined);
      this.errorMessage = 'Could not load the calendar.';
    }
    this.loading = false;
  }

  /** Filters the loaded window into day groups and selects the first item, as web on a filter change. */
  private regroup(): void {
    const range = visibleRange(this.view, this.anchor);
    this.groups = groupByLocalDay(applyCalendarFilters(this.entries, this.filters, this.today), range.start, range.end);
    const first = this.groups.length > 0 ? groupSeriesEpisodes(this.groups[0].entries)[0] : undefined;
    this.select(first);
  }

  private setFilters(filters: CalendarFilters): void {
    this.filters = filters;
    this.regroup();
  }

  private select(item: CalendarItem | undefined): void {
    this.selectedItem = item;
    this.selected = item !== undefined ? item.entries[0] : undefined;
    const plan = item !== undefined ? planItemActions(item) : undefined;
    this.listed = plan !== undefined && plan.watchlist !== null && plan.watchlist.listed;
  }

  private plan(): CalendarActionPlan | undefined {
    return this.selectedItem !== undefined ? planItemActions(this.selectedItem) : undefined;
  }

  /** Web `WatchlistToggle`: add the snapshot, or resolve it for its key and remove. */
  private async toggleWatchlist(): Promise<void> {
    const plan = this.plan();
    if (plan === undefined || plan.snapshot === null || this.watchlistBusy) {
      return;
    }
    this.watchlistBusy = true;
    if (this.listed) {
      const resolved = await resolveTitle(plan.snapshot);
      if (resolved.kind === 'ok') {
        const removed = await removeFromWatchlist(resolved.value.title.title_key);
        if (removed.kind === 'ok') {
          this.listed = false;
        }
      }
    } else {
      const added = await addToWatchlist(plan.snapshot);
      if (added.kind === 'ok') {
        this.listed = true;
      }
    }
    this.watchlistBusy = false;
  }

  private playSelected(): void {
    const plan = this.plan();
    if (plan === undefined || plan.play === null) {
      return;
    }
    const params: PlayerRouteParams = {
      mediaFileId: plan.play.mediaFileId,
      workId: plan.play.workId,
      startPositionMs: plan.play.positionMs,
    };
    pushRoute(getNavStack(), ROUTES.Player, params);
  }

  private openSelected(): void {
    const plan = this.plan();
    if (plan === undefined || plan.openWorkId === null) {
      return;
    }
    const params: DetailRouteParams = { workId: plan.openWorkId };
    pushRoute(getNavStack(), ROUTES.Detail, params);
  }

  private page(direction: number): void {
    this.anchor = direction === 0 ? this.today : shiftAnchor(this.view, this.anchor, direction);
    this.load();
  }

  private changeView(view: string): void {
    const next = view as CalendarView;
    if (next === this.view) {
      return;
    }
    this.view = next;
    this.anchor = next === 'month' ? startOfMonth(this.anchor) : this.anchor;
    this.load();
  }

  private openEntry(entry: CalendarEntry): void {
    if (entry.work_id === undefined || entry.work_id === null) {
      return;
    }
    const params: DetailRouteParams = { workId: entry.work_id };
    pushRoute(getNavStack(), ROUTES.Detail, params);
  }

  @Builder
  private statusPill(tone: EntryPillTone): void {
    Text(pillLabel(tone)).fontFamily(nunito(700))
      .fontSize(isTvMetrics() ? tv(PILL_SIZE) : PHONE_PILL_SIZE)
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().ink))
      .height(isTvMetrics() ? tv(PILL_HEIGHT) : PHONE_PILL_HEIGHT)
      .padding({ left: tv(PILL_PADDING_H), right: tv(PILL_PADDING_H) })
      .borderRadius(isTvMetrics() ? tv(PILL_HEIGHT / 2) : PHONE_PILL_HEIGHT / 2)
      .backgroundColor(toResourceColorWithAlpha(toneColor(tone), 0.14))
      .border({ width: 1, color: toResourceColorWithAlpha(toneColor(tone), 0.6) })
  }

  @Builder
  private entryCard(item: CalendarItem, width: number, phoneMinWidth: number = 0, phoneTextGap: number = 0): void {
    Row({ space: tv(POSTER_GAP) }) {
      Image(item.entries[0].poster_url !== undefined && item.entries[0].poster_url !== null ? item.entries[0].poster_url : '')
        .width(tv(POSTER_WIDTH))
        .height(tv(POSTER_HEIGHT))
        .borderRadius(tv(POSTER_RADIUS))
        .objectFit(ImageFit.Cover)
        .backgroundColor(toResourceColor(activeColors().surfaceSoft))
      Column({ space: isTvMetrics() ? 0 : phoneTextGap }) {
        Text(item.title).fontFamily(nunito(500))
          .fontSize(isTvMetrics() ? tv(ENTRY_TITLE_SIZE) : PHONE_ENTRY_TITLE_SIZE)
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColor(activeColors().ink))
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        if (isTvMetrics() || itemSubtitle(item).length > 0) {
          Text(itemSubtitle(item)).fontFamily(nunito(400))
            .fontSize(isTvMetrics() ? tv(ENTRY_TITLE_SIZE) : PHONE_ENTRY_TITLE_SIZE)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        Row({ space: tv(ENTRY_META_GAP) }) {
          Text(entryTimeLabel(item.entries[0])).fontFamily(nunito(400)).fontSize(isTvMetrics() ? tv(ENTRY_META_SIZE) : PHONE_ENTRY_META_SIZE).fontColor(toResourceColor(isTvMetrics() ? activeColors().inkMuted : activeColors().inkSoft))
          Text(releaseTypeLabel(item.entries[0].release_type)).fontFamily(nunito(400)).fontSize(isTvMetrics() ? tv(ENTRY_META_SIZE) : PHONE_ENTRY_META_SIZE).fontColor(toResourceColor(isTvMetrics() ? activeColors().inkMuted : activeColors().inkSoft))
          if (!item.grouped) {
            Text(mediaKindLabel(item.entries[0].media_kind)).fontFamily(nunito(400)).fontSize(isTvMetrics() ? tv(ENTRY_META_SIZE) : PHONE_ENTRY_META_SIZE).fontColor(toResourceColor(isTvMetrics() ? activeColors().inkMuted : activeColors().inkSoft))
          }
          this.statusPill(itemPillTone(item, this.today))
        }
        .alignItems(VerticalAlign.Center)
      }
      .alignItems(HorizontalAlign.Start)
      .layoutWeight(1)
    }
    .width(isTvMetrics() ? tv(width) : '100%')
    .constraintSize({ minWidth: isTvMetrics() ? 0 : phoneMinWidth })
    .height(isTvMetrics() ? tv(ENTRY_HEIGHT) : (itemSubtitle(item).length > 0 ? PHONE_ENTRY_HEIGHT : PHONE_ENTRY_HEIGHT_NO_SUBTITLE))
    .padding({ left: tv(ENTRY_PADDING_LEFT) })
    .borderRadius(tv(ENTRY_RADIUS))
    .backgroundColor(toResourceColor(activeColors().surfaceStrong))
    .border({
      width: { left: tv(ENTRY_EDGE), top: 1, right: 1, bottom: 1 },
      color: {
        left: toResourceColor(itemAvailable(item) ? activeColors().success : activeColors().inkMuted),
        top: toResourceColorWithAlpha(activeColors().ink, 0.08),
        right: toResourceColorWithAlpha(activeColors().ink, 0.08),
        bottom: toResourceColorWithAlpha(activeColors().ink, 0.08),
      },
    })
    .focusable(true)
    .onFocus(() => {
      this.select(item);
    })
    .onClick(() => {
      this.select(item);
      this.openEntry(item.entries[0]);
    })
  }

  @Builder
  private phoneAgendaCard(item: CalendarItem): void {
    Scroll() {
      this.entryCard(item, 0, PHONE_AGENDA_CARD_MIN_WIDTH, PHONE_ENTRY_TEXT_GAP)
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .width('100%')
  }

  @Builder
  private dayHeader(day: string): void {
    Row({ space: tv(10) }) {
      Text(dayHeading(day)).fontFamily(nunito(500))
        .fontSize(isTvMetrics() ? tv(DAY_HEADING_SIZE) : PHONE_DAY_HEADING_SIZE)
        .fontWeight(FontWeight.Medium)
        .fontColor(toResourceColorWithAlpha(activeColors().ink, day === this.today ? 0.9 : 1))
      if (day === this.today) {
        Text('Today').fontFamily(nunito(500))
          .fontSize(tv(TODAY_TAG_SIZE))
          .fontWeight(FontWeight.Medium)
          .letterSpacing(tv(TODAY_TAG_LETTER_SPACING))
          .textCase(TextCase.UpperCase)
          .fontColor(toResourceColorWithAlpha(activeColors().ink, 0.9))
          .padding({ left: tv(8), right: tv(8), top: tv(2), bottom: tv(2) })
          .borderRadius(tv(11))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.9) })
      }
    }
    .width(isTvMetrics() ? tv(LIST_WIDTH) : '100%')
    .height(tv(DAY_HEADING_HEIGHT))
    .alignItems(VerticalAlign.Center)
    .backgroundColor(toResourceColor(activeColors().bg))
  }

  @Builder
  private agenda(): void {
    if (this.loading) {
      AsyncState({ kind: AsyncStateKind.Loading })
        .width(tv(LIST_WIDTH))
        .height('100%')
        .margin({ left: tv(LIST_INSET_LEFT) })
    } else if (this.groups.length === 0) {
      AsyncState({
        kind: this.errorMessage.length > 0 ? AsyncStateKind.Error : AsyncStateKind.Empty,
        message: this.errorMessage.length > 0 ? this.errorMessage : 'Nothing is scheduled for these 30 days.',
      })
        .width(tv(LIST_WIDTH))
        .height('100%')
        .margin({ left: tv(LIST_INSET_LEFT) })
    } else {
      List({ space: tv(DAY_GAP) }) {
        ForEach(this.groups, (group: DayGroup) => {
          ListItem() {
            Column({ space: tv(ENTRY_GAP) }) {
              this.dayHeader(group.day)
              Column({ space: tv(ENTRY_GAP) }) {
                ForEach(groupSeriesEpisodes(group.entries), (item: CalendarItem) => {
                  this.entryCard(item, LIST_WIDTH)
                }, (item: CalendarItem): string => item.key)
              }
              .margin({ top: tv(DAY_HEADING_GAP - ENTRY_GAP) })
            }
            .alignItems(HorizontalAlign.Start)
          }
        }, (group: DayGroup): string => group.day + ':' + group.entries.map((entry: CalendarEntry): string => entry.id).join(','))
      }
      .width(tv(LIST_WIDTH))
      .height('100%')
      .padding({ top: tv(LIST_TOP), bottom: tv(LIST_BOTTOM) })
      .margin({ left: tv(LIST_INSET_LEFT) })
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
    }
  }

  @Builder
  private weekView(): void {
    Scroll() {
      Row({ space: tv(WEEK_COLUMN_GAP) }) {
        ForEach(buildWeekDays(this.anchor, this.groups, this.today), (cell: CalendarCell) => {
          Column({ space: tv(WEEK_HEADING_GAP) }) {
            Text(dayHeading(cell.day)).fontFamily(nunito(500))
              .fontSize(tv(DAY_HEADING_SIZE))
              .fontWeight(FontWeight.Medium)
              .fontColor(toResourceColor(activeColors().ink))
              .height(tv(WEEK_HEADING_HEIGHT))
            Scroll() {
              Column({ space: tv(ENTRY_GAP + 1) }) {
                ForEach(groupSeriesEpisodes(cell.entries), (item: CalendarItem) => {
                  this.entryCard(item, WEEK_COLUMN_WIDTH)
                }, (item: CalendarItem): string => item.key)
              }
            }
            .layoutWeight(1)
            .align(Alignment.Top)
            .scrollBar(BarState.Off)
            .edgeEffect(EdgeEffect.None)
          }
          .width(tv(WEEK_COLUMN_WIDTH))
          .height('100%')
          .alignItems(HorizontalAlign.Start)
        }, (cell: CalendarCell): string => cellKey(cell))
      }
      .height('100%')
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .align(Alignment.TopStart)
    .width(tv(GRID_WIDTH))
    .height(tv(GRID_HEIGHT))
    .position({ x: tv(GRID_LEFT), y: tv(GRID_TOP) })
  }

  @Builder
  private monthCell(cell: CalendarCell, cellHeight: number): void {
    Column() {
      Column() {
        ForEach(groupSeriesEpisodes(cell.entries).slice(0, this.monthLinesFor(cellHeight)), (item: CalendarItem) => {
          Row({ space: isTvMetrics() ? tv(7) : 3 }) {
            Circle()
              .width(isTvMetrics() ? tv(MONTH_DOT_SIZE) : 5)
              .height(isTvMetrics() ? tv(MONTH_DOT_SIZE) : 5)
              .fill(toResourceColor(toneColor(itemPillTone(item, this.today))))
            Text(itemLineText(item)).fontFamily(nunito(item.grouped ? 700 : 400))
              .fontSize(isTvMetrics() ? tv(MONTH_LINE_SIZE) : 9)
              .fontWeight(item.grouped ? FontWeight.Bold : FontWeight.Normal)
              .fontColor(toResourceColor(activeColors().ink))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
          }
          .height(isTvMetrics() ? tv(MONTH_LINE_HEIGHT) : TOUCH_MONTH_LINE_HEIGHT)
          .width('100%')
          .padding({ left: isTvMetrics() ? tv(6) : 2 })
        }, (item: CalendarItem): string => item.key)
      }
      .layoutWeight(1)
      .width('100%')
      Row({ space: tv(6) }) {
        Text(String(dayOfMonth(cell.day))).fontFamily(nunito(500))
          .fontSize(tv(MONTH_DAY_SIZE))
          .fontWeight(FontWeight.Medium)
          .fontColor(toResourceColor(activeColors().inkSoft))
        if (groupSeriesEpisodes(cell.entries).length > this.monthLinesFor(cellHeight)) {
          Text(`+${groupSeriesEpisodes(cell.entries).length - this.monthLinesFor(cellHeight)} more`).fontFamily(nunito(400))
            .fontSize(tv(MONTH_LINE_SIZE))
            .fontColor(toResourceColor(activeColors().inkSoft))
        }
      }
      .height(tv(MONTH_FOOT_HEIGHT))
      .width('100%')
      .padding({ left: tv(6) })
    }
    .layoutWeight(1)
    .height(isTvMetrics() ? tv(cellHeight) : '100%')
    .padding({ left: isTvMetrics() ? tv(MONTH_CELL_PADDING) : 1, right: isTvMetrics() ? tv(MONTH_CELL_PADDING) : 1, top: tv(2) })
    .backgroundColor(cell.inMonth ? Color.Transparent : toResourceColorWithAlpha(activeColors().surfaceSoft, 0.4))
    .border({
      width: cell.isToday ? 2 : 1,
      color: cell.isToday ? toResourceColor(activeColors().ink) : toResourceColor(activeColors().line),
    })
  }

  private monthLinesFor(cellHeight: number): number {
    if (isTvMetrics()) {
      return Math.max(1, Math.floor((cellHeight - MONTH_FOOT_HEIGHT - 2) / MONTH_LINE_HEIGHT));
    }
    // Match Web's content-room calculation, excluding phone padding and a conservative max border.
    const phoneRoom: number = cellHeight - TOUCH_MONTH_CELL_VERTICAL_INSET;
    return Math.max(0, Math.floor((phoneRoom - MONTH_FOOT_HEIGHT - 2) / TOUCH_MONTH_LINE_HEIGHT));
  }

  @Builder
  private monthView(): void {
    Column() {
      Row() {
        ForEach(WEEKDAY_SHORT, (name: string) => {
          Text(name).fontFamily(nunito(400))
            .fontSize(tv(MONTH_WEEKDAY_SIZE))
            .letterSpacing(tv(0.96))
            .textCase(TextCase.UpperCase)
            .fontColor(toResourceColor(activeColors().inkSoft))
            .textAlign(TextAlign.Center)
            .layoutWeight(1)
        }, (name: string): string => name)
      }
      .width('100%')
      .height(tv(MONTH_HEAD_HEIGHT))
      ForEach(buildMonthGrid(this.anchor, this.groups, this.today), (week: CalendarCell[]) => {
        Row() {
          ForEach(week, (cell: CalendarCell) => {
            this.monthCell(cell, (GRID_HEIGHT - MONTH_HEAD_HEIGHT) / buildMonthGrid(this.anchor, [], this.today).length)
          }, (cell: CalendarCell): string => cellKey(cell))
        }
        .width('100%')
      }, (week: CalendarCell[]): string => week.map((cell: CalendarCell): string => cellKey(cell)).join('|'))
    }
    .width(tv(GRID_WIDTH))
    .height(tv(GRID_HEIGHT))
    .position({ x: tv(GRID_LEFT), y: tv(GRID_TOP) })
  }

  @Builder
  private linkBody(): void {
    CalendarLinkPanel()
  }

  @Builder
  private filtersBody(): void {
    Column({ space: tv(FILTER_SECTION_GAP) }) {
      ChoiceSegments({
        heading: 'View',
        choices: VIEW_CHOICES,
        selected: this.view,
        onChoose: (value: string): void => {
          this.changeView(value);
        },
      })
      MultiSelect({
        heading: 'Type',
        options: TYPE_CHOICES,
        selected: this.filters.types,
        noneLabel: 'Any type',
        addLabel: 'Add type',
        onChange: (values: string[]): void => {
          this.setFilters({ types: values, statuses: this.filters.statuses, monitoredOnly: this.filters.monitoredOnly });
        },
      })
      MultiSelect({
        heading: 'Status',
        options: STATUS_CHOICES,
        selected: this.filters.statuses,
        noneLabel: 'Any status',
        addLabel: 'Add status',
        onChange: (values: string[]): void => {
          this.setFilters({ types: this.filters.types, statuses: values, monitoredOnly: this.filters.monitoredOnly });
        },
      })
      this.monitoringToggle()
      if (activeFilterCount(this.filters) > 0) {
        Text('Clear filters').fontFamily(nunito(700))
          .fontSize(tv(CHOICE_FONT))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().inkSoft))
          .textAlign(TextAlign.Center)
          .width(tv(FILTER_WIDTH))
          .height(tv(CHOICE_HEIGHT))
          .borderRadius(tv(CHOICE_RADIUS))
          .backgroundColor(toResourceColorWithAlpha(activeColors().surfaceSoft, 0.64))
          .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.083) })
          .focusable(true)
          .onClick(() => {
            this.setFilters({ types: [], statuses: [], monitoredOnly: false });
          })
      }
    }
    .alignItems(HorizontalAlign.Start)
  }

  /** Web `.remote-toggle` "Monitored only": a 22 px box (2 px ink-soft border, filled with a tick when on). */
  @Builder
  private monitoringToggle(): void {
    Column({ space: tv(12) }) {
      Text('Monitoring').fontFamily(nunito(700))
        .fontSize(tv(9.6))
        .fontWeight(FontWeight.Bold)
        .letterSpacing(tv(0.672))
        .textCase(TextCase.UpperCase)
        .fontColor(toResourceColor(activeColors().inkSoft))
      Row({ space: tv(27) }) {
        Text(this.filters.monitoredOnly ? '✓' : '').fontFamily(nunito(700))
          .fontSize(tv(14))
          .fontWeight(FontWeight.Bold)
          .fontColor(toResourceColor(activeColors().surface))
          .textAlign(TextAlign.Center)
          .width(tv(22))
          .height(tv(22))
          .borderRadius(tv(4))
          .border({ width: 2, color: toResourceColor(activeColors().inkSoft) })
          .backgroundColor(toResourceColor(this.filters.monitoredOnly ? activeColors().inkSoft : activeColors().surface))
        Text('Monitored only').fontFamily(nunito(400))
          .fontSize(tv(19.2))
          .fontColor(toResourceColor(activeColors().ink))
      }
      .height(tv(44))
      .focusable(true)
      .onClick(() => {
        this.setFilters({ types: this.filters.types, statuses: this.filters.statuses,
          monitoredOnly: !this.filters.monitoredOnly });
      })
    }
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  private panelButton(label: string, primary: boolean, onTap: () => void): void {
    Text(label).fontFamily(nunito(700))
      .fontSize(tv(PANEL_BUTTON_FONT))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(primary ? activeColors().bg : activeColors().ink))
      .height(tv(PANEL_BUTTON_HEIGHT))
      .padding({ left: tv(PANEL_BUTTON_PADDING), right: tv(PANEL_BUTTON_PADDING) })
      .borderRadius(tv(PANEL_BUTTON_HEIGHT / 2))
      .backgroundColor(primary ? toResourceColor(activeColors().ink) : Color.Transparent)
      .border({ width: primary ? 0 : 1, color: toResourceColor(activeColors().lineStrong) })
      .focusable(true)
      .onClick(() => {
        onTap();
      })
  }

  /** Web details panel actions: Play/Resume, Open series (or Open), the watchlist toggle. */
  @Builder
  private panelActions(): void {
    if (this.plan() !== undefined) {
      Row({ space: tv(PANEL_BUTTON_GAP) }) {
        if (this.plan()!.play !== null) {
          this.panelButton(this.plan()!.play!.resume ? 'Resume' : 'Play', true, (): void => {
            this.playSelected();
          })
        }
        if (this.plan()!.openWorkId !== null) {
          this.panelButton(this.selected !== undefined && this.selected.media_kind === 'episode' ? 'Open series' : 'Open',
            this.plan()!.play === null, (): void => {
              this.openSelected();
            })
        }
        if (this.plan()!.watchlist !== null && this.plan()!.watchlist!.enabled && this.plan()!.snapshot !== null) {
          Text(this.listed ? '✓  Remove from watchlist' : '+  Add to watchlist').fontFamily(nunito(700))
            .fontSize(tv(PANEL_BUTTON_FONT))
            .fontWeight(FontWeight.Bold)
            .fontColor(toResourceColor(activeColors().ink))
            .height(tv(PANEL_BUTTON_HEIGHT))
            .padding({ left: tv(PANEL_BUTTON_PADDING), right: tv(PANEL_BUTTON_PADDING) })
            .borderRadius(tv(PANEL_BUTTON_HEIGHT / 2))
            .border({ width: 1, color: toResourceColor(activeColors().lineStrong) })
            .opacity(this.watchlistBusy ? 0.6 : 1)
            .focusable(true)
            .onClick(() => {
              this.toggleWatchlist();
            })
        }
      }
      .margin({ top: tv(PANEL_GAP) })
    }
  }

  @Builder
  private panelExtras(): void {
    if (this.selected !== undefined) {
      Column({ space: tv(PANEL_GAP) }) {
        this.statusPill(entryPillTone(this.selected, this.today))
        if (this.selected.overview !== undefined && this.selected.overview !== null) {
          Text(this.selected.overview).fontFamily(nunito(500))
            .fontSize(tv(OVERVIEW_SIZE))
            .fontWeight(FontWeight.Medium)
            .lineHeight(tv(OVERVIEW_LINE_HEIGHT))
            .fontColor(toResourceColorWithAlpha(activeColors().ink, 0.87))
            .constraintSize({ maxWidth: tv(OVERVIEW_WIDTH) })
            .maxLines(OVERVIEW_MAX_LINES)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        this.panelActions()
      }
      .alignItems(HorizontalAlign.Start)
      .margin({ top: tv(PANEL_GAP) })
    }
  }

  @Builder
  private headerControl(label: string, round: boolean, onTap: () => void): void {
    Text(label).fontFamily(nunito(700))
      .fontSize(tv(HEADER_CONTROL_FONT))
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .textAlign(TextAlign.Center)
      .height(tv(HEADER_CONTROL_SIZE))
      .constraintSize({ minWidth: tv(HEADER_CONTROL_SIZE) })
      .padding({ left: round ? 0 : tv(20), right: round ? 0 : tv(20) })
      .borderRadius(tv(HEADER_CONTROL_SIZE / 2))
      .backgroundColor(toResourceColor(activeColors().bg))
      .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
      .focusable(true)
      .onClick(() => {
        onTap();
      })
  }

  @Builder
  private pageContent(): void {
    if (this.view === 'week') {
      this.weekView()
    } else if (this.view === 'month') {
      this.monthView()
    } else {
    Stage({
      keyArt: '',
      kicker: this.selected !== undefined ?
        `${mediaKindLabel(this.selected.media_kind)} · ${releaseTypeLabel(this.selected.release_type)}` : '',
      title: this.selected !== undefined ? this.selected.title : '',
      metaLines: this.selected !== undefined ?
        [`${entrySubtitle(this.selected)}    ${entryWhenLabel(this.selected)}`] : [],
      synopsis: '',
      scrollRails: false,
      railsSlot: (): void => {
        this.agenda();
      },
      heroExtraSlot: (): void => {
        this.panelExtras();
      },
    })
    }
    // Web's slot 0: the Calendar link (bell); Filters is the second tile.
    ActionTile({
      icon: $r('app.media.action_bell'),
      label: 'Calendar link',
      slot: 0,
      onActivate: (): void => {
        this.linkOpen = true;
      },
    })
    ActionTile({
      icon: $r('app.media.action_filters'),
      label: 'Filters',
      slot: 1,
      onActivate: (): void => {
        this.filtersOpen = true;
      },
    })
    if (this.linkOpen) {
      Drawer({
        kicker: 'Calendar',
        title: 'Calendar link',
        onClose: (): void => {
          this.linkOpen = false;
        },
        body: (): void => {
          this.linkBody();
        },
      })
    } else if (this.filtersOpen) {
      Drawer({
        kicker: 'Calendar',
        title: 'Filters',
        onClose: (): void => {
          this.filtersOpen = false;
        },
        body: (): void => {
          this.filtersBody();
        },
      })
    }
  }

  @Builder
  private pageControls(): void {
    Row({ space: tv(HEADER_CONTROL_GAP) }) {
      Text(rangeLabel(this.view, this.anchor)).fontFamily(nunito(700))
        .fontSize(tv(HEADER_CONTROL_FONT))
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().inkSoft))
        .height(tv(HEADER_CONTROL_SIZE))
        .padding({ left: tv(20), right: tv(20) })
        .borderRadius(tv(HEADER_CONTROL_SIZE / 2))
        .backgroundColor(toResourceColor(activeColors().bg))
        .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
        .focusable(true)
        .onClick(() => {
          this.periodOpen = !this.periodOpen;
        })
      this.headerControl('←', true, (): void => {
        this.page(-1);
      })
      this.headerControl('Today', false, (): void => {
        this.page(0);
      })
      this.headerControl('→', true, (): void => {
        this.page(1);
      })
    }
    .position({ x: tv(HEADER_RIGHT), y: tv(TvGeometry.utilityRowTop) })
    .markAnchor({ x: '100%', y: 0 })
    if (this.periodOpen) {
      // Web hangs the jump panel under the range button, right edges aligned.
      PeriodPicker({
        value: this.anchor,
        onChange: (day: string): void => {
          this.anchor = day;
          this.load();
        },
        onClose: (): void => {
          this.periodOpen = false;
        },
      })
        .position({ x: tv(PERIOD_PANEL_LEFT), y: tv(PERIOD_PANEL_TOP) })
        .zIndex(2)
    }
  }


  /** Phone: the range, back, Today and forward controls above the view. */
  @Builder
  private touchControls(): void {
    Row({ space: 8 }) {
      Text(rangeLabel(this.view, this.anchor)).fontFamily(nunito(700))
        .fontSize(PHONE_CONTROL_FONT)
        .fontWeight(FontWeight.Bold)
        .fontColor(toResourceColor(activeColors().inkSoft))
        .height(44)
        .padding({ left: 18, right: 18 })
        .borderRadius(22)
        .backgroundColor(toResourceColor(activeColors().bg))
        .border({ width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
        .onClick(() => {
          this.periodOpen = !this.periodOpen;
        })
      this.touchControl('←', 44, (): void => {
        this.page(-1);
      })
      this.touchControl('Today', 80, (): void => {
        this.page(0);
      })
      this.touchControl('→', 44, (): void => {
        this.page(1);
      })
    }
    .width('100%')
    .justifyContent(FlexAlign.Center)
    .padding({ top: this.view === 'month' ? 14 : 0, bottom: 12 })
  }

  @Builder
  private touchControl(label: string, width: number, onTap: () => void): void {
    Text(label).fontFamily(nunito(700))
      .fontSize(PHONE_CONTROL_FONT)
      .fontWeight(FontWeight.Bold)
      .fontColor(toResourceColor(activeColors().inkSoft))
      .textAlign(TextAlign.Center)
      .width(width)
      .height(44)
      .borderRadius(22)
      .backgroundColor(toResourceColor(activeColors().bg))
      // web opens the page with Today focused (the Previewer reports no focus): the ring is drawn from the state
      .border(label === 'Today' ? { width: 3, color: toResourceColor(activeColors().ink) } : { width: 1, color: toResourceColorWithAlpha(activeColors().ink, 0.08) })
      .onClick(() => {
        onTap();
      })
  }

  @Builder
  private touchAgenda(): void {
    if (this.loading) {
      AsyncState({ kind: AsyncStateKind.Loading })
        .width('100%')
        .layoutWeight(1)
    } else if (this.groups.length === 0) {
      AsyncState({
        kind: this.errorMessage.length > 0 ? AsyncStateKind.Error : AsyncStateKind.Empty,
        message: this.errorMessage.length > 0 ? this.errorMessage : 'Nothing is scheduled for these 30 days.',
      })
        .width('100%')
        .layoutWeight(1)
    } else {
      List({ space: 16 }) {
        ForEach(this.groups, (group: DayGroup) => {
          ListItem() {
            Column({ space: PHONE_ENTRY_GAP }) {
              this.dayHeader(group.day)
              ForEach(groupSeriesEpisodes(group.entries), (item: CalendarItem) => {
                this.phoneAgendaCard(item)
              }, (item: CalendarItem): string => item.key)
            }
            .alignItems(HorizontalAlign.Start)
          }
        }, (group: DayGroup): string => group.day + ':' + group.entries.map((entry: CalendarEntry): string => entry.id).join(','))
      }
      .width('100%')
      .layoutWeight(1)
      .padding({ left: 16, right: 16, bottom: 16 })
      .margin({ top: -12 })
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.None)
    }
  }

  @Builder
  private touchWeek(): void {
    Scroll() {
      Row({ space: 12 }) {
        ForEach(buildWeekDays(this.anchor, this.groups, this.today), (cell: CalendarCell) => {
          Column({ space: tv(WEEK_HEADING_GAP) }) {
            Text(dayHeading(cell.day)).fontFamily(nunito(500))
              .fontSize(tv(DAY_HEADING_SIZE))
              .fontWeight(FontWeight.Medium)
              .fontColor(toResourceColor(activeColors().ink))
              .height(tv(WEEK_HEADING_HEIGHT))
            Scroll() {
              Column({ space: tv(ENTRY_GAP + 1) }) {
                ForEach(groupSeriesEpisodes(cell.entries), (item: CalendarItem) => {
                  this.entryCard(item, 0)
                }, (item: CalendarItem): string => item.key)
              }
            }
            .layoutWeight(1)
            .align(Alignment.Top)
            .scrollBar(BarState.Off)
            .edgeEffect(EdgeEffect.None)
          }
          .width(300)
          .height('100%')
          .alignItems(HorizontalAlign.Start)
        }, (cell: CalendarCell): string => cellKey(cell))
      }
      .height('100%')
      .padding({ left: 16, right: 16 })
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .align(Alignment.TopStart)
    .width('100%')
    .layoutWeight(1)
  }

  @Builder
  private touchMonth(): void {
    Scroll() {
      Column() {
        Row() {
          ForEach(WEEKDAY_SHORT, (name: string) => {
            Text(name).fontFamily(nunito(400))
              .fontSize(tv(MONTH_WEEKDAY_SIZE))
              .letterSpacing(tv(0.96))
              .textCase(TextCase.UpperCase)
              .fontColor(toResourceColor(activeColors().inkSoft))
              .textAlign(TextAlign.Center)
              .layoutWeight(1)
          }, (name: string): string => name)
        }
        .width('100%')
        .height(tv(MONTH_HEAD_HEIGHT))
        ForEach(buildMonthGrid(this.anchor, this.groups, this.today), (week: CalendarCell[]) => {
          Row() {
            ForEach(week, (cell: CalendarCell) => {
              this.monthCell(cell, this.touchMonthCellHeight())
            }, (cell: CalendarCell): string => cellKey(cell))
          }
          .width('100%')
          .layoutWeight(1)
        }, (week: CalendarCell[]): string => week.map((cell: CalendarCell): string => cellKey(cell)).join('|'))
      }
      .width('100%')
      .height('100%')
      .constraintSize({ minWidth: tv(TOUCH_MONTH_GRID_MIN_WIDTH) })
    }
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .edgeEffect(EdgeEffect.None)
    .align(Alignment.TopStart)
    .width('100%')
    .layoutWeight(1)
    .padding({ left: 16, right: 16 })
    .onAreaChange((_oldArea: Area, area: Area) => {
      const height: number = Number.parseFloat(String(area.height));
      if (height > 0 && Math.abs(height - this.touchMonthViewportHeight) > 0.5) {
        this.touchMonthViewportHeight = height;
      }
    })
  }

  private touchMonthCellHeight(): number {
    const weekCount: number = buildMonthGrid(this.anchor, this.groups, this.today).length;
    if (weekCount <= 0 || this.touchMonthViewportHeight <= 0) {
      return 0;
    }
    return Math.max(0, (this.touchMonthViewportHeight - MONTH_HEAD_HEIGHT) / weekCount);
  }

  @Builder
  private touchContentBody(): void {
    Column() {
      this.touchControls()
      if (this.view === 'week') {
        this.touchWeek()
      } else if (this.view === 'month') {
        this.touchMonth()
      } else {
        this.touchAgenda()
      }
    }
    .width('100%')
    .height('100%')
  }

  @Builder
  private touchActionButtons(): void {
    Row({ space: 8 }) {
      TouchIconButton({
        icon: $r('app.media.action_bell'),
        onTap: (): void => {
          this.linkOpen = true;
        },
      })
      TouchIconButton({
        icon: $r('app.media.action_filters'),
        onTap: (): void => {
          this.filtersOpen = true;
        },
      })
    }
  }

  @Builder
  private touchOverlays(): void {
    if (this.periodOpen) {
      // Web hangs the jump panel under the range button.
      PeriodPicker({
        value: this.anchor,
        onChange: (day: string): void => {
          this.anchor = day;
          this.load();
        },
        onClose: (): void => {
          this.periodOpen = false;
        },
      })
        .position({ x: 16, y: 116 })
        .zIndex(2)
    }
    if (this.linkOpen) {
      Drawer({
        kicker: 'Calendar',
        title: 'Calendar link',
        onClose: (): void => {
          this.linkOpen = false;
        },
        body: (): void => {
          this.linkBody();
        },
      })
    } else if (this.filtersOpen) {
      Drawer({
        kicker: 'Calendar',
        title: 'Filters',
        onClose: (): void => {
          this.filtersOpen = false;
        },
        body: (): void => {
          this.filtersBody();
        },
      })
    }
  }

  build() {
    NavDestination() {
      Stack() {
      PageShell({
        title: 'Calendar',
        touch: true,
        touchContent: (): void => {
          this.touchContentBody();
        },
        touchActions: (): void => {
          this.touchActionButtons();
        },
        touchOverlay: (): void => {
          this.touchOverlays();
        },
        selectedId: CALENDAR_NAV_ID,
        content: (): void => {
          this.pageContent();
        },
        controls: (): void => {
          this.pageControls();
        },
      })
      }
      .width('100%')
      .height('100%')
    }
    .hideTitleBar(true)
  }
}

/** Registered in `profile/router_map.json` as the `Calendar` route's `buildFunction`. */
@Builder
export function CalendarBuilder(): void {
  ReleaseCalendar()
}
