// Roku layout exporter (docs/parity/LAYOUT.md). It measures what the device holds: the ECP `query/app-ui` tree (every node the
// firmware renders, with its bounds, colour, text, visibility), composed through each ancestor's translation, scale (per axis) and
// opacity. Boxes are the laid-out node boxes Roku reports; a Label's box is its own, never a size the exporter or the app chose to
// match the web. Beyond node type the tree carries what the app declares on its own nodes in the node name: the font a glyph Label is
// drawn with (the bundled instance's weight and the integer pixel size of its Font node), and for a control its role, accessible
// name and the tint of its bitmap (`a11y|role|radius[@tint]|name`). A radius is the corner radius of the 9-patch mask actually used. Nothing is read from the screenshot.
// Unpainted markers exist only where they sit on a real control (a hit box the app also uses for focus or action).
// Content fully covered by a later opaque fill is not exported.

import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

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

const bounds0 = (a) => nums(a.bounds);
const intersect = (r, q) => {
  if (!r) return q;
  const x = Math.max(r.x, q.x), y = Math.max(r.y, q.y);
  return { x, y, w: Math.min(r.x + r.w, q.x + q.w) - x, h: Math.min(r.y + r.h, q.y + q.h) - y };
};
const compose = (M, ax, ay, b) => ({ sx: M.sx * ax, sy: M.sy * ay, tx: M.sx * b[0] + M.tx, ty: M.sy * b[1] + M.ty });
const mapRect = (M, [x, y, w, h]) => ({ x: M.sx * x + M.tx, y: M.sy * y + M.ty, w: M.sx * w, h: M.sy * h });

/** Walks the tree and returns raw measured items in tree order (paint order). */
export function measureTree(root) {
  const items = [];
  const walk = (node, M, opacity, parent, chain, clip) => {
    const parentTag = parent?.tag ?? "";
    const a = node.attrs;
    if (a.visible === "false") return;
    const op = opacity * (a.opacity !== undefined ? Number(a.opacity) / 100 : 1);
    if (op <= 0.001) return;
    // A clipping rectangle of this node (its own frame) cuts the node and everything below it.
    const sc = nums(a.scale) ?? [1, 1];
    const c = nums(a.scaleRotateCenter) ?? [0, 0];
    let tr = nums(a.translation) ?? [0, 0];
    if ((parentTag === "MarkupGrid" || parent?.attrs.extends === "MarkupGrid") && bounds0(a)) tr = [bounds0(a)[0], bounds0(a)[1]];
    const child = compose(M, sc[0], sc[1], [tr[0] + c[0] - sc[0] * c[0], tr[1] + c[1] - sc[1] * c[1]]);
    const ownClip = nums(a.clippingRect);
    if (ownClip) clip = intersect(clip, mapRect(child, ownClip));
    if (clip && (clip.w <= 0 || clip.h <= 0)) return;
    const bounds = nums(a.bounds);
    let rect = bounds && bounds[2] > 0 && bounds[3] > 0 ? mapRect(M, bounds) : null;
    if (rect && clip) { rect = intersect(rect, clip); if (rect.w <= 0 || rect.h <= 0) rect = null; }
    const base = { chain, parent, scaleX: M.sx * (nums(a.scale)?.[0] ?? 1), scaleY: M.sy * (nums(a.scale)?.[1] ?? 1) };
    const sem = /^a11y\|(\w+)\|([\d.]+)(?:@([0-9a-f]{8})(~\d+)?)?\|(.*)$/s.exec(a.name ?? "");
    if (sem && rect) items.push({ ...base, kind: "a11y", node, rect, op, role: sem[1], radius: Number(sem[2]), declared: sem[3], baked: sem[4], text: sem[5] });
    else if (node.tag === "Label" && a.text && rect) items.push({ ...base, kind: "label", node, rect, op, parent });
    else if (node.tag === "Poster" && a.uri && rect) items.push({ ...base, kind: "poster", node, rect, op });
    else if (node.tag === "VideoBackground" && rect) items.push({ ...base, kind: "rect", node, rect, op });
    else if (node.tag === "Video" && rect) items.push({ ...base, kind: "video", node, rect, op });
    else if (node.tag === "Rectangle" && rect && alphaOf(a.color) * op > 0.01) items.push({ ...base, kind: "rect", node, rect, op });
    // Children live in this node's own frame (computed above). A list item sits where its bounds start (the list does not report a
    // translation for its items).
    const below = [...chain, node];
    for (const k of node.children) walk(k, child, op, node, below, clip);
  };
  walk(root, { sx: 1, sy: 1, tx: 0, ty: 0 }, 1, null, [], null);
  return items;
}

