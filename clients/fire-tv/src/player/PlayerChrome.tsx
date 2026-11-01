/**
 * The player's controls, drawn at the web TV player's measurements (`player-controls` and `player-quality-menu` in
 * scripts/parity/screens.json): the close button at the top right, the scrubber, the transport row and, on the right, the
 * subtitles and quality buttons. The bottom scrim rises from the bottom edge and recedes downwards, as the spec requires.
 *
 * This file only draws and reports focus; PlayerScreen owns playback, the key handling and Back (docs: PLAYER-SPEC).
 */
import React, {useEffect, useRef, useState} from 'react';
import {Animated, Easing, Pressable, StyleSheet, View} from 'react-native';
import LinearGradient from '@amazon-devices/react-linear-gradient';
import {Icon, type IconName} from '../shell/icons';
import {mix} from '../theme/color';
import {useTheme} from '../theme/ThemeProvider';
import {FocusRing} from '../tv/FocusRing';
import {T, u} from '../tv/kit';
import {lx, NATIVE_DRIVER} from '../debug/layoutMarks';
import {reportFocus} from '../debug/parityControl';

export type ChromeControl = 'close' | 'scrubber' | 'play' | 'subtitles' | 'quality' | 'prev' | 'next' | 'mute' | 'volume' | 'audio' | 'playlist' | 'info' | 'cast' | 'fullscreen';

export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export interface PlayerChromeProps {
  visible: boolean;
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  bufferedSeconds: number;
  /** While the viewer steps the scrubber: where the seek will land. */
  seekTargetSeconds: number | null;
  qualityLabel: string;
  hasSubtitles: boolean;
  subtitlesOn: boolean;
  /** The control that had focus when the chrome last hid: it gets focus back when the chrome shows. */
  focused: ChromeControl | null;
  onFocusControl: (control: ChromeControl) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  onOpenQuality: () => void;
  onOpenSubtitles: () => void;
  /** 0 to 1, and whether the player is muted. */
  volume: number;
  muted: boolean;
  /** Whether a previous / next title exists in the queue. */
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggleMute: () => void;
  /** The audio track's name, or null while the file has no choice of audio. */
  audioLabel: string | null;
  onOpenAudio: () => void;
  /** The queue's length (1 for a single title). */
  queueCount: number;
  onOpenPlaylist: () => void;
  onOpenInfo: () => void;
  onOpenCast: () => void;
  onToggleFullscreen: () => void;
  qualityRef?: React.RefObject<View>;
  playRef?: React.RefObject<View>;
  subtitlesRef?: React.RefObject<View>;
}

const SCRUB_X = 70;
const SCRUB_W = 1780;
/** The web slider box: 70, 914, 1780 x 44; its 6 px track sits at y 933. */
const SCRUB_TOP = 914;

