' LayoutDump.brs: parity-only dump of the visible scene graph for the layout score (docs/parity/LAYOUT.md).
' Triggered by the ECP input command `input?parityLayout=1` (the parity driver sends it right after a screenshot) and printed on
' the debug console, one JSON object per line: PARITY|layout|{...}, then PARITY|layout|end. The driver turns these into the schema
' document: nominal font sizes become CSS px there, backgrounds are sampled from the screenshot.

sub ParityLayoutDump(scene as Object)
    ctx = { measure: CreateObject("roSGNode", "Label"), count: 0 }
    ParityLayoutWalk(scene, 1.0, ctx)
    ParityStructure()
    print "PARITY|layout|end"
end sub

function ParityDx() as Float
    if m.parityDx = invalid then return 0
    return m.parityDx
end function

function ParityDy() as Float
    if m.parityDy = invalid then return 0
    return m.parityDy
end function

sub ParityLayoutEmit(item as Object)
    if item.x <> invalid
        item.x = item.x + ParityDx()
        item.y = item.y + ParityDy()
    end if
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
    else if kind = "PosterCard"
        ParityCard(node)
    else if kind = "WebLabel"
        if node.text <> ""
            ParityLayoutTracked(node.findNode("run"), { text: node.text, size: node.size, weight: node.weight, tracking: node.tracking }, node.color, op, ctx)
        end if
        return
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
    item = { k: "label", bg: ParityTextBg(label.id, r.x), id: label.id, text: text, x: r.x, y: r.y, w: r.width, h: r.height, color: ParityHex(label.color), op: op, align: label.horizAlign, lines: label.numLines, wrap: label.wrap, lineSpacing: label.lineSpacing }
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
    item = { k: "tracked", bg: ParityTextBg(node.id, x0), id: node.id, text: text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, op: op, role: spec.role, color: ParityColour(spec, colour), lines: node.lineCount, tracking: spec.tracking }
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

' ---- Structure the scene graph does not carry as nodes: boxes the web exports (links, containers, images) ----------------

' The colour the web reports as "behind" an element: a theme token (dock and header: bg, page content: surface, art: surfaceSoft).
function ParityToken(token as String) as String
    if token = "accent" then return "#cf3157"
    if token = "progressTrackBg" then return "#5a5559"
    return Left(ParityHex(ThemeColor(token)), 7)
end function

' One box.
sub ParityBox(role as String, name as String, x as Float, y as Float, w as Float, h as Float, radius as Float, bgToken as String, opacity = 1.0 as Float)
    item = { k: "box", role: role, text: name, x: x, y: y, w: w, h: h, radius: radius, bg: ParityToken(bgToken) }
    if opacity < 0.995 then item.opacity = opacity
    ParityLayoutEmit(item)
end sub

sub ParityStructure()
    if m.navDock <> invalid and m.navDock.visible then ParityDock()
end sub

' Left dock (web .app-nav): group containers, item links, icons and the identity tile.
sub ParityDock()
    kinds = navDockLabelList()
    activeIdx = activeNavDockIndex()
    sample = "bg"
    found = false
    for g = 0 to 2
        bg = m.top.findNode("navGroupBg" + g.ToStr())
        if bg <> invalid and bg.visible
            r = bg.sceneBoundingRect()
            found = true
            ParityBox("container", "", r.x, r.y, r.width - 0.5, r.height - 0.4, 22, "bg")
        end if
    end for
    if not found then return
    for i = 0 to m.navLabels.Count() - 1
        if m.navEnabled <> invalid and not m.navEnabled[i] then continue for
        hl = m.navHighlights[i].sceneBoundingRect()
        on = i = activeIdx or (m.navDockMode = true and i = m.navDockIndex)
        name = m.navLabels[i].text
        if on
            ParityBox("link", name, hl.x + 0.2, hl.y - 0.8, 67.2, 67.2, 16, sample)
        else
            ParityBox("link", name, hl.x + 1.8, hl.y + 0.8, 64, 64, 16, sample)
        end if
        ic = m.navIcons[i].sceneBoundingRect()
        ParityLayoutEmit({ k: "box", role: "image", text: "", x: ic.x, y: ic.y, w: ic.width, h: ic.height, radius: 0, bg: ParityToken("bg") })
    end for
    ' Identity tile
    pill = m.top.findNode("userPillBg")
    if pill <> invalid and pill.visible
        r = pill.sceneBoundingRect()
        at = "bg"
        ParityBox("container", "", r.x, r.y, r.width - 0.5, r.height - 0.6, 22, at)
        ParityBox("link", "Signed in as " + m.session.profileName + ". Open profiles.", r.x + 6.8, r.y + 7.7, 64, 64, 16, at)
        av = m.userAvatar.sceneBoundingRect()
        ParityBox("container", "", av.x, av.y, av.width, av.height, 50, at)
        ParityBox("image", "", av.x, av.y, av.width, av.height, 0, at)
    end if
end sub

function ParityTextBg(id as String, x as Float) as String
    if x < 125 or Instr(1, id, "clock") > 0 then return ParityToken("bg")
    return ParityToken("surface")
end function

' One media card (web .tv-title-card / .tv-home-card): link, art container and image, state badges. The caption labels are walked as text.
sub ParityCard(card as Object)
    bgNode = card.findNode("posterBg")
    if bgNode = invalid or not bgNode.visible then return
    r = bgNode.sceneBoundingRect()
    if r.width < 20 or r.x > 1925 or r.y > 1085 or r.x + r.width < 0 or r.y + r.height < 0 then return
    title = card.findNode("title")
    kind = card.findNode("kind")
    inGrid = false
    p = card.getParent()
    while p <> invalid
        if p.id = "browseGrid" or p.id = "searchGrid" then inGrid = true
        p = p.getParent()
    end while
    name = title.text
    if inGrid
        name = "Open " + title.text
    else if kind <> invalid and kind.visible and kind.text <> ""
        name = title.text + " " + kind.text
    end if
    sArt = 1.0
    if r.width > 335 then sArt = 1.0403
    w0 = r.width / sArt
    h0 = r.height / sArt
    cy0 = r.y + r.height / 2
    if sArt > 1 then cy0 = cy0 + 5.2
    lx = r.x + r.width / 2 - w0 / 2
    ly = cy0 - h0 / 2
    lw = w0
    lh = h0 + 29.4
    if sArt > 1
        lw = lw * 1.015
        lh = lh * 1.015
        lx = r.x + r.width / 2 - lw / 2
        ly = cy0 - (h0 + 29.4) / 2 * 1.015 - 5
    end if
    surf = "surface"
    ParityBox("link", name, lx, ly, lw, lh, 12, surf)
    ParityBox("container", "", r.x, r.y, r.width, r.height, 12.48, "surfaceSoft")
    ParityBox("image", "", r.x, r.y, r.width, r.height, 0, "surfaceSoft")
    badge = card.findNode("unwatchedBadge")
    if badge <> invalid and badge.visible
        b = badge.sceneBoundingRect()
        ParityBox("img", "Unwatched", b.x, b.y, b.width, b.height, 50, "accent")
    end if
    track = card.findNode("progressTrack")
    if track <> invalid and track.visible
        t = track.sceneBoundingRect()
        f = card.findNode("progressFill").sceneBoundingRect()
        ParityBox("img", Str(Int(f.width / t.width * 100 + 0.5)).Trim() + "% watched", t.x, t.y, t.width, t.height, 0, "progressTrackBg")
        ParityBox("container", "", f.x, f.y, f.width, f.height, 0, "accent")
    end if
end sub
