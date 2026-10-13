/**
 * The focus state of a media card (owner ruling 2026-10-08): a soft shadow plus an animated lift, with no ring and no
 * fill. Controls (buttons, pills, Back) keep the focus ring; only content cards use this.
 *
 * Values are the web's pinned card-focus numbers (docs/design/page-layout.md section 5 item 1a, reference commit
 * de371253), in web px at 1920x1080:
 *  - card lift: translateY(-7px); library grid -5px with scale 1.015; Home -6px; search results -6px with scale 1.015;
 *  - art: scale 1.025;
 *  - focused art shadow: 0 24px 48px rgba(56,38,33,.30) + 0 10px 20px rgba(56,38,33,.20) (Home 0 26px 52px .32 + 0 11px
 *    22px .22; search 0 22px 52px rgba(31,14,20,.28)); at rest: 0 10px 20px .14 + 0 3px 8px .10.
 * Owner 2026-10-09 (web `--card-glow`): a focused card also takes a subtle pink glow ring, a 3 px ring in the brand ink (dark) or
 * strong brand (light) plus a 20 px glow at 45%.
 * The lift is a transform, so it never changes the layout frames Vega's focus engine measures (UP and DOWN stay
 * geometric). Vega RN exposes native shadow props, which render the CSS shadow layers with blur instead of visible
 * stepped rectangles.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, View, type StyleProp, type ViewStyle} from 'react-native';
import {useTheme} from '../theme/ThemeProvider';
import {u} from './kit';

export type MediaFocusVariant = 'default' | 'library' | 'home' | 'search';

interface Shadow {
  y: number;
  blur: number;
  alpha: number;
  color: string;
}

const WARM = '#382621';
const DEEP = '#1f0e14';

export const MEDIA_FOCUS = {
  variants: {
    default: {lift: 7, scale: 1, shadow: [{y: 24, blur: 48, alpha: 0.3, color: WARM}, {y: 10, blur: 20, alpha: 0.2, color: WARM}] as Shadow[]},
    library: {lift: 5, scale: 1.015, shadow: [{y: 24, blur: 48, alpha: 0.3, color: WARM}, {y: 10, blur: 20, alpha: 0.2, color: WARM}] as Shadow[]},
    home: {lift: 6, scale: 1, shadow: [{y: 26, blur: 52, alpha: 0.32, color: WARM}, {y: 11, blur: 22, alpha: 0.22, color: WARM}] as Shadow[]},
    search: {lift: 6, scale: 1.015, shadow: [{y: 22, blur: 52, alpha: 0.28, color: DEEP}] as Shadow[]},
  },
  rest: [{y: 10, blur: 20, alpha: 0.14, color: WARM}, {y: 3, blur: 8, alpha: 0.1, color: WARM}] as Shadow[],
  artScale: 1.025,
  /** `transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)`. */
  durationMs: 260,
  easing: Easing.bezier(0.2, 0.8, 0.2, 1),
} as const;

/** Use Vega's native blurred shadow instead of drawing a few hard-edged rectangles as a CSS blur approximation. */
function ShadowLayers({shadows, radius, backgroundColor, strength = 1}: {shadows: readonly Shadow[]; radius: number; backgroundColor: string; strength?: number}): React.ReactElement {
  return (
    <>
      {shadows.map((shadow) => (
        <View
          key={`${shadow.y}-${shadow.blur}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            borderRadius: u(radius),
            backgroundColor,
            shadowColor: shadow.color,
            shadowOffset: {width: 0, height: u(shadow.y)},
            shadowOpacity: strength * shadow.alpha,
            shadowRadius: u(shadow.blur),
          }}
        />
      ))}
    </>
  );
}

/** The web's `--card-glow`: a 3 px outline plus a blurred 20 px halo. */
function GlowRing({radius, colour, backgroundColor}: {radius: number; colour: string; backgroundColor: string}): React.ReactElement {
  return (
    <>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: -u(7),
          top: -u(7),
          right: -u(7),
          bottom: -u(7),
          borderRadius: u(radius + 7),
          backgroundColor,
          shadowColor: colour,
          shadowOffset: {width: 0, height: 0},
          shadowOpacity: 0.45,
          shadowRadius: u(20),
        }}
      />
      <View style={{position: 'absolute', left: -u(3), top: -u(3), right: -u(3), bottom: -u(3), borderRadius: u(radius + 3), borderWidth: u(3), borderColor: colour}} />
    </>
  );
}

export interface MediaFocusProps {
  focused: boolean;
  width: number;
  height: number;
  radius: number;
  variant?: MediaFocusVariant;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/** Wraps the artwork of a card: lifts and enlarges it and cross-fades its shadow from the rest shadow to the focused one. */
export function MediaFocus({focused, width, height, radius, variant = 'default', style, children}: MediaFocusProps): React.ReactElement {
  const spec = MEDIA_FOCUS.variants[variant];
  const {scheme, colour: palette} = useTheme();
  const glow = scheme === 'dark' ? '#eaa6b6' : '#a52745';
  const progress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  // The focused shadow is only mounted while it is visible or fading: a Home or library page holds dozens of cards.
  const [shadowMounted, setShadowMounted] = useState(focused);
  useEffect(() => {
    if (focused) setShadowMounted(true);
    const animation = Animated.timing(progress, {toValue: focused ? 1 : 0, duration: MEDIA_FOCUS.durationMs, easing: MEDIA_FOCUS.easing, useNativeDriver: true});
    animation.start(({finished}) => {
      if (finished && !focused) setShadowMounted(false);
    });
    return () => animation.stop();
  }, [focused, progress]);
  const lift = progress.interpolate({inputRange: [0, 1], outputRange: [0, -u(spec.lift)]});
  const scale = progress.interpolate({inputRange: [0, 1], outputRange: [1, spec.scale * MEDIA_FOCUS.artScale]});
  const restOpacity = progress.interpolate({inputRange: [0, 1], outputRange: [1, 0]});
  return (
    <Animated.View style={[{width: u(width), height: u(height), transform: [{translateY: lift}, {scale}]}, style]}>
      <Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: restOpacity}}>
        <ShadowLayers shadows={MEDIA_FOCUS.rest} radius={radius} backgroundColor={palette.surfaceSoft} strength={0.8} />
      </Animated.View>
      {shadowMounted ? (
        <Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: progress}}>
          <ShadowLayers shadows={spec.shadow} radius={radius} backgroundColor={palette.surfaceSoft} />
          <GlowRing radius={radius} colour={glow} backgroundColor={palette.surfaceSoft} />
        </Animated.View>
      ) : null}
      <View style={{width: u(width), height: u(height), borderRadius: u(radius), overflow: 'hidden'}}>{children}</View>
    </Animated.View>
  );
}
