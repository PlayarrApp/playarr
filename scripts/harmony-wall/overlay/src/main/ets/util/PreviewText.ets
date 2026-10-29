// Preview-only (never committed): the layout export reads the glyph runs of every Text from the live component. patch_text.py gives each
// Text a TextController and a unique accessibilityDescription; at dump time the controller's layout manager (the framework's own text
// layout of that very component) reports each laid-out line's metrics and run boxes.
import { text } from '@kit.ArkGraphics2D';

const CONTROLLERS: Map<string, TextController> = new Map();
let SEQUENCE: number = 0;
let LAST: string = '';

export function pvTc(): TextController {
  const controller: TextController = new TextController();
  SEQUENCE++;
  LAST = 'pvt' + SEQUENCE.toString();
  CONTROLLERS.set(LAST, controller);
  return controller;
}

// The id of the controller just made (the next modifier in the same Text chain).
export function pvTcId(): string {
  return LAST;
}

// The visibility of a keyed node (patch_hide.py): hidden while its key is in the AppStorage string the route poll sets for the occlusion probe.
export function pvVis(hidden: string, key: string): Visibility {
  return hidden.indexOf('|' + key + '|') >= 0 ? Visibility.Hidden : Visibility.Visible;
}

export class PvBox {
  l: number = 0;
  t: number = 0;
  r: number = 0;
  b: number = 0;
}

export class PvLine {
  start: number = 0;
  end: number = 0;
  ascent: number = 0;
  descent: number = 0;
  height: number = 0;
  width: number = 0;
  left: number = 0;
  baseline: number = 0;
  top: number = 0;
  tight: PvBox[] = [];
  max: PvBox[] = [];
}

function boxes(list: text.TextBox[]): PvBox[] {
  const out: PvBox[] = [];
  for (const item of list) {
    const box: PvBox = new PvBox();
    box.l = item.rect.left;
    box.t = item.rect.top;
    box.r = item.rect.right;
    box.b = item.rect.bottom;
    out.push(box);
  }
  return out;
}

// Every laid-out line of the Text with this id: the layout manager's line metrics, and the run boxes of the line's characters
// (TIGHT: the glyphs' own font box, as a browser's Range rect; MAX: the line box).
export function pvTextLines(id: string): PvLine[] {
  const controller: TextController | undefined = CONTROLLERS.get(id);
  if (controller === undefined) {
    throw new Error('no text controller ' + id);
  }
  const layout: LayoutManager = controller.getLayoutManager();
  const lines: PvLine[] = [];
  for (let i = 0; i < layout.getLineCount(); i++) {
    const m: text.LineMetrics = layout.getLineMetrics(i);
    const range: TextRange = { start: m.startIndex, end: m.endIndex };
    const line: PvLine = new PvLine();
    line.start = m.startIndex;
    line.end = m.endIndex;
    line.ascent = m.ascent;
    line.descent = m.descent;
    line.height = m.height;
    line.width = m.width;
    line.left = m.left;
    line.baseline = m.baseline;
    line.top = m.topHeight;
    line.tight = boxes(layout.getRectsForRange(range, text.RectWidthStyle.TIGHT, text.RectHeightStyle.TIGHT));
    line.max = boxes(layout.getRectsForRange(range, text.RectWidthStyle.TIGHT, text.RectHeightStyle.MAX));
    lines.push(line);
  }
  return lines;
}
