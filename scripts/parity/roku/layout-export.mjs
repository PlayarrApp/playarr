// Roku layout exporter (docs/parity/LAYOUT.md). It measures what the device holds: the ECP `query/app-ui` tree (every node the
// firmware renders, with its bounds, colour, text and visibility), composed through each ancestor's translation, scale and opacity.
// The channel carries no annotations and no web geometry. What the tree cannot say is read from the frame (backgrounds) or taken from
// the font the channel set on each glyph Label (its node name, `f<weight>s<size>`). Roles are limited to what a node proves:
// a Label is text, a Poster is an image, a Rectangle with alpha is a container.
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";

const unescapeXml = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+);/g, (_, e) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e] ?? String.fromCharCode(Number(e.slice(1)))));

/** Minimal parser for the ECP app-ui XML: elements with quoted attributes, no text nodes. */
export function parseAppUi(xml) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([\w.:-]+)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g;
  for (let m; (m = re.exec(xml)); ) {
    if (m[1]) { stack.pop(); continue; }
    const attrs = {};
    for (const a of m[3].matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = unescapeXml(a[2]);
    const node = { tag: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}

const nums = (s) => (s ? s.replace(/[{}]/g, "").split(",").map(Number) : null);
const hex = (c) => (c ? c.slice(0, 7) : null);
const alphaOf = (c) => (c && c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1);

function sampler(pngFile) {
  const png = PNG.sync.read(readFileSync(pngFile));
  const px = (x, y) => {
    x = Math.max(0, Math.min(png.width - 1, Math.round(x))); y = Math.max(0, Math.min(png.height - 1, Math.round(y)));
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const mode = (pts) => {
    const counts = new Map();
    for (const [x, y] of pts) { const k = px(x, y).join(","); counts.set(k, (counts.get(k) ?? 0) + 1); }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
    return "#" + best.map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  // The colour behind a box: the commonest colour on a ring 2 px outside it.
  const behind = (r) => {
    const pts = [];
    for (let x = r.x; x <= r.x + r.w; x += 2) pts.push([x, r.y - 2], [x, r.y + r.h + 2]);
    for (let y = r.y; y <= r.y + r.h; y += 2) pts.push([r.x - 2, y], [r.x + r.w + 2, y]);
    return mode(pts);
  };
  // The fill itself: mid-edge points 3 px inside the box.
  const inside = (r) => {
    const i = Math.min(3, r.w / 3, r.h / 3);
    return mode([[r.x + r.w / 2, r.y + i], [r.x + r.w / 2, r.y + r.h - i], [r.x + i, r.y + r.h / 2], [r.x + r.w - i, r.y + r.h / 2]]);
  };
  return { behind, inside };
}

const compose = (M, a, b) => ({ sx: M.sx * a, sy: M.sy * a, tx: M.sx * b[0] + M.tx, ty: M.sy * b[1] + M.ty });
const mapRect = (M, [x, y, w, h]) => ({ x: M.sx * x + M.tx, y: M.sy * y + M.ty, w: M.sx * w, h: M.sy * h });

/** Walks the tree and returns raw measured items in tree order (paint order). */
export function measureTree(root) {
  const items = [];
  const walk = (node, M, opacity, parent) => {
    const parentTag = parent?.tag ?? "";
    const a = node.attrs;
    if (a.visible === "false") return;
    const op = opacity * (a.opacity !== undefined ? Number(a.opacity) / 100 : 1);
    if (op <= 0.001) return;
    const bounds = nums(a.bounds);
    const rect = bounds && bounds[2] > 0 && bounds[3] > 0 ? mapRect(M, bounds) : null;
    if (node.tag === "Label" && a.text && rect) items.push({ kind: "label", node, rect, op, parent });
    else if (node.tag === "Poster" && a.uri && rect) items.push({ kind: "poster", node, rect, op });
    else if (node.tag === "Video" && rect) items.push({ kind: "video", node, rect, op });
    else if (node.tag === "Rectangle" && rect && alphaOf(a.color) * op > 0.01) items.push({ kind: "rect", node, rect, op });
    // Children live in this node's own frame: its translation, then scale about scaleRotateCenter. A list item sits where its bounds
    // start (the list does not report a translation for its items).
    let s = nums(a.scale)?.[0] ?? 1;
    const c = nums(a.scaleRotateCenter) ?? [0, 0];
    let tr = nums(a.translation) ?? [0, 0];
    if (parentTag === "MarkupGrid" && bounds) tr = [bounds[0], bounds[1]];
    const child = compose(M, s, [tr[0] + c[0] - s * c[0], tr[1] + c[1] - s * c[1]]);
    for (const k of node.children) walk(k, child, op, node);
  };
  walk(root, { sx: 1, sy: 1, tx: 0, ty: 0 }, 1, null);
  return items;
}

const fontOf = (name = "") => {
  const m = /^f(\d+)s([\d.]+)$/.exec(name);
  return m ? { weight: Number(m[1]), size: Number(m[2]) } : null;
};

export function buildLayoutDocument(appUiXml, { screen, theme, pngFile, clockPinned }) {
  const frame = sampler(pngFile);
  const items = measureTree(parseAppUi(appUiXml));
  // Word and glyph Labels of one TrackedText are one text element: the union of their bounds, words joined by the gaps between them.
  const groups = [];
  let current = null;
  // The video plane paints over everything before it in the tree (the pages under a full-screen player are not on screen).
  const lastVideo = items.map((it) => it.kind).lastIndexOf("video");
  if (lastVideo > 0) items.splice(0, lastVideo);
  for (const it of items) {
    if (it.kind === "label" && fontOf(it.node.attrs.name)) {
      // Glyph Labels of one TrackedText share a parent node and sit together in the tree.
      if (current && current.parent === it.parent) current.labels.push(it);
      else { current = { parent: it.parent, labels: [it] }; groups.push(current); }
    } else {
      current = null;
      groups.push({ single: it });
    }
  }
  return finish(groups, frame, { screen, theme, clockPinned });
}

function finish(groups, frame, { screen, theme, clockPinned }) {
  const elements = [];
  const r2 = (v) => Math.round(v * 100) / 100;
  const push = (e) => {
    for (const k of ["x", "y", "w", "h"]) e.rect[k] = r2(e.rect[k]);
    if (e.rect.x < 1920 && e.rect.y < 1080 && e.rect.x + e.rect.w > 0 && e.rect.y + e.rect.h > 0) elements.push(e);
  };
  const textElement = (labels, font, text) => {
    const x0 = Math.min(...labels.map((l) => l.rect.x)), y0 = Math.min(...labels.map((l) => l.rect.y));
    const x1 = Math.max(...labels.map((l) => l.rect.x + l.rect.w)), y1 = Math.max(...labels.map((l) => l.rect.y + l.rect.h));
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    const op = labels[0].op;
    const colour = labels[0].node.attrs.color;
    push({
      text: text.replace(/\s+/g, " ").trim(), role: "text", rect, color: hex(colour), background: frame.behind(rect),
      fontSize: font.size, fontWeight: font.weight, ...(op < 0.995 ? { opacity: r2(op) } : {}),
    });
  };
  for (const g of groups) {
    if (g.labels) {
      const font = fontOf(g.labels[0].node.attrs.name);
      // Words are set one Label each, so a gap wider than a fifth of the font size between neighbours on a line is a space.
      let text = "";
      let prev = null;
      for (const l of g.labels) {
        if (prev && (l.rect.y - prev.rect.y > font.size * 0.5 || l.rect.x - (prev.rect.x + prev.rect.w) > font.size * 0.2)) text += " ";
        text += l.node.attrs.text;
        prev = l;
      }
      textElement(g.labels, font, text);
      continue;
    }
    const it = g.single;
    if (it.kind === "label") {
      // A Label the channel set without a tracked-text font: size is the line box over the font's line height (an estimate).
      textElement([it], { size: r2(it.rect.h / 1.364), weight: 400 }, it.node.attrs.text);
    } else if (it.kind === "video") {
      push({ text: "", role: "video", rect: it.rect, color: null, background: frame.inside(it.rect), fontSize: null, fontWeight: null });
    } else if (it.kind === "poster") {
      push({ text: "", role: "image", rect: it.rect, color: null, background: frame.behind(it.rect), fontSize: null, fontWeight: null, ...(it.op < 0.995 ? { opacity: r2(it.op) } : {}) });
    } else {
      push({ text: "", role: "container", rect: it.rect, color: null, background: frame.inside(it.rect), fontSize: null, fontWeight: null, ...(it.op < 0.995 ? { opacity: r2(it.op) } : {}) });
    }
  }
  return { screen, theme, viewport: { w: 1920, h: 1080, dpr: 1 }, clockPinned: !!clockPinned, elements };
}
