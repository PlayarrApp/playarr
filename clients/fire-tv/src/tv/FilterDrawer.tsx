/**
 * The right-hand filter drawer (web `.tv-filter-drawer`, 360 px wide): the kicker and title with a round close button, then
 * sections of choice chips. Chips are 84 x 56 in three columns (130 x 56 in two for the view options), 8 px apart; focus and
 * the selected state both fill the chip with the ink colour and grow it 2.5%. A section is 12 px label-to-control and 30.2 px
 * from the next label (web's flex gap, measured 2026-10-24). Content longer than the screen scrolls with the shared edge fades.
 *
 * Back closes the drawer (a layered Back).
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, View} from 'react-native';
import {useBackLayer} from '../navigation/backPolicy';
import {clearFocus, reportFocus} from '../debug/parityControl';
import {TvFocusScope, focusNode} from '../platform/focus';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {FocusRing} from './FocusRing';
import {EdgeFade} from './EdgeFade';
import {T, u} from './kit';
import {lx, NATIVE_DRIVER} from '../debug/layoutMarks';
import {useScrollReveal} from './useScrollReveal';

export const DRAWER_X = 1560;
export const DRAWER_W = 360;
const WIDE_X = 1490;
const WIDE_W = 430;
const CONTENT_X = 46;
const CONTENT_W = 268;
const LABEL_H = 14.4;
const LABEL_GAP = 12;
const CHIP_H = 56;
const CHIP_GAP = 8;
const FIRST_SECTION_Y = 163.4;
const SECTION_GAP = 30.2;
const SELECT_H = 58.8;

export type ViewIcon = 'list' | 'screen' | 'cover';

export interface DrawerChip {
  key: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  focusId?: string;
  icon?: ViewIcon;
}

/** A full-width choice with a title and a line of detail under it and a check mark at the end (the playback settings' options). */
export interface DrawerRow {
  key: string;
  title: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}

export type DrawerSection =
  | {key: string; label: string; columns: 2 | 3; chips: DrawerChip[]}
  | {key: string; label: string; rows: DrawerRow[]}
  /** Web's shared Select / MultiSelect in a drawer: one full-width field showing the choice; pressing it opens the options. */
  | {key: string; label: string; select: {value: string; onPress: () => void}}
  | {key: string; label: string; height: number; render: (top: number, reveal: (y: number, h: number) => void) => React.ReactNode};

export interface FilterDrawerProps {
  kicker: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  sections: DrawerSection[];
  /** Content after the sections (for example a "clear filters" button), in drawer coordinates relative to the end of the last section. */
  footer?: (top: number, reveal: (y: number, h: number) => void) => React.ReactNode;
  footerHeight?: number;
  /** Called once the drawer holds focus, so the page can stop offering its own controls to the D-pad. */
  onFocused?: () => void;
  /** Optional parity identity for the drawer close button. */
  closeFocusId?: string;
  /** Default true: the close button takes focus when the drawer opens. The title actions drawer sets false so Play holds it, as on web. */
  closeTakesFocus?: boolean;
  /** The 430 px drawer of the title page's playback settings, over the 360 px one of the libraries and the calendar. */
  wide?: boolean;
}

/** The vertical extent of each section, from the top of the content. */
function layoutSections(sections: DrawerSection[]): {tops: number[]; end: number} {
  const tops: number[] = [];
  let y = FIRST_SECTION_Y;
  for (const section of sections) {
    tops.push(y);
    if ('rows' in section) {
      y += LABEL_H + LABEL_GAP + section.rows.length * (CHIP_H + CHIP_GAP) - CHIP_GAP + SECTION_GAP;
    } else if ('chips' in section) {
      const rows = Math.ceil(section.chips.length / section.columns);
      y += LABEL_H + LABEL_GAP + rows * (CHIP_H + CHIP_GAP) - CHIP_GAP + SECTION_GAP;
    } else if ('select' in section) {
      y += LABEL_H + LABEL_GAP + SELECT_H + SECTION_GAP;
    } else {
      y += section.height;
    }
  }
  return {tops, end: y};
}

