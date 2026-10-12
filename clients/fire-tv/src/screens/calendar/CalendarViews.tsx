/**
 * The release calendar's three views at the web TV layout's measurements: the agenda (details on the left, the day-by-day
 * list on the right), the week (one 440 px column per day on a horizontal track, each column scrolling on its own) and the
 * month grid. Every scrolling area fades at the edges where content continues.
 */
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Animated, Pressable, View, type LayoutChangeEvent} from 'react-native';
import type {CalendarEntry} from '@playarr-tv/api-client';
import {useLanguage} from '../../i18n/LanguageProvider';
import {type CalendarItem, type Day, type DayGroup, type MonthCell, buildMonthGrid, buildWeekDays, groupSeriesEpisodes, itemAvailability, itemPillTone, parseDay} from '../../lib/calendar';
import {reportFocus} from '../../debug/parityControl';
import {mix} from '../../theme/color';
import {useTheme} from '../../theme/ThemeProvider';
import {EdgeFade} from '../../tv/EdgeFade';
import {Box, T, u} from '../../tv/kit';
import {useScrollReveal} from '../../tv/useScrollReveal';
import {AgendaDetails, EntryCard, itemEntry, itemTitle} from './CalendarParts';

export const BODY_BOTTOM = 961.3;
// Measured on the web agenda (1920x1080): cards 1033.4 px wide from x 783.4; day headings are 44 px boxes 32 px above their cards.
const AGENDA_X = 783.4;
const AGENDA_W = 1033.4;
const AGENDA_HEADING_H = 44;
const AGENDA_HEADING_GAP = 32;
const AGENDA_HEADING_Y = 162;
const DAY_GAP = 32;
const HEADING_H = 27.6;
const HEADING_GAP = 6.4;
const ENTRY_GAP = 13.6;
const WEEK_X = 153.6;
const WEEK_W = 1689.6;
const COLUMN_W = 440;
const COLUMN_PITCH = 460;

export interface ViewShared {
  today: Day;
  locale: string;
  contentTop: number;
  selectedKey: string | null;
  onSelect: (item: CalendarItem) => void;
  onOpenRoute: (route: string) => void;
}

/** "Thursday 8 October": the weekday, then the day and month, with no comma whatever the platform's Intl does. */
function dayHeading(day: Day, locale: string): string {
  const date = parseDay(day);
  const weekday = new Intl.DateTimeFormat(locale, {weekday: 'long', timeZone: 'UTC'}).format(date);
  const rest = new Intl.DateTimeFormat(locale, {day: 'numeric', month: 'long', timeZone: 'UTC'}).format(date);
  return `${weekday} ${rest}`;
}

function DayHeading({day, today, locale, height = HEADING_H, background}: {day: Day; today: Day; locale: string; height?: number; background?: string}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', height: u(height), backgroundColor: background}}>
      <T size={18.4} weight={640} lh={HEADING_H} color={day === today ? colour.accent : colour.ink}>
        {dayHeading(day, locale)}
      </T>
      {day === today ? (
        <View style={{marginLeft: u(9.6), height: u(22), paddingHorizontal: u(8), borderRadius: 999, borderWidth: 1, borderColor: colour.accent, justifyContent: 'center'}}>
          <T size={11.2} weight={640} ls={0.896} lh={14} color={colour.accent} upper>
            {t('pages.calendar.today')}
          </T>
        </View>
      ) : null}
    </View>
  );
}

