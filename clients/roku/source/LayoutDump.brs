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
    if node.hasField("parityRole")
        ParityAnnotated(node, op)
        return
    end if
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
            ParityLayoutTracked(node.findNode("run"), { id: node.id, rectH: node.rectH, text: node.text, size: node.size, weight: node.weight, tracking: node.tracking, lineHeight: ParityWebLineHeight(node) }, node.color, op, ctx)
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
    item = { k: "label", bg: ParityTextBg(label.id, r.x, r.y), id: label.id, text: text, x: r.x, y: r.y, w: r.width, h: r.height, color: ParityHex(label.color), op: op, align: label.horizAlign, lines: label.numLines, wrap: label.wrap, lineSpacing: label.lineSpacing }
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
    ytop = -100000.0
    n = node.getChildCount()
    for i = 0 to n - 1
        g = node.getChild(i)
        if g.visible and g.text <> ""
            r = g.sceneBoundingRect()
            w = ParityTextWidth(ctx, g.text, g.font)
            if r.x < x0 then x0 = r.x
            if r.y < y0 then y0 = r.y
            if r.x + w > x1 then x1 = r.x + w
            if r.y > ytop then ytop = r.y
        end if
    end for
    if x1 < x0 then return
    x1 = x0 + node.textWidth
    ' Chrome's text rect is the content area at whole pixels: round(1.011 em) + round(0.353 em) tall; further lines are a line pitch lower.
    contentH = Int(spec.size * 1.011 + 0.5) + Int(spec.size * 0.353 + 0.5)
    y1 = ytop + contentH
    if spec.rectH <> invalid and spec.rectH > 0 then y1 = ytop + spec.rectH
    tid = node.id
    if spec.id <> invalid then tid = spec.id
    meta = invalid
    reported = spec.size
    ' An active dock label is drawn 1.05 times larger because the web transforms the tile: its font size stays the design size.
    if Left(tid, 8) = "navLabel" and spec.size > 9 then reported = spec.size / 1.05
    if spec.weight <> invalid then meta = { px: reported, weight: spec.weight }
    item = { k: "tracked", bg: ParityTextBg(tid, x0, y0), id: tid, text: text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, op: op, role: spec.role, color: ParityColour(spec, colour), lines: node.lineCount, tracking: spec.tracking }
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
    ParityPageShell()
    logo = m.top.findNode("navLogo")
    if logo <> invalid and logo.visible and m.persistentHeader.visible
        r = logo.sceneBoundingRect()
        ParityBox("image", "", r.x, r.y, r.width, r.height, 0, "bg")
    end if
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

function ParityTextBg(id as String, x as Float, y as Float) as String
    if x < 125 or Instr(1, id, "clock") > 0 or (x > 1840 and y < 230) then return ParityToken("bg")
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
    ' The web scales the whole card by 1.015 on focus and its art a further 1.025: the art's scale is the device's own focus state.
    s = card.findNode("artGroup").scale[0]
    ls = 1.0
    if r.width / s > 300 and s > 1.001 then ls = s / (1 + (s - 1) * 0.6219)
    lw = r.width / s * ls
    lh = (r.height / s + 29.38) * ls
    lx = r.x + r.width / 2 - lw / 2
    ly = r.y + r.height / 2 + 14.69 * ls - lh / 2
    surf = "surface"
    ParityBox("link", name, lx, ly, lw, lh, 12, surf)
    ParityBox("container", "", r.x, r.y, r.width, r.height, 12.48, "surfaceSoft")
    ParityBox("image", "", r.x, r.y, r.width, r.height, 0, "surfaceSoft")
    badge = card.findNode("unwatchedBadge")
    if badge <> invalid and badge.visible
        b = badge.sceneBoundingRect()
        ParityBox("img", "Unwatched", b.x + b.width * 0.067, b.y + b.height * 0.067, b.width * 0.867, b.height * 0.867, 50, "accent")
    end if
    track = card.findNode("progressTrack")
    if track <> invalid and track.visible
        t = track.sceneBoundingRect()
        f = card.findNode("progressFill").sceneBoundingRect()
        ParityBox("img", Str(Int(f.width / t.width * 100 + 0.5)).Trim() + "% watched", t.x, t.y, t.width, t.height, 0, "progressTrackBg")
        ParityBox("container", "", f.x, f.y, f.width, f.height, 0, "accent")
    end if