const fontOf = (name = "") => {
  const m = /^f(\d+)s([\d.]+)~([wct])(?:\|(\w+))?$/.exec(name);
  return m ? { weight: Number(m[1]), size: Number(m[2]), words: m[3] === "w", tail: m[3] === "t", role: m[4] ?? "text" } : null;
};

export function buildLayoutDocument(appUiXml, { screen, theme, clockPinned }) {
  const items = measureTree(parseAppUi(appUiXml));
  // The video plane paints over everything before it in the tree (the pages under a full-screen player are not on screen).
  const lastVideo = items.map((it) => it.kind).lastIndexOf("video");
  if (lastVideo > 0) items.splice(0, lastVideo);
  items.forEach((it, i) => { it.order = i; });
  // Word and glyph Labels of one TrackedText are one text element: the union of their bounds, words joined by the gaps between them.
  const groups = [];
  let current = null;
  for (const it of items) {
    if (it.kind === "label" && fontOf(it.node.attrs.name)) {
      // Glyph Labels of one TrackedText share a parent node and sit together in the tree.
      if (current && current.parent === it.parent) current.labels.push(it);
      else { current = { parent: it.parent, labels: [it], order: it.order }; groups.push(current); }
    } else {
      current = null;
      groups.push({ single: it, order: it.order });
    }
  }
  return finish(groups, items, { screen, theme, clockPinned });
}

