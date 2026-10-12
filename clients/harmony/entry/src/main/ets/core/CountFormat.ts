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
  return `${groupThousands(count)} ${count === 1 ? "title" : "titles"}`;
}

/** Web music library subtitle: "35 artists" (singular for one). */
export function artistCountLabel(count: number): string {
  return `${groupThousands(count)} ${count === 1 ? "artist" : "artists"}`;
}

/** The library subtitle for a catalogue kind: artists are counted as artists, everything else as titles. */
export function libraryCountLabel(kind: string, count: number): string {
  return kind === "artist" ? artistCountLabel(count) : titleCountLabel(count);
}

/** Web search subtitle: "8 results" (singular for one). */
export function resultCountLabel(count: number): string {
  return `${groupThousands(count)} ${count === 1 ? "result" : "results"}`;
}
