/**
 * html-to-image inlines every element's computed `height`. A rail's scroller ends in a negative bottom margin that cancels
 * its shadow padding; in the live page that margin collapses through the auto-height `.tv-media-track-window` and
 * `.tv-media-track`, but a fixed inline height stops the collapse, so each track in the picture grew by the padding (104
 * stage px between the seasons of a show). While a capture runs, report `auto` for those two wrappers so the clone
 * collapses exactly as the page does.
 */
const COLLAPSING_WRAPPERS = ".tv-media-track, .tv-media-track-window";

export async function withCollapsingTrackHeights<T>(capture: () => Promise<T>): Promise<T> {
  const original = window.getComputedStyle;
  window.getComputedStyle = function (this: Window, element: Element, pseudo?: string | null): CSSStyleDeclaration {
    const style = original.call(this, element, pseudo);
    if (pseudo || !(element instanceof Element) || !element.matches(COLLAPSING_WRAPPERS)) return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === "cssText") return target.cssText.replace(/(^|; )(height|block-size): [^;]*;/g, "$1");
        if (key === "getPropertyValue") {
          return (name: string) => (name === "height" || name === "block-size" ? "auto" : target.getPropertyValue(name));
        }
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } as typeof window.getComputedStyle;
  try {
    return await capture();
  } finally {
    window.getComputedStyle = original;
  }
}
