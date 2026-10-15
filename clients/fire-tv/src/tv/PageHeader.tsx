/** The web's `page-header` on a stage page: the round back button, the page title and its detail, and the clock gap. */
import React, {useRef, useState} from 'react';
import {LayoutChangeEvent, Pressable, View} from 'react-native';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {T, u, uf} from './kit';

export interface BackButtonProps {
  onPress: () => void;
  x?: number;
  y?: number;
  size?: number;
  accessibilityLabel?: string;
  hasTVPreferredFocus?: boolean;
}

export function BackButton({onPress, x = 153.6, y = 56.2, size = 50, accessibilityLabel = 'Back', hasTVPreferredFocus}: BackButtonProps): React.ReactElement {
  const {colour, scheme} = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={onPress}
      style={{
        position: 'absolute',
        left: u(x),
        top: u(y),
        width: u(size),
        height: u(size),
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: mix(colour.surfaceStrong, 0.7),
        borderWidth: 1,
        borderColor: mix(colour.lineStrong, 0.7),
      }}
    >
      <T size={17.28} weight={720} color={colour.inkSoft} lh={25.9} dy={3}>
        {'←'}
      </T>
      {focused ? (
        <View
          pointerEvents="none"
          style={{position: 'absolute', left: u(-5), top: u(-5), right: u(-5), bottom: u(-5), borderRadius: 999, borderWidth: u(3), borderColor: scheme === 'dark' ? '#ffffff' : colour.ink}}
        />
      ) : null}
    </Pressable>
  );
}

export interface PageHeaderProps {
  title: string;
  /** The page subtitle (a count, or the open title): web's one shared `.page-subtitle` style, beside the title or wrapped under it. */
  detail?: string;
  onBack: () => void;
  backLabel?: string;
  backFocus?: boolean;
}

const HEADER_X = 226.6;
/** Web: the title, 24 px, a 1 px divider, 24 px, the subtitle; the subtitle wraps under the title when it would run into the clock (475.75 minus the 24 px gap). */
const HEADER_GAP = 24;
const HEADER_BESIDE_LIMIT = 451.75;

export function PageHeader({title, detail, onBack, backLabel, backFocus}: PageHeaderProps): React.ReactElement {
  const {colour} = useTheme();
  const [widths, setWidths] = useState<{title: number; detail: number} | null>(null);
  const measured = useRef<{title?: number; detail?: number}>({});
  const measure = (key: 'title' | 'detail') => (event: LayoutChangeEvent): void => {
    measured.current[key] = event.nativeEvent.layout.width / uf(1);
    const {title: tw, detail: dw} = measured.current;
    if (tw !== undefined && (detail === undefined || dw !== undefined)) setWidths((current) => (current && Math.abs(current.title - tw) < 0.5 && Math.abs(current.detail - (dw ?? 0)) < 0.5 ? current : {title: tw, detail: dw ?? 0}));
  };
  const beside = widths !== null && detail !== undefined && HEADER_X + widths.title + HEADER_GAP * 2 + 1 + widths.detail <= HEADER_BESIDE_LIMIT;
  const subtitle = (
    <T size={11.14} weight={680} ls={0.5} lh={16.7} color={colour.ink} upper lines={1}>
      {detail}
    </T>
  );
  return (
    <>
      <BackButton onPress={onBack} accessibilityLabel={backLabel} hasTVPreferredFocus={backFocus} />
      <View style={{position: 'absolute', left: u(HEADER_X), top: u(56.2), height: u(50), flexDirection: 'row', alignItems: 'center'}} pointerEvents="none">
        <View onLayout={measure('title')}>
          <T size={33.6} weight={580} ls={-1.512} lh={50} dy={1} color={colour.ink} lines={1}>
            {title}
          </T>
        </View>
        {detail !== undefined && beside ? (
          <>
            <View style={{width: u(1), height: u(17), marginHorizontal: u(HEADER_GAP), backgroundColor: colour.lineStrong}} />
            {subtitle}
          </>
        ) : null}
      </View>
      {detail !== undefined ? (
        <View
          style={{position: 'absolute', left: u(HEADER_X), top: u(beside ? 72.7 : 117.65), opacity: widths === null || beside ? 0 : 1}}
          pointerEvents="none"
        >
          <View onLayout={measure('detail')} style={{position: 'absolute', opacity: 0}}>{subtitle}</View>
          {!beside && widths !== null ? <View style={{position: 'absolute', left: 0, top: u(-4.8), width: u(widths.detail), height: u(1), backgroundColor: colour.lineStrong}} /> : null}
          {!beside ? subtitle : null}
        </View>
      ) : null}
    </>
  );
}