/** Agenda: the previewed release's details on the left, the list on the right. */
function AgendaViewImpl({groups, selectedKey, onSelect, onOpenRoute, locale, today, contentTop}: ViewShared & {groups: readonly DayGroup[]}): React.ReactElement {
  const items = useMemo(() => groups.flatMap((group) => groupSeriesEpisodes(group.entries).map((item) => ({day: group.day, item}))), [groups]);
  const selected = items.find((entry) => entry.item.key === selectedKey)?.item ?? items[0]?.item ?? null;
  const rows = useRef(new Map<string, {y: number; h: number}>()).current;
  const [contentH, setContentH] = useState(0);
  const top = AGENDA_HEADING_Y - 4;
  const viewport = 1080 - top; // the web's list scroller runs to the bottom edge of the page
  const scroll = useScrollReveal({viewport, content: contentH + 8 + 32, margin: 24});
  const agendaTop = useMemo(() => Animated.add(new Animated.Value(u(4)), scroll.offset), [scroll.offset]);
  const onAgendaLayout = useCallback((event: LayoutChangeEvent) => setContentH(event.nativeEvent.layout.height / (event.nativeEvent.layout.width / AGENDA_W)), []);
  let previous: Day | null = null;

  return (
    <>
      {selected ? (
        <AgendaDetails item={selected} locale={locale} today={today} onOpen={onOpenRoute} />
      ) : null}
      <Box x={AGENDA_X - 4} y={top} w={AGENDA_W + 24} h={viewport} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: u(4), top: agendaTop, width: u(AGENDA_W)}} pointerEvents="box-none" onLayout={onAgendaLayout}>
          {items.map((entry, index) => {
            const heading = entry.day !== previous;
            previous = entry.day;
            return (
              <React.Fragment key={entry.item.key}>
                {heading ? (
                  <View style={{marginTop: u(index === 0 ? 0 : DAY_GAP - ENTRY_GAP), marginBottom: u(AGENDA_HEADING_GAP)}}>
                    <DayHeading day={entry.day} today={today} locale={locale} height={AGENDA_HEADING_H} />
                  </View>
                ) : null}
                <AgendaRow item={entry.item} today={today} selected={selected?.key === entry.item.key} rows={rows} reveal={scroll.reveal} onSelect={onSelect} onOpenRoute={onOpenRoute} />
              </React.Fragment>
            );
          })}
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={scroll.scrolled > 0} x={AGENDA_X - 4} y={top} w={AGENDA_W + 24} h={viewport} />
      <EdgeFade side="bottom" active={scroll.scrolled < scroll.max - 1} x={AGENDA_X - 4} y={top} w={AGENDA_W + 24} h={viewport} />
    </>
  );
}

/** One agenda row. Memoised: moving focus re-renders the two rows involved, not the whole list. */
const AgendaRow = React.memo(function AgendaRow({item, today, selected, rows, reveal, onSelect, onOpenRoute}: {item: CalendarItem; today: Day; selected: boolean; rows: Map<string, {y: number; h: number}>; reveal: (start: number, size: number) => void; onSelect: (item: CalendarItem) => void; onOpenRoute: (route: string) => void}): React.ReactElement {
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const scale = event.nativeEvent.layout.width / AGENDA_W;
      rows.set(item.key, {y: event.nativeEvent.layout.y / scale, h: event.nativeEvent.layout.height / scale});
    },
    [rows, item.key],
  );
  const onFocus = useCallback(() => {
    onSelect(item);
    const row = rows.get(item.key);
    if (row) reveal(row.y, row.h);
  }, [onSelect, item, rows, reveal]);
  const onPress = useCallback(() => {
    const route = itemRoute(item);
    if (route) onOpenRoute(route);
  }, [item, onOpenRoute]);
  return (
    <View style={{marginBottom: u(ENTRY_GAP)}} onLayout={onLayout}>
      <EntryCard item={item} today={today} width={AGENDA_W} selected={selected} onFocus={onFocus} onPress={onPress} />
    </View>
  );
});

function itemRoute(item: CalendarItem): string | null {
  const entry = itemEntry(item);
  return entry.work_id ? `/${entry.media_kind === 'movie' ? 'movies' : entry.media_kind === 'album' ? 'music' : 'series'}/${entry.work_id}` : null;
}

