// Web layout export (docs/parity/LAYOUT.md): the visible elements of the page as { text, role, rect, color, background, fontSize, ... }.
// layoutPageFn runs INSIDE the page (Playwright page.evaluate or a TV inspector eval), so it is self-contained, uses only old-browser syntax
// (webOS 4 is Chromium 53) and has no line comments (the Tizen eval channel flattens newlines).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const VOLATILE = JSON.parse(readFileSync(join(here, "layout-volatile.json"), "utf8"));

/** The volatile entries that apply to one screen. */
export const volatileFor = (screen) => [...(VOLATILE["*"] ?? []), ...(VOLATILE[screen] ?? [])];

export function layoutPageFn(volatile) {
  var round = function (n) { return Math.round(n * 100) / 100; };
  var hex2 = function (n) { var s = Math.round(n).toString(16); return s.length < 2 ? "0" + s : s; };
  var parse = function (c) {
    var cm = /color\(srgb ([^)]+)\)/.exec(c);
    if (cm) {
      var q = cm[1].split(/[ \/]+/).filter(Boolean).map(Number);
      return [q[0] * 255, q[1] * 255, q[2] * 255, q.length > 3 ? q[3] : 1];
    }
    var m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m && /^(oklab|oklch|lab|lch|hwb|hsl|hsla|color)\(/.test(c)) {
      /* a computed colour in another space (color-mix in oklab, ...): let the browser convert it to sRGB */
      var cv = document.createElement("canvas"); cv.width = cv.height = 1;
      var cx = cv.getContext("2d"); cx.clearRect(0, 0, 1, 1); cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
      var px = cx.getImageData(0, 0, 1, 1).data;
      return [px[0], px[1], px[2], px[3] / 255];
    }
    if (!m) return [0, 0, 0, 0];
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  var toHex = function (c) { return "#" + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) + (c[3] < 1 ? hex2(c[3] * 255) : ""); };
  var over = function (top, bottom) {
    var a = top[3] + bottom[3] * (1 - top[3]);
    if (a <= 0) return [0, 0, 0, 0];
    return [0, 1, 2].map(function (i) { return (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a; }).concat([a]);
  };
  var backdrop = function (el) {
    var chain = [];
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) chain.unshift(n);
    var acc = [255, 255, 255, 1];
    chain.forEach(function (n) { acc = over(parse(getComputedStyle(n).backgroundColor), acc); });
    return acc;
  };
  var effOpacity = function (el) {
    var o = 1;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };
  var zoomOf = function (el) {
    var z = 1;
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) z *= Number(getComputedStyle(n).zoom) || 1;
    return z;
  };
  /* Direct text nodes join with no separator unless something that draws a gap sits between them: a rendered, in-flow element (flex gap, icon) or collapsible white space. */
  var gapBetween = function (a, b) {
    for (var n = a.nextSibling; n && n !== b; n = n.nextSibling) {
      if (n.nodeType === 3) return true;
      if (n.nodeType !== 1) continue;
      var s = getComputedStyle(n);
      if (s.display !== "none" && s.position !== "absolute" && s.position !== "fixed") return true;
    }
    return false;
  };
  var joinTexts = function (nodes) {
    return nodes.map(function (n, i) { return (i > 0 && gapBetween(nodes[i - 1], n) ? " " : "") + n.textContent; }).join("");
  };
  var norm = function (s) { return String(s || "").replace(/\s+/g, " ").trim(); };
  /* Chromium has no text-transform: full-width (computed value is none). capitalize upper-cases the first letter of each word. */
  var isLetter = function (c) { return c.toLowerCase() !== c.toUpperCase(); };
  var shown = function (s, cs) {
    var t = cs.textTransform;
    if (/uppercase/.test(t)) return s.toUpperCase();
    if (/lowercase/.test(t)) return s.toLowerCase();
    if (!/capitalize/.test(t)) return s;
    var out = "", prev = " ";
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      out += isLetter(c) && !isLetter(prev) && !/[0-9'\u2019]/.test(prev) ? c.toUpperCase() : c;
      prev = c;
    }
    return out;
  };
  /* One run per rendered line: the text on the line and the bounds of its non-blank glyphs. */
  var lineRuns = function (nodes, cs) {
    var lines = [], cur = null, range = document.createRange();
    for (var a = 0; a < nodes.length; a++) {
      var data = nodes[a].data;
      if (a > 0 && cur && gapBetween(nodes[a - 1], nodes[a])) cur.text += " ";
      for (var i = 0; i < data.length; i++) {
        range.setStart(nodes[a], i);
        range.setEnd(nodes[a], i + 1);
        var cr = range.getBoundingClientRect();
        /* A space the engine reports with an empty box (some Chromium builds do this before an inline boundary) still separates words on the line. */
        if ((cr.width <= 0 || cr.height <= 0) && cur && /\s/.test(data.charAt(i))) { cur.text += " "; continue; }
        if (cr.width <= 0 || cr.height <= 0) continue;
        if (!cur || (cr.top + cr.bottom) / 2 > cur.bottom) { cur = { text: "", bottom: cr.bottom, l: null }; lines.push(cur); }
        cur.bottom = Math.max(cur.bottom, cr.bottom);
        cur.text += data.charAt(i);
        if (!/\S/.test(data.charAt(i))) continue;
        cur.l = cur.l ? { left: Math.min(cur.l.left, cr.left), top: Math.min(cur.l.top, cr.top), right: Math.max(cur.l.right, cr.right), bottom: Math.max(cur.l.bottom, cr.bottom) } : { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
      }
    }
    return lines.filter(function (x) { return x.l && norm(x.text); }).map(function (x) {
      return { text: shown(norm(x.text), cs), left: x.l.left, top: x.l.top, w: x.l.right - x.l.left, h: x.l.bottom - x.l.top };
    });
  };
  /* A single line cut by text-overflow: ellipsis shows the characters that fit before the ellipsis, then "…". Returns null when nothing is cut.
     The drawn ellipsis is not in the DOM: its width is the laid-out run of a probe "…" appended inside the element (same font, spacing and zoom),
     the kept characters are the real per-character boxes that fit. shortcut: left-to-right text only. */
  var ellipsise = function (el, nodes, cs) {
    var box = el.getBoundingClientRect();
    var scale = el.offsetWidth ? box.width / el.offsetWidth : 1;
    var limit = box.left + scale * (el.clientLeft + el.clientWidth - (parseFloat(cs.paddingRight) || 0));
    var probe = document.createElement("span");
    probe.textContent = "\u2026";
    el.appendChild(probe);
    var pr = document.createRange();
    pr.selectNodeContents(probe);
    var ellW = pr.getBoundingClientRect().width;
    el.removeChild(probe);
    var range = document.createRange(), text = "", l = null;
    for (var a = 0; a < nodes.length; a++) {
      for (var i = 0; i < nodes[a].data.length; i++) {
        range.setStart(nodes[a], i); range.setEnd(nodes[a], i + 1);
        var cr = range.getBoundingClientRect();
        if (cr.width <= 0) continue;
        if (cr.right > limit - ellW + 0.01) return text.replace(/\s+$/, "") && l ? { text: shown(norm(text), cs) + "\u2026", left: l.left, top: l.top, right: Math.min(limit, l.right + ellW), bottom: l.bottom } : null;
        text += nodes[a].data.charAt(i);
        if (/\S/.test(nodes[a].data.charAt(i))) l = l ? { left: Math.min(l.left, cr.left), top: Math.min(l.top, cr.top), right: Math.max(l.right, cr.right), bottom: Math.max(l.bottom, cr.bottom) } : { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
      }
    }
    return null;
  };
  var clipped = function (el, r) {
    var left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (var n = el; n && n !== document.documentElement; n = n.parentElement) {
      var s = getComputedStyle(n);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      var c = n.getBoundingClientRect();
      left = Math.max(left, c.left); right = Math.min(right, c.right); top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom);
      if (right <= left || bottom <= top) return true;
    }
    return false;
  };
  var roleOf = function (el, leaf) {
    var explicit = el.getAttribute("role");
    if (explicit) return explicit;
    var tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return "link";
    if (tag === "input" || tag === "textarea") return el.type === "checkbox" || el.type === "radio" ? "switch" : "textbox";
    if (tag === "select") return "select";
    if (tag === "img" || tag === "svg" || tag === "canvas") return "image";
    if (tag === "video") return "video";
    if (/^h[1-6]$/.test(tag)) return "heading";
    return leaf ? "text" : "container";
  };
  var matchVolatile = function (el, ownText) {
    for (var i = 0; i < volatile.length; i++) {
      var v = volatile[i];
      if (v.selector) {
        var host = el.closest(v.selector);
        if (host) return { entry: v, host: host };
      } else if (v.textRegex && ownText && new RegExp(v.textRegex).test(ownText)) return { entry: v, host: el };
    }
    return null;
  };
  var visibleFill = function (cs, el) {
    var shade = parse(cs.backgroundColor)[3] > 0 && (!el.parentElement || toHex(backdrop(el)) !== toHex(backdrop(el.parentElement)));
    return shade || cs.backgroundImage !== "none" || parseFloat(cs.borderTopWidth) > 0 && parse(cs.borderTopColor)[3] > 0 || cs.boxShadow !== "none";
  };
  var hiddenHost = function (el) {
    if (el.closest("[inert]")) return true;
    var aria = el.closest('[aria-hidden="true"]');
    return !!aria && !!aria.querySelector("a,button,input,select,textarea,[tabindex]");
  };
  var srOnly = function (el) {
    for (var n = el; n && n !== document.body; n = n.parentElement) {
      var s = getComputedStyle(n);
      var b = n.getBoundingClientRect();
      var tiny = b.width <= 1 && b.height <= 1;
      var cut = s.overflowX !== "visible" || s.overflowY !== "visible" || (s.clip && s.clip !== "auto") || (s.clipPath && s.clipPath !== "none");
      if (tiny && cut) return true;
      if (/^rect\((0(px)?[, ]*){4}\)$/.test(s.clip || "") || /^inset\((50|100)%\)$/.test(s.clipPath || "")) return true;
    }
    return false;
  };
  var covers = function (hit, el) {
    var tag = hit.tagName.toLowerCase();
    if (tag === "img" || tag === "video" || tag === "canvas" || tag === "svg") return true;
    for (var n = hit; n && n.nodeType === 1 && !n.contains(el); n = n.parentElement) {
      var s = getComputedStyle(n);
      if (parse(s.backgroundColor)[3] >= 0.5 || s.backgroundImage !== "none" || s.backdropFilter && s.backdropFilter !== "none" || s.webkitBackdropFilter && s.webkitBackdropFilter !== "none") return true;
    }
    return false;
  };
  /* Covered when, at every sample point, some layer above the element (any pointer-transparent one is skipped by the hit test) paints over it.
     A pointer-events:none subject is made hit-testable for the test so its place in the stack is known. */
  var occluded = function (el, r) {
    if (!document.elementsFromPoint) return false;
    var st = el.style, prev = st.getPropertyValue("pointer-events"), prio = st.getPropertyPriority("pointer-events");
    st.setProperty("pointer-events", "auto", "important");
    try {
      var l = Math.max(r.left, 0), t = Math.max(r.top, 0), rt = Math.min(r.right, innerWidth), b = Math.min(r.bottom, innerHeight);
      var fr = [0.2, 0.5, 0.8];
      for (var a = 0; a < 3; a++) for (var c = 0; c < 3; c++) {
        var hits = document.elementsFromPoint(l + (rt - l) * fr[a], t + (b - t) * fr[c]), hidden = false;
        for (var h = 0; h < hits.length; h++) {
          if (el.contains(hits[h]) || hits[h].contains(el)) break;
          if (covers(hits[h], el)) { hidden = true; break; }
        }
        if (!hidden) return false;
      }
      return true;
    } finally {
      if (prev) st.setProperty("pointer-events", prev, prio); else st.removeProperty("pointer-events");
    }
  };
  var rows = [];
  var dropped = 0;
  var all = document.body.querySelectorAll("*");
  for (var i = 0; i < all.length; i++) {
    var el = all[i];
    var tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript" || tag === "link" || tag === "meta") continue;
    if (el.closest("svg") && tag !== "svg") continue;
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (hiddenHost(el)) continue;
    if (srOnly(el)) continue;
    var texts = [];
    for (var k = 0; k < el.childNodes.length; k++) if (el.childNodes[k].nodeType === 3 && norm(el.childNodes[k].textContent)) texts.push(el.childNodes[k]);
    var own = shown(norm(joinTexts(texts)), cs);
    var fill = parse(cs.webkitTextFillColor || cs.color);
    var gradient = null;
    if (own && fill[3] === 0) {
      var clip = cs.webkitBackgroundClip || cs.backgroundClip;
      var stop = clip === "text" && /gradient/.test(cs.backgroundImage) ? /rgba?\([^)]+\)/.exec(cs.backgroundImage) : null;
      if (stop) gradient = parse(stop[0]); else own = "";
    }
    var vol = matchVolatile(el, own);
    if (vol && vol.entry.omit) continue;
    var control = /^(a|button|input|select|textarea)$/.test(tag) || /^(button|link|tab|switch|checkbox|menuitem|option|slider)$/.test(el.getAttribute("role") || "") || el.tabIndex >= 0 && el.hasAttribute("tabindex");
    var r = el.getBoundingClientRect();
    /* the glyph runs of the element's own text: one per rendered line, the union is the row box */
    var runs = own ? lineRuns(texts, cs) : [];
    if (runs.length) {
      var ux = Math.min.apply(null, runs.map(function (q) { return q.left; })), uy = Math.min.apply(null, runs.map(function (q) { return q.top; }));
      var ur = Math.max.apply(null, runs.map(function (q) { return q.left + q.w; })), ub = Math.max.apply(null, runs.map(function (q) { return q.top + q.h; }));
      r = { left: ux, top: uy, right: ur, bottom: ub, width: ur - ux, height: ub - uy };
    }
    if (vol && control) r = el.getBoundingClientRect(); /* a volatile control keeps its own box */
    var cut = own && !vol && cs.textOverflow === "ellipsis" && cs.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1 ? ellipsise(el, texts, cs) : null;
    if (cut) {
      own = cut.text;
      r = { left: cut.left, top: cut.top, right: cut.right, bottom: cut.bottom, width: cut.right - cut.left, height: cut.bottom - cut.top };
    }
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
    if (clipped(el, r)) continue;
    var op = effOpacity(el);
    if (op <= 0) continue;
    var media = tag === "img" || tag === "svg" || tag === "canvas" || tag === "video";
    var painted = visibleFill(cs, el);
    if (!own && !control && !media && !painted) continue;
    if (occluded(el, r)) { dropped++; continue; }
    var label = el.getAttribute("aria-label") || el.getAttribute("alt") || "";
    var text = own || (control || media ? norm(label) : "") || (control ? norm(el.innerText || el.value) : "");
    var zoom = zoomOf(el);
    var rawRadius = cs.borderTopLeftRadius;
    var box = el.getBoundingClientRect();
    var radius = (parseFloat(rawRadius) || 0) * zoom;
    /* a percentage resolves against the box (min side for round/pill); any radius is capped at half the short side */
    if (/%$/.test(rawRadius)) radius = parseFloat(rawRadius) / 100 * Math.min(box.width, box.height);
    radius = Math.min(radius, Math.min(box.width, box.height) / 2);
    /* A control with its own text keeps its CSS border box as the control element; the text is a separate text element with glyph-run bounds. */
    var split = control && !!own && !vol;
    if (split && box.width >= 1 && box.height >= 1 && !clipped(el, box) && !occluded(el, box)) {
      var crow = {
        text: norm(label) || own,
        role: roleOf(el, false),
        rect: { x: round(box.left), y: round(box.top), w: round(box.width), h: round(box.height) },
        color: null,
        background: toHex(backdrop(el)),
        fontSize: null,
        fontWeight: null
      };
      if (radius > 0) { crow.radius = round(radius); if (!painted) crow.painted = false; }
      if (op < 1) crow.opacity = round(op);
      rows.push(crow);
    }
    var row = {
      text: text,
      role: split ? "text" : roleOf(el, !!own),
      rect: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) },
      color: own ? toHex(gradient || fill) : null,
      background: toHex(backdrop(el)),
      fontSize: own ? round(parseFloat(cs.fontSize) * zoom) : null,
      fontWeight: own ? Number(cs.fontWeight) || 400 : null
    };
    if (gradient) row.colorGradient = true;
    if (radius > 0 && !split) { row.radius = round(radius); if (!painted) row.painted = false; }
    if (op < 1 && !(vol && vol.entry.opacityVolatile)) row.opacity = round(op);
    if (vol && vol.entry.opacityVolatile) row.opacityVolatile = true;
    if (vol) {
      row.volatile = vol.entry.name;
      if (vol.entry.clock) row.clock = true;
      if (vol.entry.maskOnly) row.maskOnly = true;
    }
    if (!vol && !cut && runs.length > 1) {
      for (var q = 0; q < runs.length; q++) {
        var run = runs[q];
        if (run.w < 1 || run.h < 1) continue;
        var lr = { left: run.left, top: run.top, right: run.left + run.w, bottom: run.top + run.h };
        if (lr.right <= 0 || lr.bottom <= 0 || lr.left >= innerWidth || lr.top >= innerHeight || clipped(el, lr)) continue;
        if (occluded(el, lr)) { dropped++; continue; }
        rows.push(Object.assign({}, row, { text: run.text, rect: { x: round(run.left), y: round(run.top), w: round(run.w), h: round(run.h) } }));
      }
    } else rows.push(row);
  }
  return { viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, elements: rows, occluded: dropped };
}

/** Run the page function in a Playwright page and return the schema document. */
export async function dumpLayout(page, { screen, theme }) {
  const doc = await page.evaluate(layoutPageFn, volatileFor(screen));
  return { screen, theme, ...doc };
}

/** Expression for an inspector eval (TV drivers): returns the same { viewport, elements }. */
export const layoutExpression = (screen) => `(${layoutPageFn.toString()})(${JSON.stringify(volatileFor(screen))})`;