export function FilterDrawer({kicker, title, closeLabel, onClose, sections, footer, footerHeight = 0, onFocused, closeFocusId, closeTakesFocus = true, wide}: FilterDrawerProps): React.ReactElement {
  const {colour} = useTheme();
  const focusOwner = useRef({}).current;
  useBackLayer(true, onClose);
  const {tops, end} = layoutSections(sections);
  const contentEnd = end + footerHeight;
  const {offset: scrollY, scrolled, max, reveal} = useScrollReveal({viewport: 1080 - 24, content: contentEnd + 46, margin: 40});
  const revealChip = (y: number, h: number): void => reveal(y - 80, h + 80);

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(slide, {toValue: 1, duration: 360, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: NATIVE_DRIVER});
    animation.start();
    return () => {
      animation.stop();
      clearFocus(focusOwner);
    };
  }, [focusOwner, slide]);

  return (
    <>
      {/* box-shadow: -32px 0 90px rgba(40, 26, 24, 0.24) */}
      <View
        pointerEvents="none"
        style={{position: 'absolute', left: u((wide ? WIDE_X : DRAWER_X) - 90), top: 0, width: u(90), height: u(1080), backgroundColor: 'rgba(40, 26, 24, 0.04)'}}
      />
      <Animated.View
        {...lx('dialog', '')}
        style={{
          position: 'absolute',
          left: u(wide ? WIDE_X : DRAWER_X),
          top: 0,
          width: u(wide ? WIDE_W : DRAWER_W),
          height: u(1080),
          overflow: 'hidden',
          backgroundColor: colour.surfaceStrong,
          opacity: slide,
          transform: [{translateX: slide.interpolate({inputRange: [0, 1], outputRange: [u(40), 0]})}],
        }}
      >
        <TvFocusScope autoFocus trap={['up', 'down', 'left', 'right']} style={{width: u(wide ? WIDE_W : DRAWER_W), height: u(1080)}}>
          <Animated.View style={{position: 'absolute', left: 0, top: scrollY, width: u(wide ? WIDE_W : DRAWER_W), height: u(contentEnd + 80)}}>
            <View style={{position: 'absolute', left: u(CONTENT_X), top: u(54)}}>
              <T size={9.6} weight={720} ls={0.672} lh={14.4} color={colour.inkMuted} upper>
                {kicker}
              </T>
            </View>
            <View style={{position: 'absolute', left: u(CONTENT_X), top: u(71.6), width: u(wide ? 330 : 204)}}>
              <T heading size={38.4} weight={590} ls={-2.112} lh={57.6} color={colour.ink}>
                {title}
              </T>
            </View>
            <CloseButton label={closeLabel} onPress={onClose} onFocused={() => {
              if (closeFocusId) reportFocus(closeFocusId, undefined, focusOwner);
              onFocused?.();
            }} x={wide ? 1826 - WIDE_X : undefined} takesFocus={closeTakesFocus} />
            {sections.map((section, index) => {
              const top = tops[index]!;
              return (
                <View key={section.key} pointerEvents="box-none">
                  <View style={{position: 'absolute', left: u(CONTENT_X), top: u(top)}}>
                    <T heading size={9.6} weight={720} ls={0.672} lh={LABEL_H} color={colour.inkMuted} upper>
                      {section.label}
                    </T>
                  </View>
                  {'rows' in section
                    ? section.rows.map((row, rowIndex) => <Row key={row.key} row={row} x={CONTENT_X} y={top + LABEL_H + LABEL_GAP + rowIndex * (CHIP_H + CHIP_GAP)} w={wide ? WIDE_W - 2 * CONTENT_X : 268} onReveal={revealChip} />)
                    : 'chips' in section
                    ? section.chips.map((chip, chipIndex) => {
                        const col = chipIndex % section.columns;
                        const row = Math.floor(chipIndex / section.columns);
                        const width = section.columns === 2 ? 130 : 84;
                        const chipTop = top + LABEL_H + LABEL_GAP + row * (CHIP_H + CHIP_GAP);
                        return <Chip key={chip.key} chip={chip} x={CONTENT_X + col * (width + CHIP_GAP)} y={chipTop} w={width} onReveal={revealChip} focusOwner={focusOwner} />;
                      })
                    : 'select' in section
                    ? <SelectField label={section.label} value={section.select.value} onPress={section.select.onPress} x={CONTENT_X} y={top + LABEL_H + LABEL_GAP} w={wide ? WIDE_W - 2 * CONTENT_X : CONTENT_W} onReveal={revealChip} />
                    : section.render(top + LABEL_H + LABEL_GAP, revealChip)}
                </View>
              );
            })}
            {footer ? footer(end, revealChip) : null}
          </Animated.View>
        </TvFocusScope>
        <EdgeFade side="top" active={scrolled > 0} x={0} y={0} w={wide ? WIDE_W : DRAWER_W} h={1080} />
        <EdgeFade side="bottom" active={scrolled < max - 1} x={0} y={0} w={wide ? WIDE_W : DRAWER_W} h={1080} />
      </Animated.View>
    </>
  );
}

/** The drawer's close button. It takes focus itself when the drawer opens, even when a tile of the action column held it. */
export function CloseButton({label, onPress, onFocused, x = 1826 - DRAWER_X, takesFocus = true}: {label: string; onPress: () => void; onFocused?: () => void; x?: number; takesFocus?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!takesFocus) return undefined;
    const id = setTimeout(() => focusNode(ref), 300);
    return () => clearTimeout(id);
  }, [takesFocus]);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={label}
      {...lx('button', label, 50)}
      hasTVPreferredFocus={takesFocus}
      onFocus={() => {
        setFocused(true);
        onFocused?.();
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(54),
        width: u(48),
        height: u(50),
        borderRadius: 50,
        borderWidth: 1,
        borderColor: mix(colour.line, 0.76),
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colour.surfaceSoft,
      }}
    >
      <T size={26.88} weight={720} lh={40.32} color={colour.ink} dy={-1}>
        {'×'}
      </T>
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}

