/**
 * Props that tell the parity layout exporter (layoutExport.tsx) what a view is on the web: its role and accessible name, or the
 * CSS font of a raw Text. Empty in a normal build, so nothing reaches a host view there.
 */
import {PARITY_CONTROL} from './parityControl';
import {registerLines} from './layoutExport';

export function lx(role: string, label?: string, radius?: number, opacity?: number): object {
  return PARITY_CONTROL ? {parityRole: role, parityLabel: label, parityRadius: radius, parityOpacity: opacity} : {};
}




/** A drawn glyph or text that is a text element on the web (an svg icon standing for a character). */
export function lt(text: string, size: number, weight: number, color: string): object {
  return PARITY_CONTROL ? {parityRole: 'text', parityLabel: text, parityText: {size, weight, color}} : {};
}

/** The CSS font of a Text that does not go through `T`. */
/** `exact`: the web rect is the element's line box (the header clock and date), not the glyph run. */
export function lf(size: number, weight: number, lh?: number, exact?: boolean): object {
  if (!PARITY_CONTROL) return {};
  const holder: {node: object | null} = {node: null};
  return {
    parityFont: {size, weight, lh, exact},
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
