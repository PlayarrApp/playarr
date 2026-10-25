// Parity layout exporter (docs/parity/LAYOUT.md). Walks the item tree under `root` and logs what the app draws, measured from the
// items themselves: geometry from the item rectangles, text bounds from the laid-out text (baseline, font ascent and descent, content
// width), colours and opacity from the items, backgrounds composited from the filled rectangles painted before. Nothing is declared
// per screen: an element the app does not draw is not exported. Only selection hooks exist (layoutSkip: do not emit this item,
// layoutNoEmit: a plate that another item reports, layoutSkipTree: skip the subtree) and semantic names (parityRole, a11yName).
// Lines: `LAYOUTEL|<json array>` in chunks of 10, then `LAYOUTEND|w|h`. Parity builds only: called from a PLAYARR_STEPS step.
.pragma library

function hex(c, op) {
    function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? "0" + s : s }
    var a = c.a * (op === undefined ? 1 : op)
    return "#" + h(c.r) + h(c.g) + h(c.b) + (a < 0.999 ? h(a) : "")
}
function r2(v) { return Math.round(v * 100) / 100 }
function weightOf(item, weights) {
    var w = weights[item.font.family]
    if (w !== undefined) return w
    var f = item.font.weight
    return f >= 75 ? 700 : f >= 63 ? 600 : f <= 25 ? 300 : 400
}

