/**
 * One shared page scroll lock for modal panels (ref-counted, so stacked panels work). The app scrolls inside
 * `.app-main` and nested scrollers, not the body, so instead of freezing one element it swallows every wheel, touch and
 * scroll-key input that does not start inside a scrollable part of an open panel. Nothing is moved or restyled, so
 * closing restores the exact scroll position with no jump; overscroll-behavior on the panel body stops chaining.
 */
const SCROLL_KEYS = new Set([" ", "PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown"]);
let locks = 0;

function insideScrollablePanel(target: EventTarget | null): boolean {
  for (let node = target instanceof Element ? target : null; node; node = node.parentElement) {
    if (node.matches(".tv-filter-drawer .drawer-body") && node.scrollHeight > node.clientHeight) return true;
    if (node.matches(".tv-filter-drawer")) return false;
  }
  return false;
}

const swallow = (event: Event) => {
  if (!insideScrollablePanel(event.target)) event.preventDefault();
};

const swallowKey = (event: KeyboardEvent) => {
  if (!SCROLL_KEYS.has(event.key) || event.defaultPrevented) return;
  const target = event.target;
  // Typing and the panel's own controls keep their keys; only a scroll key aimed at the page is swallowed.
  if (target instanceof Element && (target.closest(".tv-filter-drawer") || target.closest("input, textarea, select, [contenteditable]"))) return;
  event.preventDefault();
};

export function lockPageScroll(): () => void {
  if (locks++ === 0) {
    document.addEventListener("wheel", swallow, { passive: false, capture: true });
    document.addEventListener("touchmove", swallow, { passive: false, capture: true });
    document.addEventListener("keydown", swallowKey, true);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--locks === 0) {
      document.removeEventListener("wheel", swallow, true);
      document.removeEventListener("touchmove", swallow, true);
      document.removeEventListener("keydown", swallowKey, true);
    }
  };
}
