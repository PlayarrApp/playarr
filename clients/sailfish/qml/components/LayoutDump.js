// Diagnostic parity layout exporter (docs/parity/LAYOUT.md). Walks the item tree under `root` and reports mapped item geometry,
// estimated text, item colours and opacity, and sampled backgrounds. Text is not measured from rendered line or glyph ranges; paint,
// accessibility and clipping semantics are incomplete. Output must not be treated as a clean layout audit. Nothing is declared per
// screen: selection hooks exist (layoutSkip, layoutNoEmit, layoutSkipTree) with semantic hints (parityRole, a11yName).
// Lines: `LAYOUTEL|<json array>` in chunks of 10, then `LAYOUTEND|w|h`. Parity builds only: called from a PLAYARR_STEPS step.
.pragma library

function hex(c, op) {
    function h(v) { var s = Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16); return s.length < 2 ? "0" + s : s }
    var a = c.a * (op === undefined ? 1 : op)
    return "#" + h(c.r) + h(c.g) + h(c.b) + (a < 0.999 ? h(a) : "")
}
function r2(v) { return Math.round(v * 100) / 100 }
var GEOMETRY_EPSILON = 0.000001
function polygonArea(poly) {
    var area = 0
    for (var i = 0; i < poly.length; ++i) {
        var a = poly[i], b = poly[(i + 1) % poly.length]
        area += a.x * b.y - b.x * a.y
    }
    return area / 2
}
function polygonSide(a, b, p, orientation) {
    return orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
}
function lineIntersection(p, q, dp, dq) {
    var t = dp / (dp - dq)
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }
}
function polygonContainsPoint(poly, p) {
    if (poly.length < 3 || Math.abs(polygonArea(poly)) <= GEOMETRY_EPSILON) return false
    var orientation = polygonArea(poly) >= 0 ? 1 : -1
    for (var i = 0; i < poly.length; ++i)
        if (polygonSide(poly[i], poly[(i + 1) % poly.length], p, orientation) < -GEOMETRY_EPSILON) return false
    return true
}
function polygonContainsPolygon(container, subject) {
    if (subject.length < 3) return false
    for (var i = 0; i < subject.length; ++i)
        if (!polygonContainsPoint(container, subject[i])) return false
    return true
}
function mappedRect(item, root, x, y, w, h) {
    return [item.mapToItem(root, x, y), item.mapToItem(root, x + w, y),
        item.mapToItem(root, x + w, y + h), item.mapToItem(root, x, y + h)]
}
function clipPolygon(subject, clip) {
    if (subject.length < 3 || clip.length < 3 || Math.abs(polygonArea(subject)) <= GEOMETRY_EPSILON || Math.abs(polygonArea(clip)) <= GEOMETRY_EPSILON) return []
    var orientation = polygonArea(clip) >= 0 ? 1 : -1
    var output = subject
    for (var edge = 0; edge < clip.length && output.length; ++edge) {
        var a = clip[edge], b = clip[(edge + 1) % clip.length], input = output
        output = []
        var previous = input[input.length - 1], previousSide = polygonSide(a, b, previous, orientation)
        for (var i = 0; i < input.length; ++i) {
            var current = input[i], currentSide = polygonSide(a, b, current, orientation)
            if (currentSide >= -GEOMETRY_EPSILON) {
                if (previousSide < -GEOMETRY_EPSILON) output.push(lineIntersection(previous, current, previousSide, currentSide))
                output.push(current)
            } else if (previousSide >= -GEOMETRY_EPSILON) output.push(lineIntersection(previous, current, previousSide, currentSide))
            previous = current; previousSide = currentSide
        }
    }
    return output.length >= 3 && Math.abs(polygonArea(output)) > GEOMETRY_EPSILON ? output : []
}
function polygonBounds(poly) {
    if (!poly.length) return null
    var left = poly[0].x, right = left, top = poly[0].y, bottom = top
    for (var i = 1; i < poly.length; ++i) {
        left = Math.min(left, poly[i].x); right = Math.max(right, poly[i].x)
        top = Math.min(top, poly[i].y); bottom = Math.max(bottom, poly[i].y)
    }
    return { x: left, y: top, w: right - left, h: bottom - top }
}
function polygonCenter(poly) {
    var x = 0, y = 0
    for (var i = 0; i < poly.length; ++i) { x += poly[i].x; y += poly[i].y }
    return { x: x / poly.length, y: y / poly.length }
}
function clippedItemPolygon(item, root, x, y, w, h) {
    var polygon = mappedRect(item, root, x, y, w, h)
    var viewport = [{ x: 0, y: 0 }, { x: root.width, y: 0 }, { x: root.width, y: root.height }, { x: 0, y: root.height }]
    polygon = clipPolygon(polygon, viewport)
    // A non-clipping parent's own location never prunes descendants. Only clip ancestors constrain them.
    for (var parent = item.parent; parent && polygon.length; parent = parent.parent) {
        if (parent.clip === true) polygon = clipPolygon(polygon, mappedRect(parent, root, 0, 0, parent.width, parent.height))
        if (parent === root) break
    }
    if (item.clip === true && polygon.length)
        polygon = clipPolygon(polygon, mappedRect(item, root, 0, 0, item.width, item.height))
    return polygon
}
function uniformRadiusScale(item, root) {
    var p0 = item.mapToItem(root, 0, 0), px = item.mapToItem(root, 1, 0), py = item.mapToItem(root, 0, 1)
    var sx = Math.sqrt(Math.pow(px.x - p0.x, 2) + Math.pow(px.y - p0.y, 2))
    var sy = Math.sqrt(Math.pow(py.x - p0.x, 2) + Math.pow(py.y - p0.y, 2))
    var dot = (px.x - p0.x) * (py.x - p0.x) + (px.y - p0.y) * (py.y - p0.y)
    if (Math.abs(sx - sy) > 0.0001 || Math.abs(dot) > 0.0001) return null
    return (sx + sy) / 2
}
function weightOf(item, weights) {
    var w = weights[item.font.family]
    if (w !== undefined) return w
    var f = item.font.weight
    return f >= 75 ? 700 : f >= 63 ? 600 : f <= 25 ? 300 : 400
}

