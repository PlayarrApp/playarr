/**
 * Accessible role and name of a view. These are the app's real accessibility props (in every build): the names and roles a screen
 * reader gets are the same as the web client's, so the layout exporter reads them straight from the view and invents nothing.
 * `container`, `image`, `skip` and `none` make no accessibility claim.
 */
import {PARITY_CONTROL} from './parityControl';
import {registerLines} from './layoutExport';

const NO_CLAIM = new Set(['container', 'skip', 'none', 'text']);
/** `img` is the ARIA role of a drawn graphic (the watch-progress track); React Native passes the string through. */

export function lx(role: string, label?: string, _radius?: number): object {
  if (NO_CLAIM.has(role)) return {};
  if (role === 'img') return {accessibilityRole: 'img' as never};
  return {accessibilityRole: role, accessibilityLabel: label ?? ''};
}

/** Hands the renderer's own text lines (onTextLayout) of a Text that does not go through `T` to the layout exporter. */
export function lf(): object {
  if (!PARITY_CONTROL) return {};
  const holder: {node: object | null} = {node: null};
  return {
    ref: (node: object | null) => {
      holder.node = node;
    },
    onTextLayout: (event: {nativeEvent: {lines: Array<{x: number; y: number; width: number; height: number}>}}) => registerLines(holder.node, event.nativeEvent.lines),
  };
}

/**
 * `useNativeDriver` for animations: a parity build drives them from JS, so the native view frames the layout exporter measures
 * include the animated transform (a native-driven value never reaches the shadow tree).
 */
export const NATIVE_DRIVER = !PARITY_CONTROL;
