// core/TitleBalance.ts: Chrome's `text-wrap: balance` for the hero title (Android TV worker's measured rule, 97% of 400
// random titles): 1. greedy line count n at the box width; 2. among the splits with exactly n lines (breaks after spaces
// and hyphens) take the smallest sum of squared line widths; 3. add a penalty when the last line is a single word, which
// Chrome avoids. ArkUI has no balance, so the caller measures text and puts the breaks in itself.

export type MeasureText = (text: string) => number;

/** Pieces that each end after a space or a hyphen: "Spider-Man 2" -> ["Spider-", "Man ", "2"]. */
function pieces(title: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const ch of title.trim()) {
    current += ch;
    if (ch === " " || ch === "-") {
      out.push(current);
      current = "";
    }
  }
  if (current.length > 0) {
    out.push(current);
  }
  return out;
}

function lineText(parts: string[], from: number, to: number): string {
  return parts.slice(from, to).join("").trimEnd();
}

/** The title with "\n" at the balanced break points; unchanged when it fits on one line. */
export function balanceTitle(title: string, measure: MeasureText, box: number): string {
  const parts = pieces(title);
  const n = parts.length;
  if (n < 2 || measure(lineText(parts, 0, n)) <= box) {
    return title;
  }
  const width = (from: number, to: number): number => measure(lineText(parts, from, to));
  const fits = (from: number, to: number): boolean => to - from === 1 || width(from, to) <= box;
  let lines = 1;
  let start = 0;
  for (let i = 1; i < n; i++) {
    if (!fits(start, i + 1)) {
      lines++;
      start = i;
    }
  }
  // Single-word last line penalty: 5000 px^2 at Chrome's 373 px box, scaled to this box.
  const penalty = 5000 * (box / 373) * (box / 373);
  const INF = Number.POSITIVE_INFINITY;
  // best[k][i]: lowest cost of the first i pieces on k lines; from[k][i]: where line k starts.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let k = 0; k <= lines; k++) {
    best.push(new Array<number>(n + 1).fill(INF));
    from.push(new Array<number>(n + 1).fill(0));
  }
  best[0][0] = 0;
  for (let k = 1; k <= lines; k++) {
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        if (best[k - 1][j] === INF || !fits(j, i)) {
          continue;
        }
        const w = width(j, i);
        let cost = best[k - 1][j] + w * w;
        if (k === lines && lines > 1 && i - j === 1 && !parts[j].endsWith("-")) {
          cost += penalty;
        }
        if (cost < best[k][i]) {
          best[k][i] = cost;
          from[k][i] = j;
        }
      }
    }
  }
  if (best[lines][n] === INF) {
    return title;
  }
  const out: string[] = [];
  let end = n;
  for (let k = lines; k >= 1; k--) {
    out.unshift(lineText(parts, from[k][end], end));
    end = from[k][end];
  }
  return out.join("\n");
}
