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
    var w = weights[String(item.font.family).split(",")[0]]   // a family list: the first is the primary font
    if (w !== undefined) return w
    var f = item.font.weight
    return f >= 75 ? 700 : f >= 63 ? 600 : f <= 25 ? 300 : 400
}

// Text as laid out: one run per rendered line, in item coordinates. Qt 5.6 reports each line's box through Text.lineLaidOut (kept by PLabel
// and PText in `laidLines`) but not its characters, so the characters of a wrapped line are found by fitting the words into the width Qt gave
// that line, and the result is checked against Qt's own line count and widest line.
// Text.ElideLeft 0, ElideRight 1, ElideMiddle 2 and ElideNone 3 match Qt::TextElideMode, with None added.
function textElideMode(e) { return e }
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
    var elides = item.elide !== undefined && item.elide !== 3
    function fail(what) { log("LAYOUTERR|" + what + "|" + shown.slice(0, 40)) }
    // Qt reports the width a wrapping line may use; an unwrapped line has no limit of its own (its width is the item's).
    function widthOf(i) { return recorded && wrap ? rec[Math.min(i, rec.length - 1)].w : avail }
    if (wrap && count > 1 && !recorded) fail("wrapped text without recorded line boxes")
    var texts = []
    if (!wrap || count === 1) {
        var paras = wrap ? [shown] : shown.split("\n")
        for (var pi = 0; pi < paras.length; ++pi) texts.push(paras[pi])
        if (!wrap && texts.length !== count) { fail("line count " + texts.length + " of " + count); texts = [shown] }
    } else {
        var split = shown.split("\n")
        for (var si = 0; si < split.length; ++si) {
            var left = count - texts.length
            if (left <= 0) break
            var got = breakParagraph(split[si], widthOf, m.advance, item.wrapMode, texts.length, si === split.length - 1 ? left : undefined)
            for (var gi = 0; gi < got.length; ++gi) texts.push(got[gi])
            if (got.rest !== undefined && got.rest !== "") { if (elides) texts[texts.length - 1] += got.rest; break }
        }
    }
    if (texts.length !== count) fail("wrapped lines " + texts.length + " of " + count)
    var out = [], base0 = item.baselineOffset, widest = 0
    for (var i = 0; i < texts.length; ++i) {
        var t = texts[i].replace(/\s+$/, "").replace(/^\s+/, "")
        var last = i === texts.length - 1
        var room = widthOf(i)
        // The last line is exported as drawn: when Qt cut it (item.truncated), the visible text with Qt's own elision.
        if (elides && last && item.truncated === true) t = m.elide(t, textElideMode(item.elide), room)
        // One line: Qt's own content width. Several: each line's advance (checked against the content width below).
        var wdt = texts.length === 1 ? item.contentWidth : m.advance(t)
        widest = Math.max(widest, wdt)
        var lx = recorded ? rec[i].x : (item.leftPadding || 0)
        var x = ha === 4 ? lx + (room - wdt) / 2 : ha === 2 ? lx + room - wdt : lx
        // Qt places a line's glyphs at its recorded y (already shifted by a proportional line height) plus the ascent, below the top padding.
        var baseline = recorded ? (item.topPadding || 0) + rec[i].y + (m.qtAscent !== undefined ? m.qtAscent : m.ascent) : base0
        out.push({ text: t.replace(/\s+/g, " "), x: x, y: baseline - m.ascent, w: wdt, h: m.ascent + m.descent })
    }
    if (texts.length > 1 && Math.abs(widest - item.contentWidth) > 1.5) fail("widest line " + widest + " against content width " + item.contentWidth)
    return out
}

