/**
 * Parity-build helpers that read the laid-out app (layoutExport.tsx). Nothing here tells the exporter what the web looks like.
 */
import {PARITY_CONTROL} from './parityControl';
import {registerLines, type Line} from './layoutExport';

/**
 * Spread onto a Text that does not go through `T`: records the renderer's line layout of that Text for the exporter. Empty in a
 * normal build, so nothing reaches the view there.
 */
export function measured(): object {
  if (!PARITY_CONTROL) return {};
  const holder: {node: object | null} = {node: null};
  return {
    ref: (node: object | null) => {
      holder.node = node;
    },
    onTextLayout: (event: {nativeEvent: {lines: Line[]}}) => registerLines(holder.node, event.nativeEvent.lines),
  };
}

/**
 * `useNativeDriver` for animations: a parity build drives them from JS, so the native view frames the layout exporter measures
 * include the animated transform (a native-driven value never reaches the shadow tree).
 */
export const NATIVE_DRIVER = !PARITY_CONTROL;
