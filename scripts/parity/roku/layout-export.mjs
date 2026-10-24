// Roku layout exporter (docs/parity/LAYOUT.md): turns the channel's own scene-graph dump (clients/roku/source/LayoutDump.brs,
// PARITY|layout|{json} lines on the debug console) into the schema document the layout scorer reads. The device draws every
// text itself, so rects, sizes and colours are the channel's own values; only backgrounds are read from the screenshot.
import { PNG } from "pngjs";
import { readFileSync } from "node:fs";

const LINE_HEIGHT = 1.364; // Nunito Sans content area (ascent 1.011 + descent 0.353), what Range.getBoundingClientRect reports
const hex = (c) => (c ? c.slice(0, 7) : null);
const alphaOf = (c) => (c && c.length === 9 ? parseInt(c.slice(7), 16) / 255 : 1);

export function fontFromUri(uri = "") {
  const m = /NunitoSans-(\d+)(?:-(\d+))?\.ttf/.exec(uri);
  if (m) return { weight: Number(m[1]), mono: false };
  if (/JetBrainsMono-(\d+)/.test(uri)) return { weight: Number(/JetBrainsMono-(\d+)/.exec(uri)[1]), mono: true };
  return { weight: 400, mono: false };
}

function sampler(pngFile) {
  const png = PNG.sync.read(readFileSync(pngFile));
  const at = (px, py) => {
    px = Math.max(0, Math.min(png.width - 1, Math.round(px))); py = Math.max(0, Math.min(png.height - 1, Math.round(py)));
    const i = (py * png.width + px) * 4;
    return "#" + [0, 1, 2].map((k) => png.data[i + k].toString(16).padStart(2, "0")).join("");
  };
  const ring = (x, y, w, h) => {
    // Most common colour on the ring just outside the box: the colour behind the element.
    const counts = new Map();
    const put = (px, py) => {
      px = Math.max(0, Math.min(png.width - 1, Math.round(px))); py = Math.max(0, Math.min(png.height - 1, Math.round(py)));
      const i = (py * png.width + px) * 4;
      const k = `${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    for (let px = x; px <= x + w; px += 2) { put(px, y - 2); put(px, y + h + 2); }
    for (let py = y; py <= y + h; py += 2) { put(x - 2, py); put(x + w + 2, py); }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "0,0,0";
    return "#" + best.split(",").map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  };
  ring.at = at;
  ring.inside = (x, y, w, h) => {
    // Mid-edge points 3 px inside the box: the fill itself, clear of corners and of what the box holds.
    const inset = Math.min(3, w / 3, h / 3);
    const pts = [[x + w / 2, y + inset], [x + w / 2, y + h - inset], [x + inset, y + h / 2], [x + w - inset, y + h / 2]];
    const counts = new Map();
    for (const [px, py] of pts) { const c = at(px, py); counts.set(c, (counts.get(c) ?? 0) + 1); }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };
  return ring;
}

export function buildLayoutDocument(lines, { screen, theme, pngFile, clockPinned }) {
  const bg = sampler(pngFile);
  const elements = [];
  const FILLSET = ["container", "link", "button", "search", "textbox", "status", "dialog", "group", "heading"];
  const dbg = [];
  const boxes = [];
  const under = (x, y, w, h) => {
    const cx = x + w / 2, cy = y + h / 2;
    // A dialog covers the page: what sits inside it rests on boxes of the dialog only.
    const dlg = boxes.find((b) => b.role === "dialog" && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h);
    let best = null;
    for (const b of boxes) {
      if (dlg && !(b.x >= dlg.x - 0.5 && b.y >= dlg.y - 0.5 && b.x + b.w <= dlg.x + dlg.w + 0.5 && b.y + b.h <= dlg.y + dlg.h + 0.5)) continue;
      if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h && (!best || b.w * b.h <= best.w * best.h)) best = b;
    }
    return best ? best.bg : null;
  };
  const items = [];
  for (const raw of lines) {
    let it;
    try { it = JSON.parse(raw); } catch { continue; }
    if (it.k === "dbg") { dbg.push(it.m); continue; }
    items.push(it);
    // Text sits on the nearest box drawn beneath it, whatever order the channel printed them in.
    if (it.k === "box" && !it.fixed) it.bg = ""; // sampled below
    if (it.k === "box" && FILLSET.includes(it.role) && it.w < 1900 && it.bg) boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h, bg: it.bg, role: it.role });
  }
  // A box's background is what the device draws inside it: the colour of its own fill over what is beneath (read from the frame).
  const FILLS = ["container", "link", "button", "search", "textbox", "status", "dialog", "group", "heading"];
  for (const it of items) if (it.k === "box" && !it.fixed && !it.inherit && FILLS.includes(it.role)) it.bg = bg.inside(it.x, it.y, it.w, it.h);
  const encl = (it) => { let best = null; for (const o of items) { if (o === it || o.k !== "box" || !FILLS.includes(o.role) || o.inherit || o.w >= 1900 || !o.bg) continue; if (it.x >= o.x - 0.5 && it.y >= o.y - 0.5 && it.x + it.w <= o.x + o.w + 0.5 && it.y + it.h <= o.y + o.h + 0.5) best = o; } return best?.bg; };
  for (const it of items) if (it.k === "box" && !it.fixed && (it.inherit || !FILLS.includes(it.role))) it.bg = encl(it) || bg.inside(it.x, it.y, it.w, it.h);
  const sampled = items.filter((it) => it.k === "box" && FILLSET.includes(it.role) && it.w < 1900);
  boxes.length = 0;
  for (const it of sampled) boxes.push({ x: it.x, y: it.y, w: it.w, h: it.h, bg: it.bg, role: it.role });
  for (const it of items) {
    if (it.k === "label" || it.k === "tracked") {
      if (it.size == null) continue;
      const f = fontFromUri(it.font);
      const lineH = it.size * LINE_HEIGHT;
      const textW = it.k === "label" ? it.textw : it.w;
      let x = it.x;
      if (it.k === "label") {
        if (it.align === "center") x = it.x + (it.w - textW) / 2; else if (it.align === "right") x = it.x + it.w - textW;
      }
      let y = it.y;
      if (it.k === "label" && it.vert === "center") y = it.y + (it.h - lineH) / 2;
      const h = it.k === "tracked" ? it.h : Math.round(it.size * 1.011) + Math.round(it.size * 0.353);
      const colour = it.color;
      elements.push({
        text: it.text.replace(/\s+/g, " ").trim(), role: it.aria ?? it.arole ?? (it.role === "ink" && it.k === "tracked" && it.size >= 30 ? "heading" : "text"),
        rect: { x, y, w: textW, h }, color: colour ? hex(colour) : null, background: (it.fixed ? it.bg : under(x, y, textW, h)) || it.bg || bg(x, y, textW, h),
        fontSize: it.size, fontWeight: f.weight, ...(it.radius ? { radius: it.radius } : {}), ...(it.op < 0.995 ? { opacity: Math.round(it.op * 100) / 100 } : {}), _id: it.id, _tracked: it.k === "tracked" ? it.role : undefined,
      });
    } else if (it.k === "box") {
      const background = it.bg ?? bg(it.x, it.y, it.w, it.h);
      elements.push({ text: it.text ?? "", role: it.role, rect: { x: it.x, y: it.y, w: it.w, h: it.h }, color: null, background, fontSize: null, fontWeight: null, ...(it.radius ? { radius: it.radius } : {}), ...(it.opacity ? { opacity: it.opacity } : {}) });
    } else if (it.k === "poster" && it.w > 0 && it.h > 0) {
      elements.push({ text: "", role: "image", rect: { x: it.x, y: it.y, w: it.w, h: it.h }, color: null, background: bg(it.x, it.y, it.w, it.h), fontSize: null, fontWeight: null, _id: it.id, _uri: it.uri });
    } else if (it.k === "rect") {
      elements.push({ text: "", role: "container", rect: { x: it.x, y: it.y, w: it.w, h: it.h }, color: null, background: hex(it.color), fontSize: null, fontWeight: null, _id: it.id });
    }
  }
  const inView = (e) => e.rect.x < 1920 && e.rect.y < 1080 && e.rect.x + e.rect.w > 0 && e.rect.y + e.rect.h > 0;
  elements.splice(0, elements.length, ...elements.filter(inView));
  return { screen, theme, viewport: { w: 1920, h: 1080, dpr: 1 }, clockPinned: !!clockPinned, ...(dbg.length ? { _dbg: dbg } : {}), elements };
}