/** One week column: its heading and entries, scrolling on their own inside a 440 px window. */
function DayColumn({group, x, height, shared, onColumnFocus, onOpen}: {group: DayGroup; x: number; height: number; shared: ViewShared; onColumnFocus: () => void; onOpen: (item: CalendarItem) => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t} = useLanguage();
  const items = groupSeriesEpisodes(group.entries);
  const rows = useRef(new Map<string, {y: number; h: number}>()).current;
  const [contentH, setContentH] = useState(0);
  const scroll = useScrollReveal({viewport: height, content: contentH + 16, margin: 24});
  return (
    <>
      <Box x={x - 6} y={-6} w={COLUMN_W + 12} h={height + 12} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: u(6), top: Animated.add(new Animated.Value(u(6)), scroll.offset), width: u(COLUMN_W)}} pointerEvents="box-none" onLayout={(event) => setContentH(event.nativeEvent.layout.height)}>
          <View style={{marginBottom: u(HEADING_GAP)}}>
            <DayHeading day={group.day} today={shared.today} locale={shared.locale} />
          </View>
          {items.length === 0 ? (
            <T size={12.8} weight={400} lh={19.2} color={colour.inkMuted}>
              {t('pages.calendar.dayEmpty')}
            </T>
          ) : null}
          {items.map((item) => (
            <View
              key={item.key}
              style={{marginBottom: u(ENTRY_GAP)}}
              onLayout={(event) => rows.set(item.key, {y: event.nativeEvent.layout.y, h: event.nativeEvent.layout.height})}
            >
              <EntryCard
                item={item}
                today={shared.today}
                width={COLUMN_W}
                wrap
                selected={shared.selectedKey === item.key}
                onFocus={() => {
                  onColumnFocus();
                  const row = rows.get(item.key);
                  if (row) scroll.reveal(row.y, row.h);
                }}
                onPress={() => onOpen(item)}
              />
            </View>
          ))}
        </Animated.View>
      </Box>
      <EdgeFade side="top" active={scroll.scrolled > 0} x={x} y={0} w={COLUMN_W} h={height} />
      <EdgeFade side="bottom" active={scroll.scrolled < scroll.max - 1} x={x} y={0} w={COLUMN_W} h={height} />
    </>
  );
}

/** Week: LEFT and RIGHT move between days, UP and DOWN between entries of a day. */
function WeekViewImpl({groups, anchor, firstDay, shared}: {groups: readonly DayGroup[]; anchor: Day; firstDay: number; shared: ViewShared}): React.ReactElement {
  const days = buildWeekDays(anchor, firstDay, groups, shared.today);
  const top = 174; // the web week scroller runs from y 174 to 961.2
  const height = BODY_BOTTOM - top;
  const scroll = useScrollReveal({viewport: WEEK_W, content: days.length * COLUMN_PITCH - 20, snap: 0});
  return (
    <>
      <Box x={WEEK_X - 8} y={top - 8} w={WEEK_W + 16} h={height + 16} style={{overflow: 'hidden'}} pointerEvents="box-none">
        <Animated.View style={{position: 'absolute', left: Animated.add(new Animated.Value(u(8)), scroll.offset), top: u(8), width: u(days.length * COLUMN_PITCH), height: u(height)}} pointerEvents="box-none">
          {days.map((group, index) => {
            // Only the columns on screen (and one either side) are drawn: the device is slow to mount a week of posters.
            const first = Math.floor(scroll.scrolled / COLUMN_PITCH);
            if (index < first - 1 || index > first + 4) return null;
            return (
            <DayColumn
              key={group.day}
              group={group}
              x={index * COLUMN_PITCH}
              height={height}
              shared={shared}
              onColumnFocus={() => scroll.reveal(index * COLUMN_PITCH, COLUMN_W)}
              onOpen={shared.onSelect}
            />
            );
          })}
        </Animated.View>
      </Box>
      <WeekEdges scrolled={scroll.scrolled} max={scroll.max} top={top} height={height} />
    </>
  );
}

