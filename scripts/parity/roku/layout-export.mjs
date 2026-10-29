import { PNG } from "pngjs";
import { readFileSync } from "node:fs";
// Roku layout exporter (docs/parity/LAYOUT.md). It measures what the device holds: the ECP `query/app-ui` tree (every node the
// firmware renders, with its bounds, colour, text, visibility), composed through each ancestor's translation, scale (per axis) and
// opacity. Boxes are the laid-out node boxes Roku reports; a Label's box is its own, never a size the exporter or the app chose to
// match the web. Beyond node type the tree carries what the app declares on its own nodes in the node name: the font a glyph Label is
// drawn with (the bundled instance's weight and the integer pixel size of its Font node), and for a control its role, accessible
// name and the tint of its bitmap (`a11y|role|radius[@tint]|name`). A radius is the corner radius of the 9-patch mask actually used.
// Unpainted markers exist only where they sit on a real control (a hit box the app also uses for focus or action).
// Content fully covered by a later opaque fill is not exported.

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

/** The colour a drawn bitmap shows: its commonest colour on mid-edge points 3 px inside the rect (real pixels of the frame). */
function frameReader(pngFile) {
  if (!pngFile) return () => null;
  const png = PNG.sync.read(readFileSync(pngFile));
  const px = (x, y) => {
    x = Math.max(0, Math.min(png.width - 1, Math.round(x))); y = Math.max(0, Math.min(png.height - 1, Math.round(y)));
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  // The colour a bitmap shows: per-channel median over four points inside the rect (at 20 % and 80 % of each side), clear of the text
  // at the centre, the anti-aliased border and JPEG ringing. A small bitmap (a dot, a badge) is read at its centre.
  return (r) => {
    // A tall panel (a dock group) is read in its side margins, clear of the item chips inside it.
    const tall = r.h > 1.8 * r.w ? [[r.x + 3, r.y + r.h * 0.3], [r.x + r.w - 3, r.y + r.h * 0.3], [r.x + 3, r.y + r.h * 0.7], [r.x + r.w - 3, r.y + r.h * 0.7]] : null;
    const pts = Math.min(r.w, r.h) <= 30 ? [[r.x + r.w / 2, r.y + r.h / 2]] : tall ?? [[r.x + r.w * 0.2, r.y + r.h * 0.2], [r.x + r.w * 0.8, r.y + r.h * 0.2], [r.x + r.w * 0.2, r.y + r.h * 0.8], [r.x + r.w * 0.8, r.y + r.h * 0.8]];
    const px4 = pts.map(([x, y]) => px(x, y));
    const med = [0, 1, 2].map((c) => { const v = px4.map((p) => p[c]).sort((p, q) => p - q); return v[Math.floor(v.length / 2)]; });
    return "#" + med.map((v) => v.toString(16).padStart(2, "0")).join("");
  };
}

const nums = (s) => (s ? s.replace(/[{}]/g, "").split(",").map(Number) : null);
const hex = (c) => (c ? c.slice(0, 7) : null);
const alphaOf = (c) => (c && c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1);

const compose = (M, ax, ay, b) => ({ sx: M.sx * ax, sy: M.sy * ay, tx: M.sx * b[0] + M.tx, ty: M.sy * b[1] + M.ty });
const mapRect = (M, [x, y, w, h]) => ({ x: M.sx * x + M.tx, y: M.sy * y + M.ty, w: M.sx * w, h: M.sy * h });

/** Walks the tree and returns raw measured items in tree order (paint order). */
export function measureTree(root) {
  const items = [];
  const walk = (node, M, opacity, parent, chain) => {
    const parentTag = parent?.tag ?? "";
    const a = node.attrs;
    if (a.visible === "false") return;
    const op = opacity * (a.opacity !== undefined ? Number(a.opacity) / 100 : 1);
    if (op <= 0.001) return;
    const bounds = nums(a.bounds);
    const rect = bounds && bounds[2] > 0 && bounds[3] > 0 ? mapRect(M, bounds) : null;
    const base = { chain, parent, scaleY: M.sy * (nums(a.scale)?.[1] ?? 1) };
    const sem = /^a11y\|(\w+)\|([\d.]+)(?:@([0-9a-f]{8})(~\d+)?)?\|(.*)$/s.exec(a.name ?? "");
    if (sem && rect) items.push({ ...base, kind: "a11y", node, rect, op, role: sem[1], radius: Number(sem[2]), declared: sem[3], baked: sem[4], text: sem[5] });
    else if (node.tag === "Label" && a.text && rect) items.push({ ...base, kind: "label", node, rect, op, parent });
    else if (node.tag === "Poster" && a.uri && rect) items.push({ ...base, kind: "poster", node, rect, op });
    else if (node.tag === "VideoBackground" && rect) items.push({ ...base, kind: "rect", node, rect, op });
    else if (node.tag === "Video" && rect) items.push({ ...base, kind: "video", node, rect, op });
    else if (node.tag === "Rectangle" && rect && alphaOf(a.color) * op > 0.01) items.push({ ...base, kind: "rect", node, rect, op });
    // Children live in this node's own frame: its translation, then scale about scaleRotateCenter. A list item sits where its bounds
    // start (the list does not report a translation for its items).
    const sc = nums(a.scale) ?? [1, 1];
    const c = nums(a.scaleRotateCenter) ?? [0, 0];
    let tr = nums(a.translation) ?? [0, 0];
    if ((parentTag === "MarkupGrid" || parent?.attrs.extends === "MarkupGrid") && bounds) tr = [bounds[0], bounds[1]];
    const child = compose(M, sc[0], sc[1], [tr[0] + c[0] - sc[0] * c[0], tr[1] + c[1] - sc[1] * c[1]]);
    const below = [...chain, node];
    for (const k of node.children) walk(k, child, op, node, below);
  };
  walk(root, { sx: 1, sy: 1, tx: 0, ty: 0 }, 1, null, []);
  return items;
}

const fontOf = (name = "") => {
  const m = /^f(\d+)s([\d.]+)~([wc])(?:\|(\w+))?$/.exec(name);
  return m ? { weight: Number(m[1]), size: Number(m[2]), words: m[3] === "w", role: m[4] ?? "text" } : null;
};

export function buildLayoutDocument(appUiXml, { screen, theme, clockPinned, pngFile }) {
  const drawn = frameReader(pngFile);
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
  return finish(groups, items, { screen, theme, clockPinned, drawn });
}

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const toHex = (v) => "#" + v.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");

function finish(groups, items, { screen, theme, clockPinned, drawn }) {
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
      const col = f.fill ?? f.node.attrs.color, al = f.fill ? 1 : alphaOf(col) * f.op;
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
      } else {
        it.fill = drawn(it.rect);
      }
      it.opaque = !it.baked && (!it.declared || parseInt(it.declared.slice(6, 8), 16) >= 250);
      fills.push(it);
    } else if ((it.kind === "rect" || (it.kind === "a11y" && it.node.tag === "Rectangle")) && alphaOf(it.node.attrs.color) > 0) {
      it.opaque = alphaOf(it.node.attrs.color) * it.op >= 0.99;
      fills.push(it);
    }
  }
  let curOrder = 0;
  const push = (e) => {
    e._order = curOrder;
    for (const k of ["x", "y", "w", "h"]) e.rect[k] = r2(e.rect[k]);
    if (e.rect.x < 1920 && e.rect.y < 1080 && e.rect.x + e.rect.w > 0 && e.rect.y + e.rect.h > 0) elements.push(e);
  };
  const opacityOf = (op) => (op < 0.995 ? { opacity: r2(op) } : {});
  const textElement = (labels, font, text, order) => {
    const x0 = Math.min(...labels.map((l) => l.rect.x)), y0 = Math.min(...labels.map((l) => l.rect.y));
    const x1 = Math.max(...labels.map((l) => l.rect.x + l.rect.w)), y1 = Math.max(...labels.map((l) => l.rect.y + l.rect.h));
    const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    push({
      text: text.replace(/\s+/g, " ").trim(), role: font.role ?? "text", rect, color: hex(labels[0].node.attrs.color), background: background(rect, order, false, labels[0].chain),
      fontSize: font.size == null ? null : r2(font.size * labels[0].scaleY), fontWeight: font.weight, ...opacityOf(labels[0].op),
    });
  };
  for (const g of groups) {
    curOrder = g.order;
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
            if (font.words || gap - usual > font.size * 0.12) text += " ";
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
    } else if (it.kind === "a11y" && it.role === "fill") {
      continue; // a drawn background only: it paints under what follows, it is no element of its own
    } else if (it.kind === "a11y") {
      // A radius is the corner of the mask the app drew; an unpainted hit box has no painted corner.
      const painted = it.node.tag === "Poster" || alphaOf(it.node.attrs.color) > 0;
      const radius = painted ? it.radius : 0;
      push({ text: it.text, role: it.role, rect: it.rect, color: null, background: background(it.rect, it.order, true, it.chain), fontSize: null, fontWeight: null, ...(radius ? { radius: r2(radius) } : {}), ...opacityOf(it.op) });
    } else if (it.kind === "video") {
      push({ text: "", role: "video", rect: it.rect, color: null, background: background(it.rect, it.order, false, it.chain), fontSize: null, fontWeight: null });
    } else if (it.kind === "poster") {
      push({ text: "", role: "image", rect: it.rect, color: null, background: background(it.rect, it.order, false, it.chain), fontSize: null, fontWeight: null, ...opacityOf(it.op) });
    } else {
      push({ text: "", role: "container", rect: it.rect, color: null, background: background(it.rect, it.order, true, it.chain), fontSize: null, fontWeight: null, ...opacityOf(it.op) });
    }
  }
  // Content fully covered by a later opaque fill is not on screen (a drawer over the page): it is not exported.
  const covers = fills.filter((f) => f.opaque);
  const visible = elements.filter((e) => !covers.some((f) => f.order > e._order && f.rect.x <= e.rect.x + 0.01 && f.rect.y <= e.rect.y + 0.01 && f.rect.x + f.rect.w >= e.rect.x + e.rect.w - 0.01 && f.rect.y + f.rect.h >= e.rect.y + e.rect.h - 0.01));
  for (const e of visible) delete e._order;
  return { screen, theme, viewport: { w: 1920, h: 1080, dpr: 1 }, clockPinned: !!clockPinned, elements: visible };
}
