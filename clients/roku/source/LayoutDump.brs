' LayoutDump.brs: parity-only dump of the visible scene graph for the layout score (docs/parity/LAYOUT.md).
' Triggered by the ECP input command `input?parityLayout=1` (the parity driver sends it right after a screenshot) and printed on
' the debug console, one JSON object per line: PARITY|layout|{...}, then PARITY|layout|end. The driver turns these into the schema
' document: nominal font sizes become CSS px there, backgrounds are sampled from the screenshot.

sub ParityLayoutDump(scene as Object)
    ctx = { measure: CreateObject("roSGNode", "Label"), count: 0 }
    ParityLayoutWalk(scene, 1.0, ctx)
    print "PARITY|layout|end"
end sub

sub ParityLayoutEmit(item as Object)
    print "PARITY|layout|" + FormatJson(item)
end sub

function ParityHex(c as Integer) as String
    ' ARGB-style Roku colours are 0xRRGGBBAA integers.
    return "#" + Right("00000000" + StrI(c, 16), 8)
end function

sub ParityLayoutWalk(node as Object, opacity as Float, ctx as Object)
    if node = invalid then return
    if node.hasField("visible") and node.visible = false then return
    op = opacity
    if node.hasField("opacity") then op = op * node.opacity
    if op <= 0.01 then return
    kind = node.subtype()
    if kind = "Label"
        ParityLayoutLabel(node, op, ctx)
        return
    else if kind = "TrackedText"
        ParityLayoutTracked(node, node.spec, invalid, op, ctx)
        return
    else if kind = "WebLabel"
        if node.text <> ""
            ParityLayoutTracked(node.findNode("run"), { text: node.text, size: node.size, weight: node.weight, tracking: node.tracking }, node.color, op, ctx)
        end if
        return
    else if kind = "Poster"
        r = node.sceneBoundingRect()
        if r.width > 0 and r.height > 0 then ParityLayoutEmit({ k: "poster", id: node.id, x: r.x, y: r.y, w: r.width, h: r.height, uri: node.uri, blend: ParityHex(node.blendColor), op: op })
    else if kind = "Rectangle"
        r = node.sceneBoundingRect()
        if r.width > 0 and r.height > 0 and (node.color and 255) = 0 or (node.color and 255) > 0
            if (node.color and 255) > 0 then ParityLayoutEmit({ k: "rect", id: node.id, x: r.x, y: r.y, w: r.width, h: r.height, color: ParityHex(node.color), op: op })
        end if
    end if
    n = node.getChildCount()
    for i = 0 to n - 1
        ParityLayoutWalk(node.getChild(i), op, ctx)
    end for
end sub

' Glyph-run width of a label's text: a measuring Label with the same font draws it on one line.
function ParityTextWidth(ctx as Object, text as String, font as Object) as Float
    ctx.measure.font = font
    ctx.measure.text = text
    return ctx.measure.boundingRect().width
end function

sub ParityLayoutLabel(label as Object, op as Float, ctx as Object)
    text = label.text
    if text = invalid or text = "" then return
    r = label.sceneBoundingRect()
    font = label.font
    meta = invalid
    if font <> invalid then meta = ParityFontMeta(font)
    item = { k: "label", id: label.id, text: text, x: r.x, y: r.y, w: r.width, h: r.height, color: ParityHex(label.color), op: op, align: label.horizAlign, lines: label.numLines, wrap: label.wrap, lineSpacing: label.lineSpacing }
    if meta <> invalid
        item.size = meta.px
        item.font = font.uri
        item.textW = ParityTextWidth(ctx, text, font)
        item.vert = label.vertAlign
    end if
    ParityLayoutEmit(item)
end sub

sub ParityLayoutTracked(node as Object, spec as Object, colour as Dynamic, op as Float, ctx as Object)
    if spec = invalid or spec.text = invalid or spec.text = "" then return
    text = spec.text
    if spec.upper = true then text = UCase(text)
    x0 = 100000.0
    y0 = 100000.0
    x1 = -100000.0
    y1 = -100000.0
    n = node.getChildCount()
    for i = 0 to n - 1
        g = node.getChild(i)
        if g.visible and g.text <> ""
            r = g.sceneBoundingRect()
            w = ParityTextWidth(ctx, g.text, g.font)
            if r.x < x0 then x0 = r.x
            if r.y < y0 then y0 = r.y
            if r.x + w > x1 then x1 = r.x + w
            if r.y + r.height > y1 then y1 = r.y + r.height
        end if
    end for
    if x1 < x0 then return
    x1 = x0 + node.textWidth
    meta = invalid
    if spec.weight <> invalid then meta = { px: spec.size, weight: spec.weight }
    item = { k: "tracked", id: node.id, text: text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, op: op, role: spec.role, color: ParityColour(spec, colour), lines: node.lineCount, tracking: spec.tracking }
    if meta <> invalid
        item.size = meta.px
        item.font = PlayarrFontPath(spec.weight)
    end if
    ParityLayoutEmit(item)
end sub

function ParityFontMeta(font as Object) as Dynamic
    g = GetGlobalAA()
    if g.fontMeta = invalid then return invalid
    return g.fontMeta[font.uri + "|" + Str(font.size)]
end function


function ParityColour(spec as Object, colour as Dynamic) as String
    if colour <> invalid then return ParityHex(colour)
    if spec.color <> invalid then return ParityHex(spec.color)
    return ParityHex(ThemeColor(spec.role))
end function