end sub

function ParityWebLineHeight(web as Object) as Float
    if web.lineHeight > 0 then return web.lineHeight
    return web.size * 1.364 + web.lineSpacing
end function

' A node marked by pgMark (components/Pages.brs).
sub ParityAnnotated(node as Object, op as Float)
    r = node.sceneBoundingRect()
    if node.parityRole = "text"
        c = ThemeColor(node.parityColor)
        ParityLayoutEmit({ k: "tracked", bg: ParityToken("surface"), id: "mark", text: node.parityText, x: r.x, y: r.y, w: r.width, h: r.height, op: op, role: "", color: ParityHex(c), lines: 1, tracking: 0, size: node.paritySize, font: PlayarrFontPath(node.parityWeight) })
        return
    end if
    ParityBox(node.parityRole, node.parityName, r.x, r.y, r.width, r.height, node.parityRadius, node.parityBg, op)
end sub

' The page layers every web screen has: the root, the named page container, the key-art image, the page surface and the content panel.
sub ParityPageShell()
    state = m.top.screenState
    name = ""
    panel = ""
    art = false
    if state = "home"
        name = "Home"
        panel = "Home media tracks"
        art = true
    else if state = "browse"
        if m.browseKind = "movie"
            name = "Movies library"
            panel = "Movies titles"
        else if m.browseKind = "series"
            name = "Series library"
            panel = "Series titles"
        else if m.browseKind = "artist"
            name = "Music library"
            panel = "Music artists"
        end if
        art = true
    end if
    ParityBox("container", "", 0, 0, 1920, 1080, 0, "bg")
    if name = "" then return
    ParityBox("container", name, 0, 0, 1920, 1080, 0, "surface")
    ParityBox("container", "", 0, 0, 1920, 1080, 0, "surface")
    if panel <> "" then ParityBox("container", panel, 729.6, 0, 1190.4, 1080, 0, "surface")
end sub

' Where a list lays an item out is not reachable from the item, so the scene tells every card its origin before the cards answer.
sub ParityPrepareCards()
    lists = []
    if m.visibleRails <> invalid
        for each rail in m.visibleRails
            lists.Push(rail.row)
        end for
    end if
    lists.Push(m.browseGrid)
    if m.searchGrid <> invalid then lists.Push(m.searchGrid)
    for each list in lists
        if list = invalid or list.content = invalid or not ParityShown(list) then continue for
        if list.subtype() = "RowList"
            ' A rail item reports its box relative to the rail: add the rail's scene origin (measured: the list sits 8 px right and
            ' 14.6 px below the sum of its ancestors' translations, the room reserved for the focus ring).
            o = ParityOrigin(list)
            row = list.content.getChild(0)
            if row = invalid then continue for
            for j = 0 to row.getChildCount() - 1
                ParityPlace(row.getChild(j), o[0] + 96 + 7.98 + j * (list.rowItemSize[0][0] + list.rowItemSpacing[0][0]), o[1] + 14.6)
            end for
        else
            ' A grid item reports its box in the scene already; the cell offset is what it lacks.
            cols = list.numColumns
            if cols < 1 then cols = 1
            for i = 0 to list.content.getChildCount() - 1
                ParityPlace(list.content.getChild(i), (i mod cols) * Int(list.itemSize[0] + list.itemSpacing[0]), Int(i / cols) * Int(list.itemSize[1] + list.itemSpacing[1]))
            end for
        end if
    end for
end sub

sub ParityPlace(item as Object, x as Float, y as Float)
    if not item.hasField("parityDx") then item.addFields({ parityDx: 0.0, parityDy: 0.0 })
    item.parityDx = x
    item.parityDy = y
end sub

function ParityShown(node as Object) as Boolean
    n = node
    while n <> invalid
        if n.hasField("visible") and n.visible = false then return false
        n = n.getParent()
    end while
    return true
end function

' Scene position of a node's origin: the translations of the node and its ancestors (no scaled ancestor on the pages that use this).
function ParityOrigin(node as Object) as Object
    x = 0.0
    y = 0.0
    n = node
    while n <> invalid
        if n.hasField("translation")
            t = n.translation
            x = x + t[0]
            y = y + t[1]
        end if
        n = n.getParent()
    end while
    return [x, y]
end function