// metrics(font, text) -> { ascent, descent } in device pixels, from Qt's FontMetrics.
function dump(root, u, weights, metrics, log) {
    var fills = [], out = [], radiusLimitations = 0
    // Backdrop at a point: the fills painted before `limit` (ancestors and earlier siblings), plus, from `limit` on, only the plates that
    // cover the whole of `cover` ({x, y, w, h}): the element's own background, drawn as a child rectangle.
    function bgAt(cx, cy, limit, cover) {
        cx = Math.min(cx, root.width - 1); cy = Math.min(cy, root.height - 1)
        var bg = [255, 255, 255], end = limit === undefined ? fills.length : fills.length
        for (var i = 0; i < end; ++i) {
            var f = fills[i]
            if (limit !== undefined && i >= limit && !polygonContainsPolygon(f.polygon, cover)) continue
            if (polygonContainsPoint(f.polygon, { x: cx, y: cy }))
                for (var k = 0; k < 3; ++k) bg[k] = bg[k] * (1 - f.a) + f.c[k] * f.a
        }
        function h(v) { var s = Math.round(v).toString(16); return s.length < 2 ? "0" + s : s }
        return "#" + h(bg[0]) + h(bg[1]) + h(bg[2])
    }
    function rect(x, y, w, h) { return { x: r2(x / u), y: r2(y / u), w: r2(w / u), h: r2(h / u) } }
    function radiusOf(item, scale) {
        if (scale === null) return 0
        var r = Math.min(item.radius, Math.min(item.width, item.height) / 2) * scale / u
        return r > 0.005 ? r2(r) : 0
    }
    function walk(item, opAcc) {
        if (!item || !item.visible || item.layoutSkipTree === true) return
        var op = opAcc * item.opacity
        if (op <= 0.001) return
        var w = item.width, h = item.height
        var polygon = clippedItemPolygon(item, root, 0, 0, w, h), box = polygonBounds(polygon)
        var mark = out.length, fmark = fills.length
        if (box && item.layoutSkip !== true) {
            var x = box.x, y = box.y
            if (typeof item.text === "string" && item.contentWidth !== undefined && item.font !== undefined && item.color !== undefined && item.text.length > 0) {
                var lines = Math.max(1, item.lineCount || 1), pitch = item.contentHeight / lines
                var shown = item.font.capitalization === 1 ? item.text.toUpperCase() : item.text
                var cw = (item.elide !== undefined && item.elide !== 0 && lines === 1 && item.implicitWidth > item.contentWidth) ? item.implicitWidth : item.contentWidth
                var ha = item.horizontalAlignment
                var localX0 = ha === 4 ? (w - cw) / 2 : ha === 2 ? w - cw : 0
                // Legacy diagnostic paragraph estimate. This is not a rendered per-line range and cannot satisfy the layout gate.
                var m = metrics(item.font, shown)
                var gh = (lines - 1) * pitch + m.ascent + m.descent
                var textPoly = clippedItemPolygon(item, root, localX0, item.baselineOffset - m.ascent, cw, gh)
                var textBox = polygonBounds(textPoly)
                var textSample = textPoly.length ? polygonCenter(textPoly) : { x: 0, y: 0 }
                var el = { text: shown.replace(/\s+/g, " ").trim(), role: item.parityRole || "text", rect: textBox ? rect(textBox.x, textBox.y, textBox.w, textBox.h) : null,
                    color: hex(item.color), background: bgAt(textSample.x, textSample.y), fontSize: r2(item.font.pixelSize / u), fontWeight: weightOf(item, weights) }
                if (!textBox) el = null
                if (el && item.focusRadius) {
                    var textRadiusScale = uniformRadiusScale(item, root)
                    if (textRadiusScale !== null) el.radius = r2(Math.min(item.focusRadius, Math.min(w, h) / 2) * textRadiusScale / u)
                    else radiusLimitations += 1
                }
                if (el && op < 0.999) el.opacity = r2(op)
                if (el && el.text !== "") out.push(el)
            } else if (item.border !== undefined && item.radius !== undefined && item.color !== undefined && w > 0 && h > 0) {
                var filled = item.color.a > 0 && !item.gradient
                if (filled) fills.push({ polygon: polygon, c: [item.color.r * 255, item.color.g * 255, item.color.b * 255], a: item.color.a * op })
                if ((filled || item.border.width > 0) && item.layoutNoEmit !== true) {
                    var center = polygonCenter(polygon)
                    var rc = { text: "", role: item.parityRole || "container", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(center.x, center.y), fontSize: null, fontWeight: null, _at: [center.x, center.y], _box: polygon }
                    var rectangleRadiusScale = uniformRadiusScale(item, root)
                    var rr = radiusOf(item, rectangleRadiusScale)
                    if (item.radius > 0 && rectangleRadiusScale === null) radiusLimitations += 1
                    if (rr) rc.radius = rr
                    if (op < 0.999) rc.opacity = r2(op)
                    out.push(rc)
                }
            } else if (item.source !== undefined && item.status !== undefined && item.paintedWidth !== undefined && w > 0 && h > 0 && item.status === 1) {
                var imageCenter = polygonCenter(polygon)
                var im = { text: "", role: item.parityRole || "image", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(imageCenter.x, imageCenter.y), fontSize: null, fontWeight: null }
                if (op < 0.999) im.opacity = r2(op)
                out.push(im)
            } else if (item.available !== undefined && item.renderTarget !== undefined && w > 0 && h > 0) {
                // Canvas: a drawn icon
                var canvasCenter = polygonCenter(polygon)
                var cv = { text: "", role: item.parityRole || "image", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(canvasCenter.x, canvasCenter.y), fontSize: null, fontWeight: null }
                if (op < 0.999) cv.opacity = r2(op)
                out.push(cv)
            } else if (item.maskSource !== undefined && item.parityRole && w > 0 && h > 0) {
                // a masked picture (rounded artwork): the visible drawing of an image
                var maskCenter = polygonCenter(polygon)
                var mk = { text: "", role: item.parityRole, rect: rect(x, y, box.w, box.h), color: null, background: bgAt(maskCenter.x, maskCenter.y), fontSize: null, fontWeight: null }
                if (op < 0.999) mk.opacity = r2(op)
                out.push(mk)
            } else if ((item.navigationFocusable === true || item.a11yName !== undefined) && w > 0 && h > 0) {
                var focusCenter = polygonCenter(polygon)
                var fr = { text: String(item.a11yName !== undefined ? item.a11yName : item.parityLabel || ""), role: item.parityRole || "button", rect: rect(x, y, box.w, box.h),
                    color: null, background: bgAt(focusCenter.x, focusCenter.y), fontSize: null, fontWeight: null, _at: [focusCenter.x, focusCenter.y], _box: polygon }
                if (item.focusRadius) {
                    var frScale = uniformRadiusScale(item, root)
                    if (frScale !== null) fr.radius = r2(Math.min(item.focusRadius, Math.min(w, h) / 2) * frScale / u)
                    else radiusLimitations += 1
                }
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
    if (radiusLimitations) log("LAYOUTWARN|nonuniform-rounded-radius|" + radiusLimitations)
    log("LAYOUTEND|" + r2(root.width / u) + "|" + r2(root.height / u))
}