function WeekEdges({scrolled, max, top, height}: {scrolled: number; max: number; top: number; height: number}): React.ReactElement {
  return (
    <>
      <EdgeFade side="left" active={scrolled > 0} x={WEEK_X} y={top} w={WEEK_W} h={height} size={58} />
      <EdgeFade side="right" active={scrolled < max - 1} x={WEEK_X} y={top} w={WEEK_W} h={height} size={58} />
    </>
  );
}

const MONTH_X = 153.6;
const MONTH_W = 1689.6;
const MONTH_GRID_Y = 205.2;
const MONTH_HEAD_Y = MONTH_GRID_Y - 30.8;
const CELL_W = MONTH_W / 7;
// The web's month cell (tv-web Calendar.css and monthChipsThatFit): entries are plain text lines with a status dot above a
// 44 px bottom row holding the day number and, when entries overflow, "+N more". The lines share the room above the
// bottom row (22 px at least, 44 px at most).
const MONTH_FOOT = 44;
const MONTH_LINE_MIN = 22;
const MONTH_LINE_MAX = 44;
const MONTH_LINES_GAP = 2;
const CELL_BORDER = 1;
const CELL_PAD_Y = 0.8;
const CELL_PAD_X = 4.8;

function MonthViewImpl({groups, anchor, firstDay, shared, onMore}: {groups: readonly DayGroup[]; anchor: Day; firstDay: number; shared: ViewShared; onMore: (day: Day) => void}): React.ReactElement {
  const {colour} = useTheme();
  const {t, language} = useLanguage();
  const weeks = useMemo(() => buildMonthGrid(anchor, firstDay, groups, shared.today), [anchor, firstDay, groups, shared.today]);
  const rowH = (BODY_BOTTOM - MONTH_GRID_Y) / weeks.length;
  const weekday = new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : language, {weekday: 'short', timeZone: 'UTC'});
  return (
    <>
      {weeks[0]!.map((cell, index) => (
        <Box key={cell.day} x={MONTH_X + index * CELL_W} y={MONTH_HEAD_Y} w={CELL_W} h={30.8}>
          <View style={{height: u(30.8), alignItems: 'center', justifyContent: 'center'}}>
            <T size={12} weight={400} ls={0.96} lh={18} color={colour.inkMuted} upper>
              {weekday.format(parseDay(cell.day))}
            </T>
          </View>
        </Box>
      ))}
      {weeks.map((week, weekIndex) =>
        week.map((cell, cellIndex) => (
          <MonthCellView key={cell.day} cell={cell} x={MONTH_X + cellIndex * CELL_W} y={MONTH_GRID_Y + weekIndex * rowH} h={rowH} shared={shared} onMore={onMore} t={t} />
        )),
      )}
    </>
  );
}

const MonthCellView = React.memo(function MonthCellView({cell, x, y, h, shared, onMore, t}: {cell: MonthCell; x: number; y: number; h: number; shared: ViewShared; onMore: (day: Day) => void; t: ReturnType<typeof useLanguage>['t']}): React.ReactElement {
  const {colour} = useTheme();
  const items = groupSeriesEpisodes(cell.entries);
  const room = Math.floor(h - 2 * CELL_BORDER - 2 * CELL_PAD_Y);
  const fit = Math.max(0, Math.floor((room - MONTH_FOOT - MONTH_LINES_GAP) / MONTH_LINE_MIN));
  const shown = items.slice(0, Math.min(items.length, fit));
  const hidden = items.length - shown.length;
  const linesTop = y + CELL_BORDER + CELL_PAD_Y;
  const lineH = Math.min(MONTH_LINE_MAX, (room - MONTH_FOOT - MONTH_LINES_GAP) / Math.max(1, shown.length));
  const left = x + CELL_BORDER + CELL_PAD_X;
  const innerW = CELL_W - 2 * (CELL_BORDER + CELL_PAD_X);
  const footY = y + h - CELL_BORDER - CELL_PAD_Y - MONTH_FOOT;
  const day = (
    <T size={12.8} weight={640} lh={19.2} color={cell.inMonth ? colour.ink : colour.inkMuted}>
      {String(parseDay(cell.day).getUTCDate())}
    </T>
  );
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: u(x),
          top: u(y),
          width: u(CELL_W),
          height: u(h),
          borderWidth: 1,
          borderColor: colour.line,
          backgroundColor: cell.inMonth ? 'transparent' : mix(colour.surfaceSoft, 0.4),
        }}
      />
      {cell.isToday ? <View pointerEvents="none" style={{position: 'absolute', left: u(x), top: u(y), width: u(CELL_W), height: u(h), borderWidth: u(2), borderColor: colour.accent}} /> : null}
      {shown.map((item, index) => (
        <Line key={item.key} item={item} x={left} y={linesTop + index * lineH} w={innerW} h={lineH} today={shared.today} onSelect={shared.onSelect} />
      ))}
      {hidden > 0 ? (
        <MoreFoot label={t('pages.calendar.more', {count: hidden})} x={left} y={footY} w={innerW} onPress={() => onMore(cell.day)}>
          {day}
        </MoreFoot>
      ) : (
        <Box x={left + 3} y={footY} w={innerW - 3} h={MONTH_FOOT}>
          <View style={{height: u(MONTH_FOOT), justifyContent: 'center'}}>{day}</View>
        </Box>
      )}
    </>
  );
});

