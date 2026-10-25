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
// A Rectangle that never set a border still reports width 1 and a black colour in Qt 5.6, but draws none. shortcut: a deliberate 1 px pure
// black border reads as no border; the app has none, revisit if it gains one.
function drawnBorder(border) {
    if (!(border.width > 0) || border.color.a <= 0) return false
    return border.width !== 1 || border.color.r !== 0 || border.color.g !== 0 || border.color.b !== 0
}
// A vertical gradient (the only kind Qt 5.6 draws) as stops; null when none of its stops is visible. Colours interpolate premultiplied, as Qt does.
function gradientStops(gradient) {
    var list = gradient && gradient.stops, stops = [], visible = false
    for (var i = 0; list && i < list.length; ++i) {
        var c = list[i].color
        stops.push({ p: list[i].position, r: c.r, g: c.g, b: c.b, a: c.a })
        if (c.a > 0) visible = true
    }
    return visible ? stops : null
}
function weightOf(item, weights) {
    var w = weights[item.font.family]
    if (w !== undefined) return w
    var f = item.font.weight
    return f >= 75 ? 700 : f >= 63 ? 600 : f <= 25 ? 300 : 400
}

// Text as laid out: one run per rendered line, in item coordinates. Qt 5.6 reports each line's box through Text.lineLaidOut (kept by PLabel
// and PText in `laidLines`) but not its characters, so the characters of a wrapped line are found by fitting the words into the width Qt gave
// that line, and the result is checked against Qt's own line count and widest line.
function textElideMode(e) { return e === 1 ? 0 : e === 3 ? 1 : 2 }
function breakParagraph(para, widthOf, advance, wrapMode, startLine, room) {
    var tokens = para.match(/\S+\s*/g) || [""], lines = [], cur = ""
    function fits(s) { return advance(s.replace(/\s+$/, "")) <= widthOf(startLine + lines.length) + 0.01 }
    for (var i = 0; i < tokens.length; ++i) {
        var token = tokens[i]
        if (cur === "" || fits(cur + token)) { cur += token; continue }
        lines.push(cur); cur = token
        if (room !== undefined && lines.length >= room) break
    }
    if (room === undefined || lines.length < room) lines.push(cur)
    else {
        // the room ran out: the rest of the paragraph is what an elided last line stands for
        lines.rest = tokens.slice(i).join("")
    }
    return lines
}
function lineRuns(item, metrics, log) {
    var shown = item.font.capitalization === 1 ? item.text.toUpperCase() : item.text
    shown = shown.replace(/\r/g, "")
    var m = metrics(item.font), rec = item.laidLines, count = Math.max(1, item.lineCount || 1)
    var ha = item.horizontalAlignment, avail = item.width - (item.leftPadding || 0) - (item.rightPadding || 0)
    var wrap = item.wrapMode !== undefined && item.wrapMode !== 0
    var recorded = rec && rec.length === count
    function widthOf(i) { return recorded ? rec[Math.min(i, rec.length - 1)].w : avail }
    var texts = []
    if (!wrap || count === 1) {
        var paras = wrap ? [shown] : shown.split("\n")
        for (var pi = 0; pi < paras.length; ++pi) texts.push(paras[pi])
        if (!wrap && texts.length !== count) { log("LAYOUTWARN|line-count|" + texts.length + "|" + count); texts = [shown] }
    } else {
        var split = shown.split("\n")
        for (var si = 0; si < split.length; ++si) {
            var left = count - texts.length
            if (left <= 0) break
            var got = breakParagraph(split[si], widthOf, m.advance, item.wrapMode, texts.length, si === split.length - 1 ? left : undefined)
            for (var gi = 0; gi < got.length; ++gi) texts.push(got[gi])
            if (got.rest !== undefined && got.rest !== "") { if (item.elide) texts[texts.length - 1] += got.rest; break }
        }
    }
    if (texts.length !== count) log("LAYOUTWARN|wrapped-lines|" + texts.length + "|" + count + "|" + shown.slice(0, 40))
    var out = [], base0 = item.baselineOffset
    for (var i = 0; i < texts.length; ++i) {
        var t = texts[i].replace(/\s+$/, "").replace(/^\s+/, "")
        var last = i === texts.length - 1
        var room = widthOf(i)
        if (item.elide !== undefined && item.elide !== 0 && last && m.advance(t) > room + 0.01) t = m.elide(t, textElideMode(item.elide), room)
        var wdt = m.advance(t)
        var lx = recorded ? rec[i].x : (item.leftPadding || 0)
        var x = ha === 4 ? lx + (room - wdt) / 2 : ha === 2 ? lx + room - wdt : lx
        // Qt places a line's glyphs at its recorded y (already shifted by a proportional line height) plus the ascent, below the top padding.
        var baseline = recorded ? (item.topPadding || 0) + rec[i].y + m.ascent : base0
        out.push({ text: t.replace(/\s+/g, " "), x: x, y: baseline - m.ascent, w: wdt, h: m.ascent + m.descent, asc: m.ascent })
    }
    return out
}