const imageDir = fileURLToPath(new URL("../../../clients/roku/images/", import.meta.url));
const pictureCache = new Map();
/** A bundled picture that paints every pixel of its box: opaque PNG whose aspect matches the box (read from the app's own asset). */
function opaquePicture(it) {
  // Loaded server artwork (loadStatus 3 = ready, as the ECP tree reports it) is a JPEG the app zooms to fill its box.
  if (/^https?:\/\//.test(it.node.attrs.uri ?? "")) return it.node.attrs.loadStatus === "3";
  const m = /^pkg:\/images\/([\w.-]+\.png)$/.exec(it.node.attrs.uri ?? "");
  if (!m || m[1].endsWith(".9.png")) return false;
  if (!pictureCache.has(m[1])) {
    try {
      const png = PNG.sync.read(readFileSync(imageDir + m[1]));
      let opaque = true;
      for (let i = 3; i < png.data.length; i += 4) if (png.data[i] !== 255) { opaque = false; break; }
      pictureCache.set(m[1], opaque ? png.width / png.height : 0);
    } catch { pictureCache.set(m[1], 0); }
  }
  const aspect = pictureCache.get(m[1]);
  return aspect > 0 && Math.abs(aspect - it.rect.w / it.rect.h) / aspect < 0.01;
}
const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (v) => "#" + v.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");

function finish(groups, items, { screen, theme, clockPinned }) {
  const elements = [];
  const r2 = (v) => Math.round(v * 100) / 100;
  // The colour behind an element: the painted Rectangles of the tree that lie under its centre, composited in paint order over white
  // (what the web calls the ancestors' backgrounds). `own` includes a Rectangle drawn at `order` itself.
  const fills = [];
  const background = (rect, order, own, scope = null) => {
    // An element partly outside the screen is read at the point of it that is inside.
    const cx = Math.min(1919, Math.max(0, rect.x + rect.w / 2)), cy = Math.min(1079, Math.max(0, rect.y + rect.h / 2));
    // Behind a full-screen video the plane is black; otherwise the page sits on white, as the web's ancestors do.
    let out = items[0]?.kind === "video" ? [0, 0, 0] : [255, 255, 255];
    for (const f of fills) {
      if (f.order > order || (f.order === order && !own)) break;
      if (cx < f.rect.x || cx > f.rect.x + f.rect.w || cy < f.rect.y || cy > f.rect.y + f.rect.h) continue;
      // Like the web's ancestors' backgrounds: a fill counts for what lies in the group that holds it (a page surface paints the page's
      // content, not the header, which sits in its own group).
      if (scope && !scope.includes(f.parent)) continue;
      const col = f.fill ?? f.node.attrs.color, al = (f.fill ? 1 : alphaOf(col)) * f.op;
      const c = rgb(col);
      out = out.map((o, k) => c[k] * al + o * (1 - al));
    }
    return toHex(out);
  };
  // Fills in paint order. A tagged bitmap (a pill, a panel, a dot) fills with the colour the app declared for it (its tint, alpha
  // included) composited over what lies beneath; without a declaration, with the colour its pixels show.
  for (const it of items) {
    if (it.kind === "a11y" && it.node.tag === "Poster") {
      if (it.role === "image" || it.role === "video") continue; // a picture, glyph or video frame: it paints no background of its own
      if (it.declared) {
        const c = [0, 2, 4].map((k) => parseInt(it.declared.slice(k, k + 2), 16)), al = parseInt(it.declared.slice(6, 8), 16) / 255;
        const under = rgb(background(it.rect, it.order, false, it.chain));
        it.fill = toHex(c.map((v, k) => v * al + under[k] * (1 - al)));
        it.opaque = !it.baked && parseInt(it.declared.slice(6, 8), 16) >= 250;
        fills.push(it);
      } // a bitmap with no declared tint (artwork) paints no background of its own: nothing is guessed from its pixels
    } else if ((it.kind === "rect" || (it.kind === "a11y" && it.node.tag === "Rectangle")) && alphaOf(it.node.attrs.color) > 0) {
      it.opaque = alphaOf(it.node.attrs.color) * it.op >= 0.99;
      fills.push(it);
    }
  }
  let curOrder = 0, curSource = null;
  const push = (e) => {
    e._order = curOrder;
    e._source = curSource;
    for (const k of ["x", "y", "w", "h"]) e.rect[k] = r2(e.rect[k]);
    if (e.rect.x < 1920 && e.rect.y < 1080 && e.rect.x + e.rect.w > 0 && e.rect.y + e.rect.h > 0) elements.push(e);
  };
  // The colour the glyphs show: the Label colour, its alpha and the node opacity folded over the surface behind it.
  const textColour = (l, bg) => {
    const col = l.node.attrs.color;
    const al = alphaOf(col) * l.op;
    if (!col) return null;
    if (al >= 0.995) return hex(col);
    const c = rgb(hex(col)), u = rgb(bg);
    return toHex(c.map((v, k) => v * al + u[k] * (1 - al)));
  };
  const opacityOf = (op) => (op < 0.995 ? { opacity: r2(op) } : {});
  const textElement = (labels, font, text, order) => {
    const x0 = Math.min(...labels.map((l) => l.rect.x)), y0 = Math.min(...labels.map((l) => l.rect.y));
    const x1 = Math.max(...labels.map((l) => l.rect.x + l.rect.w)), y1 = Math.max(...labels.map((l) => l.rect.y + l.rect.h));
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    push({
      text: text.replace(/\s+/g, " ").trim(), role: font.role ?? "text", rect, color: textColour(labels[0], background(rect, order, false, labels[0].chain)), background: background(rect, order, false, labels[0].chain),
      fontSize: font.size == null ? null : r2(font.size * labels[0].scaleY), fontWeight: font.weight, ...opacityOf(labels[0].op),
    });
  };
  for (const g of groups) {
    curOrder = g.order;
    curSource = g.labels ? { node: g.labels[0].node, chain: g.labels[0].chain } : { node: g.single.node, chain: g.single.chain };
    if (g.labels) {
      const font = fontOf(g.labels[0].node.attrs.name);
      // The web reports one text element per line of a wrapped run. Labels on one line sit at the same top; words are set one Label
      // each, so a gap wider than 0.06 em between neighbours is a space.
      const lines = [];
      for (const l of g.labels) {
        const last = lines[lines.length - 1];
        if (last && Math.abs(l.rect.y - last[0].rect.y) < font.size * 0.5) last.push(l); else lines.push([l]);
      }
      for (const line of lines) {
        // Words are one Label each (a space between them); characters are one Label each, and a space is where the real gap between two
        // neighbours is wider than the run's usual gap by a space's width.
        const gaps = line.slice(1).map((l, i) => l.rect.x - (line[i].rect.x + line[i].rect.w)).sort((a, b) => a - b);
        const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
        let text = "";
        let prev = null;
        for (const l of line) {
          if (prev) {
            const gap = l.rect.x - (prev.rect.x + prev.rect.w);
            if (!fontOf(l.node.attrs.name).tail && (font.words || gap - usual > font.size * 0.12)) text += " ";
          }
          text += l.node.attrs.text;
          prev = l;
        }
        textElement(line, font, text, g.order);
      }
      continue;
    }
    const it = g.single;
    if (it.kind === "label") {
      // A Label the app did not set through TrackedText: the tree does not say which font it draws, so size and weight stay unknown.
      textElement([it], { size: null, weight: null }, it.node.attrs.text, it.order);
    } else if (it.kind === "a11y") {
      // A radius is the corner of the mask the app drew, scaled with the node, never above half the box; an unpainted hit box has no corner.
      const painted = it.node.tag === "Poster" || alphaOf(it.node.attrs.color) > 0;
      const radius = painted ? Math.min(it.radius * it.scaleX, it.rect.w / 2, it.rect.h / 2) : 0;
      push({ text: it.text, role: it.role === "fill" ? "container" : it.role, _fill: it.role === "fill", rect: it.rect, color: null, background: background(it.rect, it.order, true, it.chain), fontSize: null, fontWeight: null, ...(radius ? { radius: r2(radius) } : {}), ...opacityOf(it.op) });
    } else if (it.kind === "video") {
      push({ text: "", role: "video", rect: it.rect, color: null, background: background(it.rect, it.order, false, it.chain), fontSize: null, fontWeight: null });
    } else if (it.kind === "poster") {
      push({ text: "", role: "image", rect: it.rect, color: null, background: background(it.rect, it.order, false, it.chain), fontSize: null, fontWeight: null, ...opacityOf(it.op) });
    } else {
      push({ text: "", role: "container", rect: it.rect, color: null, background: background(it.rect, it.order, true, it.chain), fontSize: null, fontWeight: null, ...opacityOf(it.op) });
    }
  }
  // A painted surface that sits at the box of an unpainted control is that control's own face: the control takes its corner.
  const same = (p, q) => ["x", "y", "w", "h"].every((k) => Math.abs(p[k] - q[k]) <= 0.6);
  for (const e of elements) {
    if (e._fill || e.radius || !e._source) continue;
    const face = elements.find((f) => f._fill && f.radius && same(f.rect, e.rect));
    if (face && e._source.node.tag === "Rectangle") e.radius = face.radius;
  }
  // A painted surface that another element already describes at the same box is not listed twice.
  const kept = elements.filter((e) => !(e._fill && elements.some((f) => f !== e && !f._fill && same(f.rect, e.rect))));
  // Content fully covered by a later opaque surface (a fill, or a bundled opaque picture) is not on screen (a drawer over the page).
  // A surface never covers its own ancestors or descendants, and a rounded one is shrunk by its corner.
  const covers = [...fills.filter((f) => f.opaque), ...items.filter((it) => (it.kind === "poster" || (it.kind === "a11y" && it.role === "image" && it.node.tag === "Poster")) && it.op >= 0.99 && opaquePicture(it))].map((f) => {
    const r = f.kind === "a11y" && f.node.tag === "Poster" && f.role !== "image" ? Math.min(f.radius * f.scaleX, f.rect.w / 2, f.rect.h / 2) : 0;
    return { order: f.order, node: f.node, chain: f.chain, rect: { x: f.rect.x + r, y: f.rect.y + r, w: f.rect.w - 2 * r, h: f.rect.h - 2 * r } };
  });
  const visible = kept.filter((e) => !covers.some((f) => f.order > e._order && !e._source.chain.includes(f.node) && !f.chain.includes(e._source.node) && f.rect.x <= e.rect.x + 0.01 && f.rect.y <= e.rect.y + 0.01 && f.rect.x + f.rect.w >= e.rect.x + e.rect.w - 0.01 && f.rect.y + f.rect.h >= e.rect.y + e.rect.h - 0.01));
  for (const e of visible) { delete e._source; delete e._fill; }
  for (const e of visible) delete e._order;
  return { screen, theme, viewport: { w: 1920, h: 1080, dpr: 1 }, clockPinned: !!clockPinned, elements: visible };
}