// metrics(font, text) -> { ascent, descent } in device pixels, from Qt's FontMetrics.
function dump(root, u, weights, metrics, log) {
    var fills = [], out = []
    // Backdrop at a point: the fills painted before `limit` (ancestors and earlier siblings), plus, from `limit` on, only the plates that
    // cover the whole of `cover` ({x, y, w, h}): the element's own background, drawn as a child rectangle.
    function bgAt(cx, cy, limit, cover) {
        cx = Math.min(cx, root.width - 1); cy = Math.min(cy, root.height - 1)
        var bg = [255, 255, 255], end = limit === undefined ? fills.length : fills.length
        for (var i = 0; i < end; ++i) {
            var f = fills[i]
            if (limit !== undefined && i >= limit && !(f.x <= cover.x + 1 && f.y <= cover.y + 1 && f.x + f.w >= cover.x + cover.w - 1 && f.y + f.h >= cover.y + cover.h - 1)) continue
            if (cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h)
                for (var k = 0; k < 3; ++k) bg[k] = bg[k] * (1 - f.a) + f.c[k] * f.a
        }
        function h(v) { var s = Math.round(v).toString(16); return s.length < 2 ? "0" + s : s }
        return "#" + h(bg[0]) + h(bg[1]) + h(bg[2])
    }
    function rect(x, y, w, h) { return { x: r2(x / u), y: r2(y / u), w: r2(w / u), h: r2(h / u) } }
    function radiusOf(item, w, h) {
        var r = Math.min(item.radius, Math.min(w, h) / 2) / u
        return r > 0.005 ? r2(r) : 0
    }
    function walk(item, opAcc) {
        if (!item || !item.visible || item.layoutSkipTree === true) return
        var op = opAcc * item.opacity
        if (op <= 0.001) return
        var p = item.mapToItem(null, 0, 0), x = p.x, y = p.y, w = item.width, h = item.height
        if (x >= root.width || x + w <= 0 || y >= root.height || y + h <= 0) return
        var mark = out.length, fmark = fills.length
        if (item.layoutSkip !== true) {
            if (typeof item.text === "string" && item.contentWidth !== undefined && item.font !== undefined && item.color !== undefined && item.text.length > 0) {
                var lines = Math.max(1, item.lineCount || 1), pitch = item.contentHeight / lines
                var shown = item.font.capitalization === 1 ? item.text.toUpperCase() : item.text
                var cw = (item.elide !== undefined && item.elide !== 0 && lines === 1 && item.implicitWidth > item.contentWidth) ? item.implicitWidth : item.contentWidth
                var ha = item.horizontalAlignment
                var x0 = x + (ha === 4 ? (w - cw) / 2 : ha === 2 ? w - cw : 0)
                // Text run box: Qt's own font ascent and descent (FontMetrics) from the baseline Qt laid the text on.
                var m = metrics(item.font, shown)
                var gh = (lines - 1) * pitch + m.ascent + m.descent
                var el = { text: shown.replace(/\s+/g, " ").trim(), role: item.parityRole || "text", rect: rect(x0, y + item.baselineOffset - m.ascent, cw, gh),
                    color: hex(item.color), background: bgAt(x0 + cw / 2, y + item.baselineOffset), fontSize: r2(item.font.pixelSize / u), fontWeight: weightOf(item, weights) }
                if (item.focusRadius) el.radius = r2(item.focusRadius / u)
                if (op < 0.999) el.opacity = r2(op)
                if (el.text !== "") out.push(el)
            } else if (item.border !== undefined && item.radius !== undefined && item.color !== undefined && w > 0 && h > 0) {
                var filled = item.color.a > 0 && !item.gradient
                if (filled) fills.push({ x: x, y: y, w: w, h: h, c: [item.color.r * 255, item.color.g * 255, item.color.b * 255], a: item.color.a * op })
                if ((filled || item.border.width > 0) && item.layoutNoEmit !== true) {
                    var rc = { text: "", role: item.parityRole || "container", rect: rect(x, y, w, h), color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null, _at: [x + w / 2, y + h / 2], _box: { x: x, y: y, w: w, h: h } }
                    var rr = radiusOf(item, w, h)
                    if (rr) rc.radius = rr
                    if (op < 0.999) rc.opacity = r2(op)
                    out.push(rc)
                }
            } else if (item.source !== undefined && item.status !== undefined && item.paintedWidth !== undefined && w > 0 && h > 0 && item.status === 1) {
                var im = { text: "", role: item.parityRole || "image", rect: rect(x, y, w, h), color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null }
                if (op < 0.999) im.opacity = r2(op)
                out.push(im)
            } else if (item.available !== undefined && item.renderTarget !== undefined && w > 0 && h > 0) {
                // Canvas: a drawn icon
                var cv = { text: "", role: item.parityRole || "image", rect: rect(x, y, w, h), color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null }
                if (op < 0.999) cv.opacity = r2(op)
                out.push(cv)
            } else if (item.maskSource !== undefined && item.parityRole && w > 0 && h > 0) {
                // a masked picture (rounded artwork): the visible drawing of an image
                var mk = { text: "", role: item.parityRole, rect: rect(x, y, w, h), color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null }
                if (op < 0.999) mk.opacity = r2(op)
                out.push(mk)
            } else if ((item.navigationFocusable === true || item.a11yName !== undefined) && w > 0 && h > 0) {
                var fr = { text: String(item.a11yName !== undefined ? item.a11yName : item.parityLabel || ""), role: item.parityRole || "button", rect: rect(x, y, w, h),
                    color: null, background: bgAt(x + w / 2, y + h / 2), fontSize: null, fontWeight: null, _at: [x + w / 2, y + h / 2], _box: { x: x, y: y, w: w, h: h } }
                if (item.focusRadius) fr.radius = r2(Math.min(item.focusRadius, Math.min(w, h) / 2) / u)
                if (op < 0.999) fr.opacity = r2(op)
                out.push(fr)
            }
        }
        var kids = item.children
        for (var i = 0; i < kids.length; ++i) walk(kids[i], op)
        // an element's background includes its own fill and its children's: settle it once the subtree has been painted
        for (var j = mark; j < out.length; ++j) if (out[j]._at) { out[j].background = bgAt(out[j]._at[0], out[j]._at[1], fmark, out[j]._box); delete out[j]._at; delete out[j]._box }
    }
    walk(root, 1)
    // journald rate-limits per message, so the elements go out in chunks.
    for (var c = 0; c < out.length; c += 10) log("LAYOUTEL|" + JSON.stringify(out.slice(c, c + 10)))
    log("LAYOUTEND|" + r2(root.width / u) + "|" + r2(root.height / u))
}