// metrics(font) -> { ascent, descent, advance(text), elide(text, mode, width) } in device pixels, from Qt's FontMetrics.
function dump(root, u, weights, metrics, log) {
    var fills = [], out = [], radiusLimitations = 0
    // Backdrop at a point: the fills painted before `limit` (ancestors and earlier siblings), plus, from `limit` on, only the plates that
    // cover the whole of `cover` ({x, y, w, h}): the element's own background, drawn as a child rectangle.
    function bgAt(cx, cy, limit, cover) {
        cx = Math.min(cx, root.width - 1); cy = Math.min(cy, root.height - 1)
        var bg = [255, 255, 255], end = limit === undefined ? fills.length : fills.length
        for (var i = 0; i < end; ++i) {
            var f = fills[i]
            if (limit !== undefined && i >= limit && !polygonContainsPolygon(f.full, cover)) continue
            if (!polygonContainsPoint(f.polygon, { x: cx, y: cy })) continue
            var fc = { c: f.c, a: f.a }, fa = fc.a
            for (var k = 0; k < 3; ++k) bg[k] = bg[k] * (1 - fa) + fc.c[k] * fa
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
    // `shown` is set for the offscreen source of an effect: it is not visible itself, but the effect draws it.
    function walk(item, opAcc, shown) {
        if (!item || (!item.visible && shown !== true) || item.layoutSkipTree === true) return
        var op = opAcc * item.opacity
        if (op <= 0.001) return
        var w = item.width, h = item.height
        // An element counts when some of it is visible after the viewport and the clipping ancestors; its box is the whole transformed border box.
        var polygon = clippedItemPolygon(item, root, 0, 0, w, h), clippedBox = polygonBounds(polygon)
        var box = clippedBox ? polygonBounds(mappedRect(item, root, 0, 0, w, h)) : null
        var mark = out.length, fmark = fills.length
        if (box && item.layoutSkip !== true) {
            var x = box.x, y = box.y
            if (typeof item.text === "string" && item.contentWidth !== undefined && item.font !== undefined && item.color !== undefined && item.text.length > 0) {
                var textRadiusScale = item.focusRadius ? uniformRadiusScale(item, root) : null
                var runs = lineRuns(item, metrics, log)
                for (var li = 0; li < runs.length; ++li) {
                    var run = runs[li]
                    var textPoly = clippedItemPolygon(item, root, run.x, run.y, run.w, run.h)
                    if (!textPoly.length || run.text === "") continue
                    var textBox = polygonBounds(mappedRect(item, root, run.x, run.y, run.w, run.h))
                    var textSample = polygonCenter(textPoly)
                    var el = { text: run.text, role: item.parityRole || "text", rect: rect(textBox.x, textBox.y, textBox.w, textBox.h),
                        color: hex(item.color), background: bgAt(textSample.x, textSample.y), fontSize: r2(item.font.pixelSize / u), fontWeight: weightOf(item, weights) }
                    if (item.radiusSource) {
                        // the corner radius the element's own background rectangle draws
                        var sourceScale = uniformRadiusScale(item.radiusSource, root)
                        var sourceRadius = radiusOf(item.radiusSource, sourceScale)
                        if (sourceRadius) el.radius = sourceRadius
                        else if (sourceScale === null) radiusLimitations += 1
                    } else if (item.focusRadius) {
                        if (textRadiusScale !== null) el.radius = r2(Math.min(item.focusRadius, Math.min(w, h) / 2) * textRadiusScale / u)
                        else radiusLimitations += 1
                    }
                    if (op < 0.999) el.opacity = r2(op)
                    el._dbg = { bo: item.baselineOffset, ll: item.laidLines, lh: item.lineHeight, lhm: item.lineHeightMode, tp: item.topPadding, h: item.height, ch: item.contentHeight, asc: run.asc }
                    out.push(el)
                }
            } else if (item.border !== undefined && item.radius !== undefined && item.color !== undefined && w > 0 && h > 0) {
                var stops = item.gradient ? gradientStops(item.gradient) : null
                var filled = item.color.a > 0 && !item.gradient
                if (filled) fills.push({ polygon: polygon, full: mappedRect(item, root, 0, 0, w, h), c: [item.color.r * 255, item.color.g * 255, item.color.b * 255], a: item.color.a * op })
                else if (stops) filled = true   // a gradient is a visible fill, but like the web's background-image it is not a backdrop colour
                var bordered = drawnBorder(item.border)
                if ((filled || bordered) && item.layoutNoEmit !== true) {
                    var center = polygonCenter(polygon)
                    var rc = { text: "", role: item.parityRole || "container", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(center.x, center.y), fontSize: null, fontWeight: null, _at: [center.x, center.y], _box: mappedRect(item, root, 0, 0, w, h) }
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
            } else if ((item.navigationFocusable === true || item.a11yName !== undefined) && item.layoutNoEmit !== true && w > 0 && h > 0) {
                var focusCenter = polygonCenter(polygon)
                var fr = { text: String(item.a11yName !== undefined ? item.a11yName : item.parityLabel || ""), role: item.parityRole || "button", rect: rect(x, y, box.w, box.h),
                    color: null, background: bgAt(focusCenter.x, focusCenter.y), fontSize: null, fontWeight: null, _at: [focusCenter.x, focusCenter.y], _box: mappedRect(item, root, 0, 0, w, h) }
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
        // Qt paints children in z order, then declaration order.
        var order = []
        for (var oi = 0; oi < kids.length; ++oi) order.push(oi)
        order.sort(function (a, b) { return (kids[a].z - kids[b].z) || (a - b) })
        for (var i = 0; i < order.length; ++i) walk(kids[order[i]], op, shown)
        if (item.maskSource !== undefined && item.source && item.source.children !== undefined) walk(item.source, op, true)
        // an element's background includes its own fill and its children's: settle it once the subtree has been painted
        // development aid: the QML type of each element (the suite driver drops it unless asked to keep it)
        for (var k = mark; k < out.length; ++k) if (out[k]._src === undefined) out[k]._src = String(item).replace(/\(0x.*$/, "")
        for (var j = mark; j < out.length; ++j) if (out[j]._at) { out[j].background = bgAt(out[j]._at[0], out[j]._at[1], fmark, out[j]._box); delete out[j]._at; delete out[j]._box }
    }
    walk(root, 1)
    // journald rate-limits per message, so the elements go out in chunks.
    for (var c = 0; c < out.length; c += 10) log("LAYOUTEL|" + JSON.stringify(out.slice(c, c + 10)))
    if (radiusLimitations) log("LAYOUTWARN|nonuniform-rounded-radius|" + radiusLimitations)
    log("LAYOUTEND|" + r2(root.width / u) + "|" + r2(root.height / u))
}