/** The web's --brand (global.css). */
const BRAND = '#cf3157';
const TONE_NAMES = {available: 'success', upcoming: 'brand', missing: 'danger', neutral: 'soft'} as const;

function useToneColour(tone: 'available' | 'upcoming' | 'missing' | 'neutral'): string {
  const {colour} = useTheme();
  const name = TONE_NAMES[tone];
  return name === 'success' ? colour.success : name === 'danger' ? colour.danger : name === 'brand' ? BRAND : colour.inkSoft;
}

/** An entry: a plain text line with a status dot; focus underlines it. */
const Line = React.memo(function Line({item, x, y, w, h, today, onSelect}: {item: CalendarItem; x: number; y: number; w: number; h: number; today: Day; onSelect: (item: CalendarItem) => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const dot = useToneColour(itemPillTone(item, today));
  const label = item.kind === 'series' ? `${item.title} · ${item.entries.length}×` : itemTitle(item);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={itemTitle(item)}
      onFocus={() => {
        reportFocus(label);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onPress={() => onSelect(item)}
      style={{position: 'absolute', left: u(x), top: u(y), width: u(w), height: u(h), borderRadius: u(4), flexDirection: 'row', alignItems: 'center', paddingHorizontal: u(5.6)}}
    >
      <View style={{width: u(8.8), height: u(8.8), borderRadius: u(4.4), backgroundColor: dot}} />
      <View style={{marginLeft: u(7.2), flex: 1}}>
        <T size={12.48} weight={item.kind === 'series' ? 700 : 400} lh={18} color={colour.ink} lines={1} style={focused ? {textDecorationLine: 'underline'} : undefined}>
          {label}
        </T>
      </View>
    </Pressable>
  );
});

/** The bottom row when entries overflow: the day number with "+N more" beside it, one target. */
function MoreFoot({label, x, y, w, onPress, children}: {label: string; x: number; y: number; w: number; onPress: () => void; children: React.ReactNode}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onFocus={() => {
        reportFocus(label);
        setFocused(true);
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{position: 'absolute', left: u(x), top: u(y), width: u(w), height: u(MONTH_FOOT), borderRadius: u(4), flexDirection: 'row', alignItems: 'center', paddingLeft: u(3), gap: u(5.6)}}
    >
      {children}
      <T size={12.48} weight={400} lh={18} color={colour.inkSoft} lines={1} style={focused ? {textDecorationLine: 'underline'} : undefined}>
        {label}
      </T>
    </Pressable>
  );
}

export const AgendaView = React.memo(AgendaViewImpl);
export const WeekView = React.memo(WeekViewImpl);
export const MonthView = React.memo(MonthViewImpl);
