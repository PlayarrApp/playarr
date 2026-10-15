// core/LibraryView.ts: the Library's View choice, as web lib/libraryView.ts: list, screen (the default, a hero beside a
// landscape grid), cover (a portrait wall) and, for music only, Cover Flow (not built here yet).

export const DEFAULT_LIBRARY_VIEW: string = "screen";

/** The views a library kind offers, in web's order. Cover Flow is the artist wall, so it is offered only once it is built. */
export function libraryViews(kind: string): string[] {
  return kind === "artist" ? ["list", "screen", "cover"] : ["list", "screen", "cover"];
}

const VIEW_LABELS: Record<string, string> = {
  list: "List",
  screen: "Screen",
  cover: "Cover",
};

/** The glyph web draws above a view's label (a stack of rows, three landscape cards, three portrait cards). */
const VIEW_ICONS: Record<string, string> = {
  list: "\u2261",
  screen: "\u25AD\u25AD\u25AD",
  cover: "\u25AF\u25AF\u25AF",
};

export function libraryViewIcon(view: string): string {
  return VIEW_ICONS[view] ?? "";
}

export function libraryViewLabel(view: string): string {
  return VIEW_LABELS[view] ?? view;
}

/** A saved view that this kind still offers, else the default (Cover Flow and unknown values fall back, as web). */
export function normaliseLibraryView(raw: string, kind: string): string {
  return libraryViews(kind).indexOf(raw) >= 0 ? raw : DEFAULT_LIBRARY_VIEW;
}

/** The cover wall: six portrait covers across the 1042 wide panel, 2:3, with a gap that fills the width. */
export const COVER_COLUMNS: number = 6;
export const COVER_CARD_WIDTH: number = 155;
export const COVER_CARD_HEIGHT: number = 232;
export const COVER_GAP_X: number = 22;
export const COVER_GAP_Y: number = 40;