export function PlayerChrome(props: PlayerChromeProps): React.ReactElement {
  const {colour} = useTheme();
  const rise = useRef(new Animated.Value(props.visible ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(rise, {toValue: props.visible ? 1 : 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE_DRIVER}).start();
  }, [props.visible, rise]);
  const scrimShift = rise.interpolate({inputRange: [0, 1], outputRange: [u(340), 0]});
  const topFade = rise;
  const duration = props.durationSeconds > 0 ? props.durationSeconds : 0;
  const shown = props.seekTargetSeconds ?? props.positionSeconds;
  const played = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const buffered = duration > 0 ? Math.min(1, Math.max(played, props.bufferedSeconds / duration)) : 0;

  return (
    <View {...lx('container', '')} style={StyleSheet.absoluteFill} pointerEvents={props.visible ? 'box-none' : 'none'}>
      {/* Scrim: rises from the bottom, recedes downwards. */}
      <Animated.View pointerEvents="none" {...lx('container', '')} style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: u(518.39), transform: [{translateY: scrimShift}]}}>
        <LinearGradient style={StyleSheet.absoluteFill} start={{x: 0, y: 0}} end={{x: 0, y: 1}} colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.86)']} locations={[0, 0.19, 0.6355, 1]} />
      </Animated.View>
      {/* The top gradient fades separately. */}
      <Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0, top: 0, height: u(200), opacity: topFade}}>
        <LinearGradient style={StyleSheet.absoluteFill} start={{x: 0, y: 0}} end={{x: 0, y: 1}} colors={['rgba(0,0,0,0.55)', 'rgba(0,0,0,0)']} />
      </Animated.View>

      <Animated.View key={props.visible ? 'shown' : 'hidden'} style={{...StyleSheet.absoluteFillObject, opacity: rise}} pointerEvents={props.visible ? 'box-none' : 'none'}>
        <RoundButton icon="close" label="Close" web="Close player" size={48} x={1814} y={37.8} iconSize={14} control="close" {...props} onPress={props.onClose} />
        <MinimisePill />

        <Scrubber {...props} played={played} buffered={buffered} targetShown={props.seekTargetSeconds !== null} shownSeconds={shown} />

        <RoundButton icon="skipPrev" label="Previous episode" size={64} x={70} y={958} iconSize={20} control="prev" {...props} onPress={props.onPrev} bare focusable={props.hasPrev} dim={!props.hasPrev} />
        <RoundButton icon="skipNext" label="Next episode" size={64} x={225.19} y={958} iconSize={20} control="next" {...props} onPress={props.onNext} bare focusable={props.hasNext} dim={!props.hasNext} />
        <RoundButton icon={props.playing ? 'pause' : 'play'} label={props.playing ? 'Pause' : 'Play'} web={props.playing ? 'Pause' : 'Play'} size={64} x={147.59} y={958} iconSize={20} control="play" {...props} nodeRef={props.playRef} onPress={props.onTogglePlay} filled />
        <View style={{position: 'absolute', left: u(302.78), top: u(978.7), flexDirection: 'row'}} pointerEvents="none">
          <T size={10.88} weight={400} color="#ffffff" lh={22} lines={1}>
            {formatTime(shown)}
          </T>
          <View style={{marginHorizontal: u(5.6)}}>
            <T size={10.88} weight={400} color="#ffffff" lh={22} lines={1}>
              /
            </T>
          </View>
          <T size={10.88} weight={400} color="#ffffff" lh={22} lines={1}>
            {formatTime(duration)}
          </T>
        </View>

        {/* The group at the web's positions (64 px buttons 77.59 px apart). Mute and Fullscreen are in the control row as in the web's xbox user-agent session; the volume slider is not focusable there. */}
        <RoundButton icon={props.muted || props.volume === 0 ? 'volumeOff' : 'volume'} label={props.muted ? 'Unmute' : 'Mute'} web={props.muted ? 'Unmute' : 'Mute'} size={64} x={374.77} y={958} iconSize={20} control="mute" {...props} onPress={props.onToggleMute} bare />
        <VolumeSlider {...props} />
        <RoundButton icon="audio" label={`Audio: ${props.audioLabel ?? 'Unavailable'}`} size={64} x={1223.98} y={958} iconSize={20} control="audio" {...props} onPress={props.onOpenAudio} bare focusable={props.audioLabel !== null} dim={props.audioLabel === null} />
        <RoundButton icon="subtitles" label="Subtitles" web={`Subtitles: ${props.subtitlesOn ? 'On' : 'Off'}`} size={64} x={1301.58} y={958} iconSize={20} control="subtitles" {...props} nodeRef={props.subtitlesRef} onPress={props.onOpenSubtitles} dim={!props.subtitlesOn} />
        <RoundButton icon="queue" label={`Playlist: ${props.queueCount} item${props.queueCount === 1 ? '' : 's'}`} size={64} x={1379.17} y={958} iconSize={20} control="playlist" {...props} onPress={props.onOpenPlaylist} bare />
        <QualityPill {...props} />
        <RoundButton icon="info" label="Info and playback health" size={64} x={1630.81} y={958} iconSize={20} control="info" {...props} onPress={props.onOpenInfo} bare />
        <RoundButton icon="cast" label="Play on another device" size={64} x={1708.41} y={958} iconSize={20} control="cast" {...props} onPress={props.onOpenCast} bare />
        <RoundButton icon="fullscreen" label="Enter fullscreen" size={64} x={1786} y={958} iconSize={20} control="fullscreen" {...props} onPress={props.onToggleFullscreen} bare />
      </Animated.View>
    </View>
  );
}

