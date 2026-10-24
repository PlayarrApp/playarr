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
  var norm = function (s) { return String(s || "").replace(/\s+/g, " ").trim(); };
  var shown = function (s, cs) {
    var t = cs.textTransform;
    return t === "uppercase" ? s.toUpperCase() : t === "lowercase" ? s.toLowerCase() : s;
  };
  var clipped = function (el, r) {
    var left = r.left, top = r.top, right = r.right, bottom = r.bottom;
    for (var n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
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
  var occluded = function (el, r) {
    if (!document.elementFromPoint || getComputedStyle(el).pointerEvents === "none") return false;
    var l = Math.max(r.left, 0), t = Math.max(r.top, 0), rt = Math.min(r.right, innerWidth), b = Math.min(r.bottom, innerHeight);
    var fr = [0.2, 0.5, 0.8];
    for (var a = 0; a < 3; a++) for (var c = 0; c < 3; c++) {
      var hit = document.elementFromPoint(l + (rt - l) * fr[a], t + (b - t) * fr[c]);
      if (!hit || el.contains(hit) || hit.contains(el) || !covers(hit, el)) return false;
    }
    return true;
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
    var own = shown(norm(texts.map(function (n) { return n.textContent; }).join(" ")), cs);
    var fill = parse(cs.webkitTextFillColor || cs.color);
    var gradient = null;
    if (own && fill[3] === 0) {
      var clip = cs.webkitBackgroundClip || cs.backgroundClip;
      var stop = clip === "text" && /gradient/.test(cs.backgroundImage) ? /rgba?\([^)]+\)/.exec(cs.backgroundImage) : null;
      if (stop) gradient = parse(stop[0]); else own = "";
    }
    var vol = matchVolatile(el, own);
    if (vol && vol.host !== el) continue;
    if (vol && vol.entry.omit) continue;
    var r = el.getBoundingClientRect();
    if (vol && own) {
      var range = document.createRange();
      range.selectNodeContents(el);
      var rr = range.getBoundingClientRect();
      if (rr.width >= 1 && rr.height >= 1 && !vol.entry.selector) r = rr;
    } else if (own) {
      var rg = document.createRange();
      rg.setStartBefore(texts[0]);
      rg.setEndAfter(texts[texts.length - 1]);
      var tr = rg.getBoundingClientRect();
      if (tr.width >= 1 && tr.height >= 1) r = tr;
    }
    if (r.width < 1 || r.height < 1 || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
    if (clipped(el, r)) continue;
    var op = effOpacity(el);
    if (op <= 0) continue;
    var control = /^(a|button|input|select|textarea)$/.test(tag) || /^(button|link|tab|switch|checkbox|menuitem|option|slider)$/.test(el.getAttribute("role") || "") || el.tabIndex >= 0 && el.hasAttribute("tabindex");
    var media = tag === "img" || tag === "svg" || tag === "canvas" || tag === "video";
    var painted = visibleFill(cs, el);
    if (!vol && !own && !control && !media && !painted) continue;
    if (occluded(el, r)) { dropped++; continue; }
    var label = el.getAttribute("aria-label") || el.getAttribute("alt") || "";
    var text = own || (control || media ? norm(label) : "") || (control ? norm(el.innerText || el.value) : "");
    var zoom = zoomOf(el);
    var radius = (parseFloat(cs.borderTopLeftRadius) || 0) * zoom;
    var row = {
      text: vol && !vol.entry.selector ? own : vol ? norm(el.innerText) : text,
      role: roleOf(el, !!own),
      rect: { x: round(r.left), y: round(r.top), w: round(r.width), h: round(r.height) },
      color: own ? toHex(gradient || fill) : null,
      background: toHex(backdrop(el)),
      fontSize: own ? round(parseFloat(cs.fontSize) * zoom) : null,
      fontWeight: own ? Number(cs.fontWeight) || 400 : null
    };
    if (gradient) row.colorGradient = true;
    if (radius > 0) row.radius = round(radius);
    if (op < 1) row.opacity = round(op);
    if (vol) {
      row.volatile = vol.entry.name;
      if (vol.entry.clock) row.clock = true;
      if (vol.entry.maskOnly) row.maskOnly = true;
    }
    rows.push(row);
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
