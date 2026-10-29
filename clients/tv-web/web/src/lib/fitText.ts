/**
 * Real ellipsis. A string that does not fit its box is drawn as shorter real text ending in "…" instead of being cut by
 * `text-overflow: ellipsis`, whose "…" the engine paints outside the DOM (so a layout export or a screen reader sees the
 * full string and cannot tell what is shown). The fit is measured on the live node with the browser's own layout
 * (`scrollWidth` against `clientWidth`), never from a font formula. The CSS rule stays as the safety net for a box too
 * narrow for even "…".
 *
 * Scope: an element whose only child is one text node and whose computed `text-overflow` is `ellipsis`. It re-fits on
 * resize, font load, text changes and root attribute changes (theme, language, zoom).
 */
const ELLIPSIS = "…";

/** The longest prefix of `original` that, followed by "…", passes `fits`; `original` itself when it fits. */
export function fitWithEllipsis(original: string, fits: (candidate: string) => boolean): string {
  if (fits(original)) return original;
  let low = 0;
  let high = original.length - 1;
  let best = ELLIPSIS;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = original.slice(0, mid).replace(/\s+$/, "") + ELLIPSIS;
    if (fits(candidate)) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

const TOLERANCE_PX = 1;

export function installFitText(root: HTMLElement = document.body): () => void {
  const originals = new Map<Text, string>();
  const written = new WeakMap<Text, string>();
  const titled = new WeakSet<HTMLElement>();
  let frame = 0;

  const overflows = (el: HTMLElement) => el.scrollWidth > el.clientWidth + TOLERANCE_PX;
  const isSingleText = (el: Element): el is HTMLElement =>
    el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE;

  const refit = (node: Text) => {
    const el = node.parentElement;
    if (!el) return;
    const original = originals.get(node) as string;
    const shown = fitWithEllipsis(original, (candidate) => {
      node.data = candidate;
      return !overflows(el);
    });
    node.data = shown;
    written.set(node, shown);
    if (shown === original) {
      originals.delete(node);
      if (titled.has(el)) {
        el.removeAttribute("title");
        titled.delete(el);
      }
    } else if (!el.hasAttribute("title")) {
      el.title = original;
      titled.add(el);
    }
  };

  const pass = () => {
    frame = 0;
    observer.disconnect();
    for (const [node, original] of originals) {
      if (!node.isConnected) originals.delete(node);
      else if (node.data !== written.get(node)) originals.set(node, node.data); // the app changed the text: fit the new string
      else if (original === node.data) originals.delete(node);
    }
    const all = root.getElementsByTagName("*");
    for (let i = 0; i < all.length; i += 1) {
      const el = all[i] as HTMLElement;
      if (!isSingleText(el) || !overflows(el)) continue;
      if (getComputedStyle(el).textOverflow !== "ellipsis") continue;
      const node = el.firstChild as Text;
      if (!originals.has(node)) originals.set(node, node.data);
    }
    for (const node of Array.from(originals.keys())) {
      const el = node.parentElement;
      if (el) {
        node.data = originals.get(node) as string; // restore first: the box may have grown since the last fit
        refit(node);
      }
    }
    observer.observe(root, { childList: true, subtree: true, characterData: true });
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(pass);
  };
  const observer = new MutationObserver(schedule);
  const rootObserver = new MutationObserver(schedule);
  rootObserver.observe(document.documentElement, { attributes: true });
  window.addEventListener("resize", schedule);
  document.fonts?.addEventListener?.("loadingdone", schedule);
  document.fonts?.ready.then(schedule);
  schedule();

  return () => {
    observer.disconnect();
    rootObserver.disconnect();
    window.removeEventListener("resize", schedule);
    document.fonts?.removeEventListener?.("loadingdone", schedule);
    if (frame) cancelAnimationFrame(frame);
  };
}
