// DEBUG BUILD ONLY. Decides when the mirror may tell the receiver to keep its last picture instead of rendering a new one.
//
// Every render loads a fresh SVG image in the browser, and Chromium keeps that load in native memory (about 1.5 to 2 MB per frame on
// the TV engine family, reclaimed only by a reload). A page that nobody drives does not change, so rendering it again every 2 s only
// spends memory. A page state is rendered until two renders in a row agree (a CSS transition or an image decode may still have been
// running at the first), after which the picture is reused until the state changes or REFRESH_AFTER_MS pass.

/** The reused picture is rendered again after this long even when nothing changed, as insurance against what the signature misses. */
export const REFRESH_AFTER_MS = 5 * 60_000;
/** Renders of one unchanged state before its picture is reused. */
export const SETTLED_RENDERS = 2;

/** FNV-1a over the string, as an unsigned 32-bit number. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Everything that decides the picture and is cheap to read: the markup, the root and body attributes, scroll offsets, loaded images, the viewport. */
export function pageSignature(doc: Document = document, win: Window = window): string {
  const parts: string[] = [
    doc.body.innerHTML,
    doc.documentElement.getAttribute("style") ?? "",
    doc.documentElement.className,
    JSON.stringify({ ...doc.documentElement.dataset }),
    doc.body.getAttribute("style") ?? "",
    doc.body.className,
    `${win.innerWidth}x${win.innerHeight}`,
    win.location.pathname + win.location.search,
  ];
  const state: string[] = [];
  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>("*"))) {
    if (el.scrollTop > 0 || el.scrollLeft > 0) state.push(`s${Math.round(el.scrollLeft)},${Math.round(el.scrollTop)}`);
    else if (el instanceof HTMLImageElement) state.push(el.complete ? "i1" : "i0");
    else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) state.push(`v${el.value}`);
  }
  parts.push(state.join("|"));
  const active = doc.activeElement;
  parts.push(active ? `${active.tagName}#${active.id}.${active.className}` : "");
  const joined = parts.join("\u0001");
  return `${joined.length}:${hashString(joined)}`;
}

export interface ReuseState {
  signature: string | null;
  renders: number;
  /** True once a picture of this state was posted: the receiver keeps it, so the page need not hold or upload it again. */
  posted: boolean;
  renderedAt: number;
}

export function newReuseState(): ReuseState {
  return { signature: null, renders: 0, posted: false, renderedAt: 0 };
}

/** True when the receiver's last picture still shows this state, so no render is needed. */
export function canReuseImage(state: ReuseState, signature: string, now: number): boolean {
  return state.posted && state.signature === signature && state.renders >= SETTLED_RENDERS && now - state.renderedAt < REFRESH_AFTER_MS;
}

/** Records a finished render. A failed render (nothing to post) forgets the state so the next frame renders again. */
export function recordRender(state: ReuseState, signature: string, posted: boolean, now: number): void {
  if (!posted) {
    state.signature = null;
    state.renders = 0;
    state.posted = false;
    return;
  }
  state.renders = state.signature === signature ? state.renders + 1 : 1;
  state.signature = signature;
  state.posted = true;
  state.renderedAt = now;
}
