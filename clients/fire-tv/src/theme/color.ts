/** `color-mix(in srgb, <colour> N%, transparent)` for the palette's `#rrggbb` and `rgba()` values: the colour at N% of its own alpha. */
export function mix(color: string, fraction: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha8(fraction)})`;
  }
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (rgba) {
    const alpha = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha8(alpha * fraction)})`;
  }
  throw new Error(`mix(): unsupported colour ${color}`);
}

/**
 * Blink stores a colour's alpha as one byte, truncated: `color-mix(in srgb, X 14%, transparent)` is painted with alpha
 * floor(0.14 * 255) = 35, not 35.7. The same byte alpha is declared here, so the surface it composites over resolves to the
 * channel values the web paints (0.7 over the surface is 178/255, which composites 27.49 to 27, not 27.51 to 28).
 */
function alpha8(value: number): number {
  return Math.round((Math.floor(value * 255 + 1e-6) / 255) * 100000) / 100000;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function channels(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), rgba[4] === undefined ? 1 : Number(rgba[4])];
  throw new Error(`unsupported colour ${color}`);
}

/** `color-mix(in srgb, a N%, b)`: `fraction` of `a` over the rest of `b`, as an opaque `rgb()` when both are opaque. */
export function blend(a: string, b: string, fraction: number): string {
  const [ar, ag, ab, aa] = channels(a);
  const [br, bg, bb, ba] = channels(b);
  const alpha = aa * fraction + ba * (1 - fraction);
  const channel = (x: number, y: number): number => Math.round((x * aa * fraction + y * ba * (1 - fraction)) / (alpha || 1));
  const [r, g, bl] = [channel(ar, br), channel(ag, bg), channel(ab, bb)];
  return alpha >= 0.999 ? `rgb(${r}, ${g}, ${bl})` : `rgba(${r}, ${g}, ${bl}, ${round(alpha)})`;
}

/** The same colour with another alpha, for gradient stops that fade to "transparent" without greying. */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = channels(color);
  return `rgba(${r}, ${g}, ${b}, ${alpha8(alpha)})`;
}
