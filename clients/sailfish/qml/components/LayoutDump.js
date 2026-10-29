// Parity layout exporter (docs/parity/LAYOUT.md). Walks the item tree under `root` and reports mapped item geometry, each Text item's own
// content box (the app lays out one displayed line per item), item colours and opacity, and sampled backgrounds. Nothing is declared per screen, and names and roles are read from the items' real Accessible.name and Accessible.role (passed in as `access`).
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
// Share of `subject`'s area that lies inside the convex `container`.
function polygonCoverage(container, subject) {
    var area = Math.abs(polygonArea(subject))
    if (area <= GEOMETRY_EPSILON) return 0
    var inside = clipPolygon(subject, container)
    return inside.length ? Math.abs(polygonArea(inside)) / area : 0
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
        if (parent.clip === true || layerMask(parent)) polygon = clipPolygon(polygon, mappedRect(parent, root, 0, 0, parent.width, parent.height))
        if (parent === root) break
    }
    if ((item.clip === true || layerMask(item)) && polygon.length)
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
// A Rectangle that never set a border reports Qt's default pen (read from a fresh Rectangle by dump(), `unsetBorder`) but draws none; any
// other pen is drawn. shortcut: a deliberate pen equal to the default (1 px pure black) reads as none; a source test keeps the QML free of one.
var unsetBorder = null
function drawnBorder(border) {
    if (!(border.width > 0) || border.color.a <= 0) return false
    return !unsetBorder || border.width !== unsetBorder.width || border.color.r !== unsetBorder.color.r || border.color.g !== unsetBorder.color.g
        || border.color.b !== unsetBorder.color.b || border.color.a !== unsetBorder.color.a
}
// Qt's QAccessible::Role values (as the QML Accessible enum) in the web's role vocabulary. A role Qt has no word for stays unset.
var ROLE_NAMES = { 16: "container", 18: "dialog", 20: "group", 30: "link", 40: "img", 41: "text", 42: "textbox", 43: "button", 51: "slider", 1040: "search", 1044: "heading" }
// The mask a composited layer is clipped to (layer.effect: OpacityMask), or null. `layer.effect` is only the Component: the instance Qt creates
// sits next to the item in its parent, and its `source` is the layer's ShaderEffectSource of that item. The layer draws the item and everything in it through the mask.
function layerMask(item) {
    var l = item.layer, siblings = l && l.enabled === true && item.parent ? item.parent.children : []
    for (var i = 0; i < siblings.length; ++i) {
        var c = siblings[i]
        if (c.maskSource && c.source && c.source.sourceItem === item) return c.maskSource
    }
    return null
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
function opaqueStops(stops, op) { for (var i = 0; i < stops.length; ++i) if (stops[i].a * op < 0.5) return false; return stops.length > 0 }
function weightOf(item, weights) {
    var w = weights[String(item.font.family).split(",")[0]]   // a family list: the first is the primary font
    if (w !== undefined) return w
    var f = item.font.weight
    return f >= 75 ? 700 : f >= 63 ? 600 : f <= 25 ? 300 : 400
}

// Text as laid out. The app puts each displayed line in a Text item of its own (FitText) and cuts it with a real ellipsis, so an item's
// content box is the line's glyph run: Qt's contentWidth and contentHeight at the item's alignment. A Text that Qt wrapped or elided
// itself is not exported: the export stops.
function fatal(log, what, item) {
    var msg = "LAYOUTERR|" + what + "|" + String(item.text).slice(0, 40)
    log(msg)
    throw new Error(msg)
}
function textRun(item, log) {
    if (item.lineCount > 1) fatal(log, "text of several lines in one item", item)
    if (item.truncated === true) fatal(log, "text elided by Qt", item)
    var shown = (item.font.capitalization === 1 ? item.text.toUpperCase() : item.text).replace(/\r/g, "")
    if (shown.indexOf("\n") >= 0) fatal(log, "line break inside a line", item)
    var pl = item.leftPadding || 0, pt = item.topPadding || 0
    var availW = item.width - pl - (item.rightPadding || 0), availH = item.height - pt - (item.bottomPadding || 0)
    var ha = item.horizontalAlignment, va = item.verticalAlignment
    var cw = item.contentWidth, ch = item.contentHeight
    return { text: shown.trim().replace(/\s+/g, " "),
        x: ha === 4 ? pl + (availW - cw) / 2 : ha === 2 ? pl + availW - cw : pl,
        y: va === 128 ? pt + (availH - ch) / 2 : va === 64 ? pt + availH - ch : pt, w: cw, h: ch }
}

function dump(root, u, weights, log, access, defaultBorder) {
    unsetBorder = defaultBorder || null
    function roleOf(item, fallback) { var r = ROLE_NAMES[access(item).role]; return r || fallback }
    var fills = [], out = [], radiusLimitations = 0, painters = [], seq = 0
    // Backdrop at a point: the fills painted before `limit` (ancestors and earlier siblings), plus, from `limit` on, only the plates that
    // cover (95 % or more of) `cover` ({x, y, w, h}): the element's own background, drawn as a child rectangle.
    function bgAt(cx, cy, limit, cover) {
        cx = Math.min(cx, root.width - 1); cy = Math.min(cy, root.height - 1)
        var bg = [255, 255, 255], end = limit === undefined ? fills.length : fills.length
        for (var i = 0; i < end; ++i) {
            var f = fills[i]
            if (limit !== undefined && i >= limit && polygonCoverage(f.full, cover) < 0.95) continue
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
    function isWithin(item, ancestor) { for (var n = item; n; n = n.parent) if (n === ancestor) return true; return false }
    // The corner radius (CSS px) of the mask an item's layer is clipped to: the rounding that is drawn, as it is.
    function maskedRadius(item) {
        var m = layerMask(item), sc = m && m.radius > 0 ? uniformRadiusScale(item, root) : null
        if (sc === null) { if (m && m.radius > 0) radiusLimitations += 1; return 0 }
        return radiusOf({ radius: m.radius, width: item.width, height: item.height }, sc)
    }
    // A painted shape that fills a control: the direct child Rectangle (covering 95 % or more of the control) its own background is drawn with.
    function paintedShape(item) {
        var kids = item.children
        for (var i = 0; i < kids.length; ++i) {
            var k = kids[i]
            if (!k.visible || k.border === undefined || k.radius === undefined || k.color === undefined) continue
            if (!(k.color.a > 0 || drawnBorder(k.border)) || k.radius <= 0) continue
            if (polygonCoverage(mappedRect(k, root, 0, 0, k.width, k.height), mappedRect(item, root, 0, 0, item.width, item.height)) < 0.95) continue
            return k
        }
        return null
    }
    // A composited layer that holds a picture (layer.enabled with an Image child, e.g. key art with its tint) is one drawn bitmap: flat tints
    // inside it belong to the picture and are neither elements nor backdrop colours.
    function holdsPicture(item) {
        if (item.layer === undefined || item.layer.enabled !== true || layerMask(item)) return false   // a masked layer clips its children; they stay elements
        var k = item.children
        for (var i = 0; i < k.length; ++i) if (k[i].source !== undefined && k[i].paintedWidth !== undefined) return true
        return false
    }
    function walk(item, opAcc, inPicture) {
        if (!item || !item.visible) return
        var op = opAcc * item.opacity
        if (op <= 0.001) return
        var w = item.width, h = item.height
        // An element counts when some of it is visible after the viewport and the clipping ancestors; its box is the whole transformed border box.
        var polygon = clippedItemPolygon(item, root, 0, 0, w, h)
        var clippedBox = polygonBounds(polygon)
        var box = clippedBox ? polygonBounds(mappedRect(item, root, 0, 0, w, h)) : null
        var kids = item.children
        // Qt paints children in z order, then declaration order; those below zero are painted under the item's own content.
        var order = []
        for (var oi = 0; oi < kids.length; ++oi) order.push(oi)
        order.sort(function (a, b) { return (kids[a].z - kids[b].z) || (a - b) })
        var below = 0
        for (; below < order.length && kids[order[below]].z < 0; ++below) walk(kids[order[below]], op, inPicture || holdsPicture(item))
        var mark = out.length, fmark = fills.length
        if (box) {
            var x = box.x, y = box.y
            if (typeof item.text === "string" && item.contentWidth !== undefined && item.font !== undefined && item.color !== undefined && item.text.length > 0) {
                var textScale = uniformRadiusScale(item, root)
                if (textScale === null) { log("LAYOUTERR|nonuniform text transform|" + item.text.slice(0, 30)); textScale = 1 }
                var runs = [textRun(item, log)]
                var ta = access(item), textRole = ROLE_NAMES[ta.role]
                if (ta.role !== 0 && ta.role !== 41 && textRole && String(ta.name) !== "" && item.readOnly === undefined) {
                    // a Text that exposes a role of its own (a control or container) is that one element: its box, its accessible name, its text style
                    var oc = polygonCenter(polygon)
                    var one = { text: String(ta.name), role: textRole, rect: rect(x, y, box.w, box.h), color: hex(item.color), background: bgAt(oc.x, oc.y),
                        fontSize: r2(item.font.pixelSize * textScale / u), fontWeight: weightOf(item, weights) }
                    if (op < 0.999) one.opacity = r2(op)
                    one._item = item; one._seq = ++seq; one._r = polygonBounds(polygon)
                    if (item.color.a > 0.001) out.push(one)
                    runs = []
                }
                if (item.readOnly !== undefined && item.positionAt && item.positionToRectangle) {
                    // the characters between the input's padded edges, from Qt's own positions
                    var s0 = item.positionAt(item.leftPadding || 0), s1 = item.positionAt(item.width - (item.rightPadding || 0))
                    var r0 = item.positionToRectangle(s0), r1 = item.positionToRectangle(s1)
                    runs = [{ text: item.text.slice(s0, s1), x: r0.x, y: r0.y, w: r1.x - r0.x, h: r0.height }]
                }
                if (item.readOnly !== undefined) {   // a real text input: TextInput or TextField
                    // a real (read-only) text input: its own box is the control, its text is drawn inside
                    var inCentre = polygonCenter(polygon)
                    var inp = { text: String(access(item).name), role: roleOf(item, "textbox"), rect: rect(x, y, box.w, box.h), color: null, background: bgAt(inCentre.x, inCentre.y), fontSize: null, fontWeight: null, _at: [inCentre.x, inCentre.y], _box: mappedRect(item, root, 0, 0, w, h) }
                    var inShape = paintedShape(item)
                    if (inShape) { var inScale = uniformRadiusScale(inShape, root), inRadius = radiusOf(inShape, inScale); if (inRadius) inp.radius = inRadius }
                    inp._item = item; inp._seq = ++seq; inp._r = { x: clippedBox.x, y: clippedBox.y, w: clippedBox.w, h: clippedBox.h }
                    out.push(inp)
                }
                for (var li = 0; li < runs.length && item.color.a > 0.001; ++li) {   // text drawn fully transparent is not there
                    var run = runs[li]
                    var textPoly = clippedItemPolygon(item, root, run.x, run.y, run.w, run.h)
                    if (!textPoly.length || run.text === "") continue
                    var textBox = polygonBounds(mappedRect(item, root, run.x, run.y, run.w, run.h))
                    var textSample = polygonCenter(textPoly)
                    var el = { text: run.text, role: item.readOnly !== undefined ? "text" : roleOf(item, "text"), rect: rect(textBox.x, textBox.y, textBox.w, textBox.h),
                        color: hex(item.color), background: bgAt(textSample.x, textSample.y), fontSize: r2(item.font.pixelSize * textScale / u), fontWeight: weightOf(item, weights) }
                    if (op < 0.999) el.opacity = r2(op)
                    el._item = item; el._seq = ++seq; el._r = polygonBounds(textPoly)
                    out.push(el)
                }
            } else if (item.border !== undefined && item.radius !== undefined && item.color !== undefined && w > 0 && h > 0) {
                var stops = item.gradient ? gradientStops(item.gradient) : null
                var filled = item.color.a > 0 && !item.gradient
                var mySeq = ++seq
                var pic = inPicture && !stops
                if (filled && !pic) fills.push({ polygon: polygon, full: mappedRect(item, root, 0, 0, w, h), c: [item.color.r * 255, item.color.g * 255, item.color.b * 255], a: item.color.a * op })
                if (filled && !pic && !stops && item.color.a * op >= 0.5) painters.push({ poly: polygon, seq: mySeq, item: item })
                else if (stops) {   // a gradient is a visible fill, but like the web's background-image it is not a backdrop colour
                    filled = true
                    if (opaqueStops(stops, op)) painters.push({ poly: polygon, seq: mySeq, item: item })
                }
                var bordered = drawnBorder(item.border)
                var center = polygonCenter(polygon)
                if ((filled || bordered) && !pic) {
                    var rc = { text: "", role: roleOf(item, "container"), rect: rect(x, y, box.w, box.h), color: null, background: bgAt(center.x, center.y), fontSize: null, fontWeight: null, }
                    var rectangleRadiusScale = uniformRadiusScale(item, root)
                    var rr = radiusOf(item, rectangleRadiusScale)
                    if (item.radius > 0 && rectangleRadiusScale === null) radiusLimitations += 1
                    if (rr) rc.radius = rr
                    if (op < 0.999) rc.opacity = r2(op)
                    rc._item = item; rc._seq = mySeq; rc._r = { x: clippedBox.x, y: clippedBox.y, w: clippedBox.w, h: clippedBox.h }
                    out.push(rc)
                }
            } else if (item.gradient !== undefined && ((item.start !== undefined && item.end !== undefined) || item.horizontalRadius !== undefined) && w > 0 && h > 0 && gradientStops(item.gradient)) {
                // a QtGraphicalEffects LinearGradient (the horizontal gradients a Rectangle cannot draw) or RadialGradient: a visible fill, like the web's background-image
                var lgCenter = polygonCenter(polygon)
                var lg = { text: "", role: roleOf(item, "container"), rect: rect(x, y, box.w, box.h), color: null, background: bgAt(lgCenter.x, lgCenter.y), fontSize: null, fontWeight: null }
                var lgRadius = maskedRadius(item)
                if (lgRadius) lg.radius = lgRadius
                if (op < 0.999) lg.opacity = r2(op)
                lg._item = item; lg._seq = ++seq; if (opaqueStops(gradientStops(item.gradient), op)) painters.push({ poly: polygon, seq: lg._seq, item: item }); lg._r = { x: clippedBox.x, y: clippedBox.y, w: clippedBox.w, h: clippedBox.h }
                out.push(lg)
            } else if (item.source !== undefined && item.status !== undefined && item.paintedWidth !== undefined && w > 0 && h > 0 && item.status === 1) {
                var imgSeq = ++seq
                // only a picture that covers its whole box (cover fill mode) hides what is under it; a stretched PNG may be transparent
                if (op >= 0.5 && item.fillMode === 2) painters.push({ poly: polygon, seq: imgSeq, item: item })
                var imageCenter = polygonCenter(polygon)
                var im = { text: "", role: roleOf(item, "image"), rect: rect(x, y, box.w, box.h), color: null, background: bgAt(imageCenter.x, imageCenter.y), fontSize: null, fontWeight: null }
                var imRadius = maskedRadius(item)
                if (imRadius) im.radius = imRadius
                if (op < 0.999) im.opacity = r2(op)
                im._item = item; im._seq = imgSeq; im._r = { x: clippedBox.x, y: clippedBox.y, w: clippedBox.w, h: clippedBox.h }
                out.push(im)
            } else if (item.source !== undefined && item.status !== undefined && item.paintedWidth !== undefined && w > 0 && h > 0) {
                // a picture that is not drawn (loading, failed or without a source) is not exported; say so
                log("LAYOUTWARN|image-not-drawn|status " + item.status + "|" + (String(item.source) === "" ? "no source" : "source set") + "|" + r2(w / u) + "x" + r2(h / u))
            } else if (item.contentRect !== undefined && item.orientation !== undefined && w > 0 && h > 0) {
                // VideoOutput: the video surface (what plays in it is not an element)
                var videoCenter = polygonCenter(polygon)
                var vo = { text: "", role: "video", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(videoCenter.x, videoCenter.y), fontSize: null, fontWeight: null }
                if (op < 0.999) vo.opacity = r2(op)
                vo._item = item; vo._seq = ++seq; vo._r = { x: clippedBox.x, y: clippedBox.y, w: clippedBox.w, h: clippedBox.h }
                out.push(vo)
            } else if (item.available === true && item.renderTarget !== undefined && w > 0 && h > 0) {
                // Canvas: a drawn icon (only one that exists to paint)
                var canvasCenter = polygonCenter(polygon)
                var cv = { text: "", role: roleOf(item, "image"), rect: rect(x, y, box.w, box.h), color: null, background: bgAt(canvasCenter.x, canvasCenter.y), fontSize: null, fontWeight: null }
                var cvRadius = maskedRadius(item)
                if (cvRadius) cv.radius = cvRadius
                if (op < 0.999) cv.opacity = r2(op)
                cv._item = item; cv._seq = ++seq; cv._r = { x: clippedBox.x, y: clippedBox.y, w: clippedBox.w, h: clippedBox.h }
                out.push(cv)
            } else if ((access(item).name !== "" || access(item).role !== 0) && w > 0 && h > 0) {
                var focusCenter = polygonCenter(polygon)
                var fr = { text: String(access(item).name), role: roleOf(item, "button"), rect: rect(x, y, box.w, box.h),
                    color: null, background: bgAt(focusCenter.x, focusCenter.y), fontSize: null, fontWeight: null, _at: [focusCenter.x, focusCenter.y], _box: mappedRect(item, root, 0, 0, w, h) }
                var shape = paintedShape(item)
                if (shape) {
                    var frScale = uniformRadiusScale(shape, root), frRadius = radiusOf(shape, frScale)
                    if (frRadius) fr.radius = frRadius
                    else if (frScale === null) radiusLimitations += 1
                }
                if (op < 0.999) fr.opacity = r2(op)
                fr._item = item; fr._seq = ++seq; fr._r = { x: clippedBox.x, y: clippedBox.y, w: clippedBox.w, h: clippedBox.h }
                out.push(fr)
            }
        }
        for (var i = below; i < order.length; ++i) walk(kids[order[i]], op, inPicture || holdsPicture(item))
        // an element's background includes its own fill and its children's: settle it once the subtree has been painted
        // development aid: the QML type of each element (the suite driver drops it unless asked to keep it)
        for (var k = mark; k < out.length; ++k) if (out[k]._src === undefined) out[k]._src = String(item).replace(/\(0x.*$/, "")
        for (var j = mark; j < out.length; ++j) if (out[j]._at) { out[j].background = bgAt(out[j]._at[0], out[j]._at[1], fmark, out[j]._box); delete out[j]._at; delete out[j]._box }
    }
    walk(root, 1, false)
    // Elements covered by something painted later (opaque enough, not inside the element) are not visible: sample the visible box at 3 x 3 points.
    var kept = []
    for (var e = 0; e < out.length; ++e) {
        var el2 = out[e], r = el2._r, hidden = !!r, cover = null
        for (var gy = 0; hidden && gy < 3; ++gy) for (var gx = 0; hidden && gx < 3; ++gx) {
            var pt = { x: r.x + r.w * (0.2 + 0.3 * gx), y: r.y + r.h * (0.2 + 0.3 * gy) }, hit = false
            for (var pi2 = 0; !hit && pi2 < painters.length; ++pi2) {
                var pn = painters[pi2]
                if (pn.seq > el2._seq && !isWithin(pn.item, el2._item) && polygonContainsPoint(pn.poly, pt)) { hit = true; cover = pn }
            }
            if (!hit) hidden = false
        }
        if (!hidden) kept.push(el2)
        else log("LAYOUTWARN|occluded|" + el2.role + "|" + el2.text.slice(0, 24) + "|" + r2(r.x / u) + "," + r2(r.y / u) + " " + r2(r.w / u) + "x" + r2(r.h / u) + "|by " + String(cover.item).replace(/\(0x.*$/, "") + " " + r2(cover.poly[0].x / u) + "," + r2(cover.poly[0].y / u))
    }
    out = kept
    for (var q = 0; q < out.length; ++q) { delete out[q]._item; delete out[q]._seq; delete out[q]._r }
    // journald rate-limits per message, so the elements go out in chunks.
    for (var c = 0; c < out.length; c += 10) log("LAYOUTEL|" + JSON.stringify(out.slice(c, c + 10)))
    if (radiusLimitations) log("LAYOUTWARN|nonuniform-rounded-radius|" + radiusLimitations)
    log("LAYOUTEND|" + r2(root.width / u) + "|" + r2(root.height / u))
}
