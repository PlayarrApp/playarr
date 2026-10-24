// Parity layout exporter (docs/parity/LAYOUT.md): walks the item tree under `root` and logs one `LAYOUTEL|<json>` line per
// element (text runs, filled or bordered rectangles, images, focusable controls), then `LAYOUTEND`. Rects are CSS px of the
// 390 px wide layout viewport (device px / u). Parity builds only: called from a PLAYARR_STEPS `js:` step.
.pragma library

function hex(c, op) {
    function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? "0" + s : s }
    return "#" + h(c.r) + h(c.g) + h(c.b) + (c.a * (op === undefined ? 1 : op) < 0.999 ? h(c.a * (op === undefined ? 1 : op)) : "")
}
function r2(v) { return Math.round(v * 100) / 100 }

function dump(root, u, weights, log) {
    var fills = []
    function bgAt(cx, cy) {
        cx = Math.min(cx, root.width - 1); cy = Math.min(cy, root.height - 1)   // a box running off the screen takes the colour at its visible edge
        var bg = [255, 255, 255]
        for (var i = 0; i < fills.length; ++i) {
            var f = fills[i]
            if (cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h) {
                for (var k = 0; k < 3; ++k) bg[k] = bg[k] * (1 - f.a) + f.c[k] * f.a
            }
        }
        function h(v) { var s = Math.round(v).toString(16); return s.length < 2 ? "0" + s : s }
        return "#" + h(bg[0]) + h(bg[1]) + h(bg[2])
    }
    function rect(x, y, w, h) { return { x: r2(x / u), y: r2(y / u), w: r2(w / u), h: r2(h / u) } }
    var out = []
    function emit(e) { out.push(e) }
    function walk(item, opAcc) {
        if (!item || !item.visible || item.layoutSkipTree === true) return
        var op = opAcc * item.opacity
        if (op <= 0.001) return
        var p = item.mapToItem(null, 0, 0), x = p.x, y = p.y, w = item.width, h = item.height
        if (x >= root.width || x + w <= 0 || y >= root.height || y + h <= 0) return   // off screen: not drawn, so not part of the web document either
        if (item.layoutOpacity !== undefined) op = opAcc * item.layoutOpacity
        var skip = item.layoutSkip === true
        var els = item.layoutEls
        if (els) for (var q = 0; q < els.length; ++q) {
            var le = els[q], lx = le.x !== undefined ? le.x : p.x / u + (le.dx || 0), ly = le.y !== undefined ? le.y : p.y / u + (le.dy || 0)
            var lw = le.w !== undefined ? le.w : w / u, lh = le.h !== undefined ? le.h : h / u
            var lo = le.opacity !== undefined ? le.opacity : op
            var lr = { text: le.text || "", role: le.role || "container", rect: { x: r2(lx), y: r2(ly), w: r2(lw), h: r2(lh) }, color: le.color || null,
                background: le.bg || bgAt((lx + lw / 2) * u, (ly + lh / 2) * u), fontSize: le.fontSize || null, fontWeight: le.fontWeight || null }
            if (le.radius) lr.radius = le.radius
            if (lo < 0.999) lr.opacity = r2(lo)
            emit(lr)
        }
        if (skip) {
        } else if (typeof item.text === "string" && item.contentWidth !== undefined && item.font !== undefined && item.text.length > 0 && item.color !== undefined) {
            var cw = item.contentWidth, ch = item.contentHeight
            var ha = item.horizontalAlignment, va = item.verticalAlignment
            var x0 = x + (ha === 4 ? (w - cw) / 2 : ha === 2 ? w - cw : 0)
            var y0 = y + (va === 128 ? (h - ch) / 2 : va === 64 ? h - ch : 0)
            var fam = item.font.family, wt = weights[fam]
            if (wt === undefined) wt = item.font.weight >= 75 ? 700 : item.font.weight >= 63 ? 600 : 400
            var t = String(item.text)
            if (item.font.capitalization === 1) t = t.toUpperCase()
            // glyph-run bounds: ascent plus descent of the font per line (Nunito Sans 1.364 em), not Qt's taller line box
            var fs = (item.font.pixelSize > 0 ? item.font.pixelSize : item.font.pointSize * 1.333), lines = Math.max(1, item.lineCount || 1), gh = (lines - 1) * (ch / lines) + (Math.round(1.011 * ((fs + 0.5) / u)) + Math.round(0.353 * ((fs + 0.5) / u))) * u   // ascent and descent rounded as Chromium does; the device pixel size is the css size rounded down to whole device pixels, so add half of one
            var el = { text: t.replace(/\s+/g, " ").trim(), role: item.parityRole || "text", rect: rect(x0, y + item.baselineOffset - Math.round(1.011 * ((fs + 0.5) / u)) * u, cw, gh),
                color: hex(item.color), background: item.layoutBg ? String(item.layoutBg) : bgAt(x0 + cw / 2, y0 + ch / 2), fontSize: r2((fs + 0.5) / u), fontWeight: wt }
            if (item.layoutRadius) el.radius = item.layoutRadius
            if (op < 0.999) el.opacity = r2(op)
            if (el.text !== "") emit(el)
        } else if (item.border !== undefined && item.radius !== undefined && item.color !== undefined && w > 0 && h > 0) {
            var filled = item.color.a > 0 && !item.gradient
            if (filled) fills.push({ x: x, y: y, w: w, h: h, c: [item.color.r * 255, item.color.g * 255, item.color.b * 255], a: item.color.a * op })
            if ((filled || item.border.width > 0) && item.layoutNoEmit !== true) {
                var rc = { text: String(item.layoutLabel || ""), role: item.parityRole || "container", rect: rect(x, y, w, h), color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null }
                if (item.radius > 0) rc.radius = item.radius >= Math.min(w, h) / 2 - 0.5 ? 50 : r2(Math.min(item.radius, Math.min(w, h) / 2) / u)   // a full circle is the web's border-radius 50%
                if (op < 0.999) rc.opacity = r2(op)
                emit(rc)
            }
        } else if (item.source !== undefined && item.status !== undefined && item.paintedWidth !== undefined && w > 0 && h > 0) {
            var im = { text: "", role: "image", rect: rect(x, y, w, h), color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null }
            if (op < 0.999) im.opacity = r2(op)
            emit(im)
        } else if (item.navigationFocusable === true && w > 0 && h > 0) {
            var fr = { text: String(item.layoutLabel || item.parityLabel || ""), role: item.parityRole || "button", rect: rect(x, y, w, item.layoutH !== undefined ? item.layoutH : h), color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null }
            if (item.layoutRadius) fr.radius = item.layoutRadius
            emit(fr)
        }
        var kids = item.children
        for (var i = 0; i < kids.length; ++i) walk(kids[i], op)
    }
    walk(root, 1)
    // journald rate-limits per message, so the elements go out in a few lines (LAYOUTEL|<json array>), not one each.
    for (var c = 0; c < out.length; c += 10) log("LAYOUTEL|" + JSON.stringify(out.slice(c, c + 10)))
    log("LAYOUTEND|" + r2(root.width / u) + "|" + r2(root.height / u))
}
