import { currentLanguage, t, tf } from "./Language";

/** The web's One/Other pair: only English has a singular; Thai and Japanese carry one form (their tables have no One key). */
function counted(count: number, key: string, one: string, other: string): string {
  const plural = !(count === 1 && currentLanguage() === "en");
  return tf(key + (plural ? "Other" : "One"), plural ? other : one, { count: groupThousands(count) });
}

/** Web library subtitle: "1,754 titles" (en-GB grouping, singular for one). */

export function groupThousands(value: number): string {
  const digits = String(Math.max(0, Math.floor(value)));
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) {
      out += ",";
    }
    out += digits.charAt(i);
  }
  return out;
}

export function titleCountLabel(count: number): string {
  return counted(count, "pages.workDetail.titlesCount", "{{count}} title", "{{count}} titles");
}

/** Web music library subtitle: "35 artists" (singular for one). */
export function artistCountLabel(count: number): string {
  // web has no count key for artists: the translated plural noun after the number
  const noun = count === 1 && currentLanguage() === "en" ? "artist" : t("pages.library.collectionNoun.artists", "artists");
  return `${groupThousands(count)} ${noun}`;
}

/** The library subtitle for a catalogue kind: artists are counted as artists, everything else as titles. */
export function libraryCountLabel(kind: string, count: number): string {
  return kind === "artist" ? artistCountLabel(count) : titleCountLabel(count);
}

/** Web search subtitle: "8 results" (singular for one). */
export function resultCountLabel(count: number): string {
  return counted(count, "pages.search.resultCount", "{{count}} result", "{{count}} results");
}