function RoundButton(props: PlayerChromeProps & {nodeRef?: React.RefObject<View>; icon: IconName; label: string; web?: string; size: number; x?: number; y?: number; iconSize?: number; control: ChromeControl; onPress: () => void; filled?: boolean; dim?: boolean; inline?: boolean; focusable?: boolean; bare?: boolean}): React.ReactElement {
  const {colour} = useTheme();
  const focused = props.focused === props.control;
  const innerStyle = {
    ...(props.inline ? {marginHorizontal: u(15.5)} : {position: 'absolute' as const, left: u(props.x ?? 0), top: u(props.y ?? 0)}),
    width: u(props.size),
    height: u(props.size),
    borderRadius: u(props.size / 2),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: props.filled ? 'rgba(255,255,255,0.14)' : props.inline || props.bare ? 'transparent' : mix('#000000', 0.42),
  };
  // The web skips a disabled button when it walks the control row (rowControls filters `disabled`): it is drawn, never focused.
  if (props.focusable === false) {
    return (
      <View accessibilityRole="button" accessibilityLabel={props.label} {...lx('button', props.web ?? props.label, 50)} style={innerStyle}>
        <Icon name={props.icon} size={u(props.iconSize ?? 16)} color={props.dim ? colour.inkMuted : '#ffffff'} strokeWidth={2} />
      </View>
    );
  }
  return (
    <Pressable
      ref={props.nodeRef}
      accessibilityRole="button"
      accessibilityLabel={props.label}
      {...lx('button', props.web ?? props.label, 50)}
      focusable={props.focusable}
      hasTVPreferredFocus={props.control === 'play'}
      onFocus={() => {
        reportFocus(props.web ?? props.label);
        props.onFocusControl(props.control);
      }}
      onPress={props.onPress}
      style={innerStyle}
    >
      <Icon name={props.icon} size={u(props.iconSize ?? 16)} color={props.dim ? colour.inkMuted : '#ffffff'} strokeWidth={2} />
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}

function Scrubber(props: PlayerChromeProps & {played: number; buffered: number; targetShown: boolean; shownSeconds: number}): React.ReactElement {
  const focused = props.focused === 'scrubber';
  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel="Seek"
      {...lx('slider', 'Seek')}
      onFocus={() => {
        reportFocus('Seek');
        props.onFocusControl('scrubber');
      }}
      onPress={props.onTogglePlay}
      style={{position: 'absolute', left: u(SCRUB_X), top: u(SCRUB_TOP), width: u(SCRUB_W), height: u(44), justifyContent: 'center'}}
    >
      {/* The web track (.player-seek-track): a 6 px square bar, white at 0.2, with the buffered range at 0.34 and the progress in the accent; focus never changes its height. */}
      <View style={{height: u(6), backgroundColor: 'rgba(255,255,255,0.2)', overflow: 'hidden'}}>
        <View style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${props.buffered * 100}%`, backgroundColor: 'rgba(255,255,255,0.34)'}} />
        <View {...lx('container', '')} style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${props.played * 100}%`, backgroundColor: '#cf3157'}} />
      </View>
      {focused ? (
        <>
          {/* Focused thumb: 24 px, the player ink with a 3 px accent ring (the web's box-shadow spread). */}
          <View
            style={{position: 'absolute', left: props.played * u(SCRUB_W) - u(12), top: u(10), width: u(24), height: u(24), borderRadius: 999, backgroundColor: '#ffffff', borderWidth: u(3), borderColor: '#cf3157'}}
          />
          {props.targetShown ? (
            <View style={{position: 'absolute', left: props.played * u(SCRUB_W) - u(36), top: u(-34), width: u(72), alignItems: 'center'}}>
              <T size={12} weight={700} color="#ffffff" lh={20}>
                {formatTime(props.shownSeconds)}
              </T>
            </View>
          ) : null}
        </>
      ) : null}
    </Pressable>
  );
}

function QualityPill(props: PlayerChromeProps): React.ReactElement {
  const focused = props.focused === 'quality';
  const [pressed, setPressed] = useState(false);
  void pressed;
  return (
    <Pressable
      ref={props.qualityRef}
      accessibilityRole="button"
      accessibilityLabel={`Quality: ${props.qualityLabel}`}
      {...lx('button', `Quality: ${props.qualityLabel}`, 999)}
      onFocus={() => {
        reportFocus(`Quality: ${props.qualityLabel}`);
        props.onFocusControl('quality');
      }}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={props.onOpenQuality}
      style={{
        position: 'absolute',
        left: u(1456.77),
        top: u(962),
        height: u(56),
        paddingHorizontal: u(19),
        borderRadius: u(28),
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: focused ? 'rgba(255,255,255,0.14)' : 'transparent',
      }}
    >
      <Icon name="hd" size={u(18)} color="#ffffff" strokeWidth={1.8} />
      <View style={{marginLeft: u(12)}}>
        <T size={10.56} weight={700} color="#ffffff" lh={20} lines={1}>
          {props.qualityLabel}
        </T>
      </View>
      {focused ? <FocusRing /> : null}
    </Pressable>
  );
}

/** The web's volume range (130 x 44 at 448.77, 968): left and right on the remote step it, Select mutes. */
function VolumeSlider(props: PlayerChromeProps): React.ReactElement {
  const focused = props.focused === 'volume';
  const level = props.muted ? 0 : props.volume;
  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel="Volume"
      accessibilityValue={{min: 0, max: 100, now: Math.round(level * 100)}}
      {...lx('textbox', 'Volume')}
      style={{position: 'absolute', left: u(448.77), top: u(968), width: u(130), height: u(44), justifyContent: 'center'}}
    >
      <View style={{height: u(focused ? 6 : 4), borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden'}}>
        <View style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${level * 100}%`, backgroundColor: '#ffffff'}} />
      </View>
    </View>
  );
}

function MinimisePill(): React.ReactElement {
  return (
    <View
      pointerEvents="none"
      style={{position: 'absolute', left: u(1678), top: u(37.8), width: u(124), height: u(48), borderRadius: u(24), borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center'}}
    >
      <Icon name="minimise" size={u(20)} color="#ffffff" strokeWidth={2} />
      <View style={{marginLeft: u(10)}}>
        <T size={11.2} weight={700} color="#ffffff" lh={20} lines={1}>
          Minimise
        </T>
      </View>
    </View>
  );
}
