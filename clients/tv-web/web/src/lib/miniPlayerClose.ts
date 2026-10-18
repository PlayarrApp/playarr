/**
 * Closing the mini player: stop through the player's existing stop path, then put focus back so it is never lost.
 * Focus goes to the page element that held it before the mini player took it, else the page's default focus
 * (`data-tv-focus-default`, else the first control in the page body).
 */
export type FocusTarget = { isConnected: boolean; focus: () => void; closest: (selector: string) => unknown };
export type FocusRoot = { querySelector: (selector: string) => FocusTarget | null };

const MINI_PLAYER_SELECTOR = ".player-page";
const PAGE_CONTROL_SELECTOR = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

let focusBeforeMiniPlayer: FocusTarget | null = null;

/** Call from the mini player's focus handlers: remembers the last element focused outside the player. */
export function rememberFocusBeforeMiniPlayer(previous: FocusTarget | null): void {
  if (previous && !previous.closest(MINI_PLAYER_SELECTOR)) focusBeforeMiniPlayer = previous;
}

export function restoreFocusAfterMiniPlayerClose(root: FocusRoot): FocusTarget | null {
  const previous = focusBeforeMiniPlayer;
  focusBeforeMiniPlayer = null;
  const target =
    (previous?.isConnected ? previous : null) ??
    root.querySelector("[data-tv-focus-default]") ??
    root.querySelector(`.app-main :is(${PAGE_CONTROL_SELECTOR})`) ??
    root.querySelector(`.app-nav :is(${PAGE_CONTROL_SELECTOR})`);
  target?.focus();
  return target;
}

export function closeMiniPlayer(onStop: () => void, root: FocusRoot, schedule: (run: () => void) => void): void {
  onStop();
  // The mini player unmounts after the stop state commits; focus the page once it has gone.
  schedule(() => restoreFocusAfterMiniPlayerClose(root));
}