function ViewGlyph({icon, color}: {icon: ViewIcon; color: string}): React.ReactElement {
  const box = {borderWidth: 1, borderColor: color, borderRadius: 1};
  if (icon === 'list') {
    return (
      <View style={{width: u(20), height: u(13), justifyContent: 'space-between'}}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={[box, {height: u(3)}]} />
        ))}
      </View>
    );
  }
  const width = icon === 'cover' ? 16 : 20.5;
  return (
    <View style={{width: u(width), height: u(13), flexDirection: 'row', justifyContent: 'space-between'}}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[box, {width: u((width - 4) / 3), height: u(13)}]} />
      ))}
    </View>
  );
}

function Chip({chip, x, y, w, onReveal, focusOwner}: {chip: DrawerChip; x: number; y: number; w: number; onReveal: (y: number, h: number) => void; focusOwner: object}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = focused || chip.selected;
  const ink = lit ? colour.bg : colour.inkMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={chip.label}
      {...(chip.icon ? lx('button', capitalise(chip.label), 12) : null)}
      accessibilityState={{selected: chip.selected}}
      onFocus={() => {
        setFocused(true);
        onReveal(y, CHIP_H);
        reportFocus(chip.focusId ?? chip.label, undefined, focusOwner);
      }}
      onBlur={() => setFocused(false)}
      onPress={chip.onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        width: u(w),
        height: u(CHIP_H),
        borderRadius: u(12),
        borderWidth: 1,
        borderColor: lit ? colour.ink : mix(colour.line, 0.76),
        backgroundColor: lit ? colour.ink : mix(colour.surfaceSoft, 0.64),
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: chip.icon ? 'column' : 'row',
        paddingHorizontal: u(6),
        transform: [{scale: lit ? 1.025 : 1}],
      }}
    >
      {chip.icon ? (
        <View style={{marginBottom: u(8.6)}}>
          <ViewGlyph icon={chip.icon} color={ink} />
        </View>
      ) : null}
      <View style={chip.icon ? undefined : {flexShrink: 1}}>
        <T size={10.56} weight={chip.icon ? 900 : 680} lh={chip.icon ? 11.6 : 15.84} color={ink} style={chip.icon ? undefined : {textAlign: 'center'}}>
          {capitalise(chip.label)}
        </T>
      </View>
    </Pressable>
  );
}

/** Capitalises the first letter of each word and leaves the rest alone (CSS `text-transform: capitalize`), so "TV" stays "TV". */
function capitalise(text: string): string {
  return text.replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`);
}

function Row({row, x, y, w, onReveal}: {row: DrawerRow; x: number; y: number; w: number; onReveal: (y: number, h: number) => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  const lit = focused || row.selected;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.title}
      accessibilityState={{selected: row.selected}}
      onFocus={() => {
        setFocused(true);
        onReveal(y, CHIP_H);
      }}
      onBlur={() => setFocused(false)}
      onPress={row.onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        width: u(w),
        height: u(CHIP_H),
        borderRadius: u(12),
        borderWidth: 1,
        borderColor: lit ? colour.ink : mix(colour.line, 0.76),
        backgroundColor: lit ? colour.ink : mix(colour.surfaceSoft, 0.64),
        justifyContent: 'center',
        paddingLeft: u(9.6),
        transform: [{scale: lit ? 1.025 : 1}],
      }}
    >
      <T size={10.56} weight={900} lh={15.8} color={lit ? colour.bg : colour.inkMuted}>
        {row.title}
      </T>
      {row.detail ? (
        <T size={8.6592} weight={680} lh={13} color={lit ? colour.bg : colour.inkMuted}>
          {row.detail}
        </T>
      ) : null}
      {row.selected ? (
        <View style={{position: 'absolute', right: u(13), top: u(18)}}>
          <T size={10.56} weight={680} lh={16.2} color="#cf3157">
            {'\u2713'}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

function SelectField({label, value, onPress, x, y, w, onReveal}: {label: string; value: string; onPress: () => void; x: number; y: number; w: number; onReveal: (y: number, h: number) => void}): React.ReactElement {
  const {colour} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onFocus={() => {
        setFocused(true);
        onReveal(y, SELECT_H);
      }}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      {...lx('group', '', 12)}
      style={{position: 'absolute', left: u(x), top: u(y), width: u(w), height: u(SELECT_H), borderRadius: u(12), borderWidth: 1, borderColor: colour.lineStrong, backgroundColor: mix(colour.surfaceSoft, 0.64), padding: u(6.39)}}
    >
      <View {...lx('button', `${value} \u2304`, 10)} style={{flex: 1, borderRadius: u(10), flexDirection: 'row', alignItems: 'center', paddingHorizontal: u(12)}}>
        <View style={{flex: 1}}>
          <T size={11.84} weight={680} lh={17.76} color={colour.ink} lines={1}>
            {value}
          </T>
        </View>
        <View {...lx('skip')}>
          <T size={11.84} weight={680} lh={17.76} color={colour.inkMuted}>
            {'\u2304'}
          </T>
        </View>
      </View>
      {focused ? <FocusRing radius={12} /> : null}
    </Pressable>
  );
}
