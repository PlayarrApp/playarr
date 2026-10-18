export const LONG_PRESS_MS = 650;

/**
 * Whether an OK press counts as a long press, judged from the key events' own timestamps. The hold timer alone is not enough: on a
 * busy main thread (Tizen 6.5 TVs) the browser handles the key release before the overdue timer, so a real hold read as a short press.
 */
export function isLongHold(pressedAt: number | undefined, releasedAt: number): boolean {
  return pressedAt !== undefined && releasedAt - pressedAt >= LONG_PRESS_MS;
}