// metrics(font) -> { ascent, descent, advance(text), elide(text, mode, width) } in device pixels, from Qt's FontMetrics.
function dump(root, u, weights, metrics, log) {
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
    // `shown` is set for the offscreen source of an effect: Qt reports every item inside it as invisible (visibility is inherited), but the effect
    // draws it. A part of it that should not be drawn must say so by opacity (see Artwork's fallback title).
    function isWithin(item, ancestor) { for (var n = item; n; n = n.parent) if (n === ancestor) return true; return false }
    // A painted shape that fills a control: the direct child Rectangle the control's own background is drawn with.
    function paintedShape(item) {
        var kids = item.children
        for (var i = 0; i < kids.length; ++i) {
            var k = kids[i]
            if (!k.visible || k.border === undefined || k.radius === undefined || k.color === undefined || k.layoutSkip === true) continue
            if (!(k.color.a > 0 || drawnBorder(k.border)) || k.radius <= 0) continue
            if (polygonCoverage(mappedRect(item, root, 0, 0, item.width, item.height), mappedRect(k, root, 0, 0, k.width, k.height)) < 0.95) continue
            return k
        }
        return null
    }
    // A composited layer that holds a picture (layer.enabled with an Image child, e.g. key art with its tint) is one drawn bitmap: flat tints
    // inside it belong to the picture and are neither elements nor backdrop colours.
    function holdsPicture(item) {
        if (item.layer === undefined || item.layer.enabled !== true) return false
        var k = item.children
        for (var i = 0; i < k.length; ++i) if (k[i].source !== undefined && k[i].paintedWidth !== undefined) return true
        return false
    }
    function walk(item, opAcc, shown, inMask, inPicture) {   // inMask: the item that draws the effect this subtree is the source of
        var painter = inMask || item
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
                var textScale = uniformRadiusScale(item, root)
                if (textScale === null) { log("LAYOUTERR|nonuniform text transform|" + item.text.slice(0, 30)); textScale = 1 }
                var runs = lineRuns(item, metrics, log)
                if (!runs.length) log("LAYOUTERR|text without runs|" + item.text.slice(0, 30))
                if (item.a11yName !== undefined && item.readOnly !== undefined) {
                    // a real (read-only) text input: its own box is the control, its text is drawn inside
                    var inCentre = polygonCenter(polygon)
                    var inp = { text: String(item.a11yName), role: item.parityRole || "textbox", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(inCentre.x, inCentre.y), fontSize: null, fontWeight: null, _at: [inCentre.x, inCentre.y], _box: mappedRect(item, root, 0, 0, w, h) }
                    inp._item = item; inp._seq = ++seq; inp._r = { x: box.x, y: box.y, w: box.w, h: box.h }
                    out.push(inp)
                }
                for (var li = 0; li < runs.length; ++li) {
                    var run = runs[li]
                    var textPoly = clippedItemPolygon(item, root, run.x, run.y, run.w, run.h)
                    if (!textPoly.length || run.text === "") continue
                    var textBox = polygonBounds(mappedRect(item, root, run.x, run.y, run.w, run.h))
                    var textSample = polygonCenter(textPoly)
                    var el = { text: run.text, role: item.parityRole || "text", rect: rect(textBox.x, textBox.y, textBox.w, textBox.h),
                        color: hex(item.color), background: bgAt(textSample.x, textSample.y), fontSize: r2(item.font.pixelSize * textScale / u), fontWeight: weightOf(item, weights) }
                    // A text that is the only content of a rounded plate (a chip or badge) is that plate's label: it carries the plate's corner radius.
                    var plate = item.parent && item.parent.border !== undefined && item.parent.radius > 0 && item.parent.color !== undefined ? item.parent : null
                    if (plate && (plate.color.a > 0 || drawnBorder(plate.border)) && plate.children.length === 1) {
                        var plateScale = uniformRadiusScale(plate, root), plateRadius = radiusOf(plate, plateScale)
                        if (plateRadius) el.radius = plateRadius
                    }
                    if (op < 0.999) el.opacity = r2(op)
                    el._item = item; el._seq = ++seq; el._r = { x: textBox.x, y: textBox.y, w: textBox.w, h: textBox.h }
                    out.push(el)
                }
            } else if (item.border !== undefined && item.radius !== undefined && item.color !== undefined && w > 0 && h > 0) {
                var stops = item.gradient ? gradientStops(item.gradient) : null
                var filled = item.color.a > 0 && !item.gradient
                var mySeq = ++seq
                var pic = inPicture && !stops
                if (filled && !pic) fills.push({ polygon: polygon, full: mappedRect(item, root, 0, 0, w, h), c: [item.color.r * 255, item.color.g * 255, item.color.b * 255], a: item.color.a * op })
                if (filled && !pic && !stops && item.color.a * op >= 0.5) painters.push({ poly: polygon, seq: mySeq, item: painter })
                else if (stops) filled = true   // a gradient is a visible fill, but like the web's background-image it is not a backdrop colour
                var bordered = drawnBorder(item.border)
                if ((filled || bordered) && !pic && item.layoutNoEmit !== true) {
                    var center = polygonCenter(polygon)
                    var rc = { text: "", role: item.parityRole || "container", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(center.x, center.y), fontSize: null, fontWeight: null, }
                    var rectangleRadiusScale = uniformRadiusScale(item, root)
                    var rr = radiusOf(item, rectangleRadiusScale)
                    if (item.radius > 0 && rectangleRadiusScale === null) radiusLimitations += 1
                    if (rr) rc.radius = rr
                    if (op < 0.999) rc.opacity = r2(op)
                    rc._item = item; rc._seq = mySeq; rc._r = { x: box.x, y: box.y, w: box.w, h: box.h }
                    out.push(rc)
                }
            } else if (item.source !== undefined && item.status !== undefined && item.paintedWidth !== undefined && w > 0 && h > 0 && item.status === 1) {
                var imgSeq = ++seq
                // only a picture that covers its whole box (cover fill mode) hides what is under it; a stretched PNG may be transparent
                if (op >= 0.5 && item.fillMode === 2) painters.push({ poly: polygon, seq: imgSeq, item: painter })
                if (!inMask) {   // the mask item already stands for this picture
                var imageCenter = polygonCenter(polygon)
                var im = { text: "", role: item.parityRole || "image", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(imageCenter.x, imageCenter.y), fontSize: null, fontWeight: null }
                if (op < 0.999) im.opacity = r2(op)
                im._item = item; im._seq = imgSeq; im._r = { x: box.x, y: box.y, w: box.w, h: box.h }
                out.push(im)
                }
            } else if (item.source !== undefined && item.status !== undefined && item.paintedWidth !== undefined && w > 0 && h > 0) {
                // a picture that is not drawn (loading, failed or without a source) is not exported; say so
                log("LAYOUTWARN|image-not-drawn|status " + item.status + "|" + (String(item.source) === "" ? "no source" : "source set") + "|" + r2(w / u) + "x" + r2(h / u))
            } else if (item.available !== undefined && item.renderTarget !== undefined && w > 0 && h > 0) {
                // Canvas: a drawn icon
                var canvasCenter = polygonCenter(polygon)
                var cv = { text: "", role: item.parityRole || "image", rect: rect(x, y, box.w, box.h), color: null, background: bgAt(canvasCenter.x, canvasCenter.y), fontSize: null, fontWeight: null }
                if (op < 0.999) cv.opacity = r2(op)
                cv._item = item; cv._seq = ++seq; cv._r = { x: box.x, y: box.y, w: box.w, h: box.h }
                out.push(cv)
            } else if (item.maskSource !== undefined && item.parityRole && w > 0 && h > 0) {
                // a masked picture (rounded artwork): the visible drawing of an image
                var maskCenter = polygonCenter(polygon)
                var mk = { text: "", role: item.parityRole, rect: rect(x, y, box.w, box.h), color: null, background: bgAt(maskCenter.x, maskCenter.y), fontSize: null, fontWeight: null }
                if (item.radiusSource) {
                    var maskScale = uniformRadiusScale(item.radiusSource, root), maskRadius = radiusOf(item.radiusSource, maskScale)
                    if (maskRadius) mk.radius = maskRadius
                    else if (maskScale === null) radiusLimitations += 1
                }
                if (op < 0.999) mk.opacity = r2(op)
                mk._item = item; mk._seq = ++seq; mk._r = { x: box.x, y: box.y, w: box.w, h: box.h }
                if (op >= 0.5) painters.push({ poly: polygon, seq: mk._seq, item: item })
                out.push(mk)
            } else if ((item.navigationFocusable === true || item.a11yName !== undefined) && item.layoutNoEmit !== true && w > 0 && h > 0) {
                var focusCenter = polygonCenter(polygon)
                var fr = { text: String(item.a11yName !== undefined ? item.a11yName : item.parityLabel || ""), role: item.parityRole || "button", rect: rect(x, y, box.w, box.h),
                    color: null, background: bgAt(focusCenter.x, focusCenter.y), fontSize: null, fontWeight: null, _at: [focusCenter.x, focusCenter.y], _box: mappedRect(item, root, 0, 0, w, h) }
                var shape = paintedShape(item)
                if (shape) {
                    var frScale = uniformRadiusScale(shape, root), frRadius = radiusOf(shape, frScale)
                    if (frRadius) fr.radius = frRadius
                    else if (frScale === null) radiusLimitations += 1
                }
                if (op < 0.999) fr.opacity = r2(op)
                fr._item = item; fr._seq = ++seq; fr._r = { x: box.x, y: box.y, w: box.w, h: box.h }
                out.push(fr)
            }
        }
        var kids = item.children
        // Qt paints children in z order, then declaration order.
        var order = []
        for (var oi = 0; oi < kids.length; ++oi) order.push(oi)
        order.sort(function (a, b) { return (kids[a].z - kids[b].z) || (a - b) })
        for (var i = 0; i < order.length; ++i) walk(kids[order[i]], op, shown, inMask, inPicture || holdsPicture(item))
        if (item.maskSource !== undefined && item.source && item.source.children !== undefined) walk(item.source, op, true, item, inPicture)
        // an element's background includes its own fill and its children's: settle it once the subtree has been painted
        // development aid: the QML type of each element (the suite driver drops it unless asked to keep it)
        for (var k = mark; k < out.length; ++k) if (out[k]._src === undefined) out[k]._src = String(item).replace(/\(0x.*$/, "")
        for (var j = mark; j < out.length; ++j) if (out[j]._at) { out[j].background = bgAt(out[j]._at[0], out[j]._at[1], fmark, out[j]._box); delete out[j]._at; delete out[j]._box }
    }
    walk(root, 1, false, false, false)
    // Elements covered by something painted later (opaque enough, not inside the element) are not visible: sample the visible box at 3 x 3 points.
    var kept = []
    for (var e = 0; e < out.length; ++e) {
        var el2 = out[e], r = el2._r, hidden = !!r
        for (var gy = 0; hidden && gy < 3; ++gy) for (var gx = 0; hidden && gx < 3; ++gx) {
            var pt = { x: r.x + r.w * (0.2 + 0.3 * gx), y: r.y + r.h * (0.2 + 0.3 * gy) }, hit = false
            for (var pi2 = 0; !hit && pi2 < painters.length; ++pi2) {
                var pn = painters[pi2]
                if (pn.seq > el2._seq && !isWithin(pn.item, el2._item) && polygonContainsPoint(pn.poly, pt)) hit = true
            }
            if (!hit) hidden = false
        }
        if (!hidden) kept.push(el2)
        else log("LAYOUTWARN|occluded|" + el2.role + "|" + el2.text.slice(0, 24) + "|" + r2(r.x / u) + "," + r2(r.y / u) + " " + r2(r.w / u) + "x" + r2(r.h / u))
    }
    out = kept
    for (var q = 0; q < out.length; ++q) { delete out[q]._item; delete out[q]._seq; delete out[q]._r }
    // journald rate-limits per message, so the elements go out in chunks.
    for (var c = 0; c < out.length; c += 10) log("LAYOUTEL|" + JSON.stringify(out.slice(c, c + 10)))
    if (radiusLimitations) log("LAYOUTWARN|nonuniform-rounded-radius|" + radiusLimitations)
    log("LAYOUTEND|" + r2(root.width / u) + "|" + r2(root.height / u))
}
