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
    if node.id = "searchFieldLabel" or node.id = "searchClearLabel" then return
    if kind = "Label"
        ParityLayoutLabel(node, op, ctx)
        return
    else if kind = "TrackedText"
        ParityLayoutTracked(node, node.spec, invalid, op, ctx)
        return
    else if kind = "PosterCard"
        ParityCard(node)
    else if kind = "WebLabel"
        if node.text <> "" and not node.hasField("parityHidden")
            ParityLayoutTracked(node.findNode("run"), { id: node.id, rectH: node.rectH, text: node.text, size: node.size, weight: node.weight, tracking: node.tracking, lineHeight: ParityWebLineHeight(node), aria: node.aria }, node.color, op, ctx)
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
            r = ParityRectOf(g)
            w = ParityTextWidth(ctx, g.text, g.font)
            if r.x < x0 then x0 = r.x
            if r.y < y0 then y0 = r.y
            if r.x + w > x1 then x1 = r.x + w
            if r.y > ytop then ytop = r.y
        end if
    end for
    if x1 < x0 then return
    sc = 1.0
    if m.parityRoot <> invalid then sc = ParityScale(node)
    x1 = x0 + node.textWidth * sc
    ' Chrome's text rect is the content area at whole pixels: round(1.011 em) + round(0.353 em) tall; further lines are a line pitch lower.
    contentH = (Int(spec.size * 1.011 + 0.5) + Int(spec.size * 0.353 + 0.5)) * sc
    y1 = ytop + contentH
    if spec.rectH <> invalid and spec.rectH > 0 then y1 = ytop + spec.rectH * sc
    tid = node.id
    if spec.id <> invalid then tid = spec.id
    meta = invalid
    reported = spec.size
    ' An active dock label is drawn 1.05 times larger because the web transforms the tile: its font size stays the design size.
    if Left(tid, 8) = "navLabel" and spec.size > 9 then reported = spec.size / 1.05
    if spec.weight <> invalid then meta = { px: reported, weight: spec.weight }
    item = { k: "tracked", bg: ParityTextBg(tid, x0 + ParityDx(), y0 + ParityDy()), id: tid, text: text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, op: op, role: spec.role, color: ParityColour(spec, colour), lines: node.lineCount, tracking: spec.tracking }
    if spec.aria <> invalid and spec.aria <> "" then item.aria = spec.aria
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
    if token = "sample" or token = "" or token = "inherit" then return ""
    if token = "brandStrong" then return "#a52745"
    if Left(token, 1) = "#" then return token
    ' "c:<dark>:<light>": the web's composited background of a translucent fill, per theme (read from the web layout document).
    if Left(token, 2) = "c:"
        parts = token.Split(":")
        if m.global.themeMode = "light" then return "#" + parts[2]
        return "#" + parts[1]
    end if
    if token = "progressTrackBg"
        if m.global.themeMode = "light" then return "#e5e3e4"
        return "#5a5559"
    end if
    return Left(ParityHex(ThemeColor(token)), 7)
end function

' One box.
sub ParityBox(role as String, name as String, x as Float, y as Float, w as Float, h as Float, radius as Float, bgToken as String, opacity = 1.0 as Float)
    ' The web reports 999 for a pill and 50 for a circle (border-radius 50 %); a device radius that rounds the whole short side is the same shape.
    r = radius
    if r >= 999 then r = 998.5
    short = w
    if h < short then short = h
    if radius = 50
        r = 50
    else if radius >= 999
        r = 999
    else if r > 0 and r * 2 >= short - 0.5
        r = 999
        if Abs(w - h) < 1 then r = 50
    end if
    ' Containers and images carry no accessible name in the web document; links, buttons, status lines and text boxes do.
    label = name
    if role = "container" or role = "image" or role = "img" then label = ""
    item = { k: "box", role: role, text: label, x: x, y: y, w: w, h: h, radius: r, bg: ParityToken(bgToken) }
    if bgToken <> "sample" and bgToken <> "" and bgToken <> "inherit" then item.fixed = true
    if bgToken = "inherit" then item.inherit = true
    if opacity < 0.995 then item.opacity = opacity
    ParityLayoutEmit(item)
end sub

sub ParityStructure()
    if m.top.screenState = "search" then ParitySearch()
    if m.top.screenState = "profiles"
        ParityProfilesPage()
        return
    end if
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
    sample = "c:1c191c:fbfaf9"
    found = false
    for g = 0 to 2
        bg = m.top.findNode("navGroupBg" + g.ToStr())
        if bg <> invalid and bg.visible
            r = bg.sceneBoundingRect()
            found = true
            ParityBox("container", "", r.x, r.y, r.width - 0.5, r.height - 0.4, 22, "c:1c191c:fbfaf9")
        end if
    end for
    if not found then return
    for i = 0 to m.navLabels.Count() - 1
        if m.navEnabled <> invalid and not m.navEnabled[i] then continue for
        hl = m.navHighlights[i].sceneBoundingRect()
        on = i = activeIdx or (m.navDockMode = true and i = m.navDockIndex)
        name = m.navLabels[i].text
        tileBg = sample
        if on then tileBg = "c:2f2c2f:e9e7e6"
        if on
            ParityBox("link", name, hl.x + 0.2, hl.y - 0.8, 67.2, 67.2, 16, tileBg)
        else
            ParityBox("link", name, hl.x + 1.8, hl.y + 0.8, 64, 64, 16, sample)
        end if
        ic = m.navIcons[i].sceneBoundingRect()
        ParityLayoutEmit({ k: "box", role: "image", text: "", x: ic.x, y: ic.y, w: ic.width, h: ic.height, radius: 0, bg: ParityToken(tileBg), fixed: true })
    end for
    ' Identity tile
    pill = m.top.findNode("userPillBg")
    if pill <> invalid and pill.visible
        r = pill.sceneBoundingRect()
        at = "c:1c191c:fbfaf9"
        ParityBox("container", "", r.x, r.y, r.width - 0.5, r.height - 0.6, 22, at)
        ParityBox("link", "Signed in as " + m.session.profileName + ". Open profiles.", r.x + 6.8, r.y + 7.7, 64, 64, 16, at)
        av = m.userAvatar.sceneBoundingRect()
        ParityBox("container", "", av.x, av.y, av.width, av.height, 50, at)
        ParityBox("image", "", av.x, av.y, av.width, av.height, 0, at)
    end if
end sub

function ParityTextBg(id as String, x as Float, y as Float) as String
    if m.top.screenState = "profiles" then return ParityToken("bg")
    if x < 125 or Instr(1, id, "clock") > 0 or (x > 1840 and y < 230) then return ParityToken("bg")
    return ParityToken("surface")
end function

' Position of a node's origin from its translation chain up to the item root (m.parityRoot, set while a list item answers) or the scene.
' sceneBoundingRect is not used inside list items: it leaves out the item's own transforms.
function ParityPos(node as Object) as Object
    ' Origin of `node` in item (or scene) coordinates: each ancestor maps its children's points by its translation and scale
    ' about scaleRotateCenter.
    t = [0.0, 0.0]
    if node.hasField("translation") then t = [node.translation[0], node.translation[1]]
    x = t[0]
    y = t[1]
    n = node.getParent()
    while n <> invalid
        if m.parityRoot <> invalid and n.isSameNode(m.parityRoot) then exit while
        if n.hasField("translation")
            tr = n.translation
            sx = 1.0
            sy = 1.0
            cx = 0.0
            cy = 0.0
            if n.hasField("scale")
                sx = n.scale[0]
                sy = n.scale[1]
                cx = n.scaleRotateCenter[0]
                cy = n.scaleRotateCenter[1]
            end if
            x = tr[0] + cx + sx * (x - cx)
            y = tr[1] + cy + sy * (y - cy)
        end if
        n = n.getParent()
    end while
    return [x, y]
end function

' Product of the scales above `node` (up to the item root): how much larger than its own coordinates a thing in it is drawn.
function ParityScale(node as Object) as Float
    k = 1.0
    n = node.getParent()
    while n <> invalid
        if m.parityRoot <> invalid and n.isSameNode(m.parityRoot) then exit while
        if n.hasField("scale") then k = k * n.scale[0]
        n = n.getParent()
    end while
    return k
end function

' A point of the card's art group (local q) drawn at its scale about scaleRotateCenter.
function ParityArtPoint(ag as Object, q as Object) as Object
    o = ParityPos(ag)
    s = ag.scale[0]
    c = ag.scaleRotateCenter
    return [o[0] + c[0] + s * (q[0] - c[0]), o[1] + c[1] + s * (q[1] - c[1])]
end function

' One media card (web .tv-title-card / .tv-home-card): link, art container and image, state badges. The caption labels are walked as text.
sub ParityCard(card as Object)
    bgNode = card.findNode("posterBg")
    if bgNode = invalid or not bgNode.visible then return
    ag = card.findNode("artGroup")
    s = ag.scale[0]
    tl = ParityArtPoint(ag, [0, 0])
    r = { x: tl[0], y: tl[1], width: bgNode.width * s, height: bgNode.height * s }
    ax = r.x + ParityDx()
    ay = r.y + ParityDy()
    if r.width < 20 or ax > 1925 or ay > 1085 or ax + r.width < 0 or ay + r.height < 0 then return
    title = card.findNode("title")
    kind = card.findNode("kind")
    inGrid = bgNode.width > 300 and card.findNode("progressTrack") <> invalid and not card.findNode("progressTrack").visible
    inGrid = false
    if m.parityGrid = true or m.parityOpen = true then inGrid = true
    name = title.text
    if inGrid
        name = "Open " + title.text
    else if kind <> invalid and kind.visible and kind.text <> ""
        name = title.text + " " + kind.text
    end if
    ' The web scales the whole card by 1.015 on focus and its art a further 1.025: the art's scale is the device's own focus state.
    ls = 1.0
    if bgNode.width > 300 and m.parityGrid = true and s > 1.001 then ls = s / (1 + (s - 1) * 0.6219)
    num = card.findNode("overlayNumber")
    isEpisode = num <> invalid and num.visible
    capH = 29.38
    cr = 12.48
    if isEpisode
        capH = 28.7
        cr = 13.44
        pre = card.findNode("captionPrefix")
        if Left(pre.text, 2) = "S "
            name = num.text + " " + pre.text.Replace("S 0", "S0").Replace("E 0", "E0") + " " + title.text
        else
            name = "Play " + m.global.parityWorkTitle + " from " + title.text
        end if
    end if
    lw = bgNode.width * ls
    lh = (bgNode.height + capH) * ls
    lx = r.x + r.width / 2 - lw / 2
    ly = r.y + r.height / 2 + capH / 2 * ls - lh / 2 + (s - 1) * 0
    lr = 0
    if m.parityGrid = true then lr = 12
    ParityBox("link", name, lx, ly, lw, lh, lr, "surface")
    ParityBox("container", "", r.x, r.y, r.width, r.height, cr, "surfaceSoft")
    ParityBox("image", "", r.x, r.y, r.width, r.height, 0, "surfaceSoft")
    badge = card.findNode("unwatchedBadge")
    if badge <> invalid and badge.visible
        q = badge.translation
        p = ParityArtPoint(ag, q)
        ParityBox("img", "", p[0] + s, p[1] + s, 13 * s, 13 * s, 50, "brand")
    end if
    track = card.findNode("progressTrack")
    if track <> invalid and track.visible
        p = ParityArtPoint(ag, track.translation)
        fill = card.findNode("progressFill")
        ParityBox("img", "", p[0], p[1], track.width * s, track.height * s, 0, "progressTrackBg")
        ParityBox("container", "", p[0], p[1], fill.width * s, fill.height * s, 0, "brand")
    end if
end sub

function ParityWebLineHeight(web as Object) as Float
    if web.lineHeight > 0 then return web.lineHeight
    return web.size * 1.364 + web.lineSpacing
end function

' A node marked by pgMark (components/Pages.brs).
sub ParityAnnotated(node as Object, op as Float)
    r = node.sceneBoundingRect()
    if node.hasField("parityText")
        c = ThemeColor(node.parityColor)
        ParityLayoutEmit({ k: "tracked", fixed: true, bg: ParityToken(node.parityBg), id: "mark", text: node.parityText, x: r.x, y: r.y, w: r.width, h: r.height, op: op, role: "", aria: node.parityRole, color: ParityHex(c), lines: 1, tracking: 0, radius: node.parityRadius, size: node.paritySize, font: PlayarrFontPath(node.parityWeight) })
        return
    end if
    ParityBox(node.parityRole, node.parityName, r.x, r.y, r.width, r.height, node.parityRadius, node.parityBg, op)
end sub

' The page layers every web screen has: the root, the page container, the key-art image (when the page has key art), the page surface and
' the content panel. Which pages have which is the web's own layout (tv-web TvStageShell and the page shells).
sub ParityPageShell()
    state = m.top.screenState
    art = false
    panel = false
    shell = true
    panelX = 729.6
    if state = "home"
        art = true
        panel = true
    else if state = "browse"
        art = true
        panel = true
    else if state = "detail"
        art = true
        panel = true
    else if state = "search"
        panel = true
    else if state = "page" and m.pageKind = "calendar"
        art = m.calendarView = "agenda"
        panel = m.calendarView = "agenda"
    else if state = "page" and m.pageKind = "settings"
        panel = true
        panelX = 672
    else
        shell = false
    end if
    ParityBox("container", "", 0, 0, 1920, 1080, 0, "bg")
    if not shell then return
    ParityBox("container", "", 0, 0, 1920, 1080, 0, "surface")
    if art
        op = 0.72
        if m.global.themeMode = "light" then op = 0.24
        ParityBox("image", "", 133.03, -22.9, 899.97, 1190.59, 0, "surface", op)
    end if
    ParityBox("container", "", 0, 0, 1920, 1080, 0, "surface")
    if panel then ParityBox("container", "", panelX, 0, 1920 - panelX, 1080, 0, "surface")
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
    if m.detailSimilar <> invalid then lists.Push(m.detailSimilar)
    if m.detailEpisodes <> invalid then lists.Push(m.detailEpisodes)
    if m.detailChapters <> invalid then lists.Push(m.detailChapters)
    if m.profilesRow <> invalid then lists.Push(m.profilesRow)
    if m.searchGrid <> invalid then lists.Push(m.searchGrid)
    for each list in lists
        if list = invalid or list.content = invalid or not ParityShown(list) then continue for
        if list.subtype() = "RowList"
            ' A rail item reports its box relative to the rail: add the rail's scene origin (measured: the list sits 8 px right and
            ' 14.6 px below the sum of its ancestors' translations, the room reserved for the focus ring).
            o = ParityOrigin(list)
            lead = 96
            if list.id = "profilesRow" or list.id = "detailSimilar" or list.id = "detailEpisodes" or list.id = "detailChapters" then lead = 0
            for r = 0 to list.content.getChildCount() - 1
                row = list.content.getChild(r)
                ry = o[1]
                for k = 0 to r - 1
                    ry = ry + ParityAt(list.rowHeights, k, 0)
                end for
                for j = 0 to row.getChildCount() - 1
                    ParityPlace(row.getChild(j), o[0] + lead + j * (ParityAt(list.rowItemSize, r, 0) + ParityAt(list.rowItemSpacing, r, 0)), ry, false, list.id = "detailSimilar")
                end for
            end for
        else
            ' A grid item reports its box in the scene already; the cell offset is what it lacks.
            cols = list.numColumns
            if cols < 1 then cols = 1
            for i = 0 to list.content.getChildCount() - 1
                o = ParityOrigin(list)
                ParityPlace(list.content.getChild(i), o[0] + (i mod cols) * Int(list.itemSize[0] + list.itemSpacing[0]), o[1] + Int(i / cols) * Int(list.itemSize[1] + list.itemSpacing[1]), true)
            end for
        end if
    end for
end sub

sub ParityPlace(item as Object, x as Float, y as Float, grid = false as Boolean, openName = false as Boolean)
    if not item.hasField("parityDx") then item.addFields({ parityDx: 0.0, parityDy: 0.0, parityGrid: false, parityOpen: false })
    item.parityGrid = grid
    item.parityOpen = openName
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

' Rect of a node at the item (m.parityRoot) or the scene: manual in list items, where sceneBoundingRect cannot be trusted.
function ParityRectOf(node as Object) as Object
    if m.parityRoot = invalid then return node.sceneBoundingRect()
    p = ParityPos(node)
    return { x: p[0], y: p[1], width: node.width, height: node.height }
end function

' ---- Profiles ------------------------------------------------------------------------------------------------------------------

' A point (q, in the item group's own coordinates) of a profile item, drawn: through the item group's scale and lift.
function ParityItemPoint(item as Object, q as Object) as Object
    g = item.findNode("itemGroup")
    s = g.scale[0]
    c = g.scaleRotateCenter
    t = g.translation
    return [t[0] + c[0] + s * (q[0] - c[0]), t[1] + c[1] + s * (q[1] - c[1])]
end function

' A point of the circle (local q), drawn: the circle scales about its centre inside the item group.
function ParityCirclePoint(item as Object, q as Object) as Object
    cg = item.findNode("circleGroup")
    s = cg.scale[0]
    o = cg.translation
    c = cg.scaleRotateCenter
    return ParityItemPoint(item, [o[0] + c[0] + s * (q[0] - c[0]), o[1] + c[1] + s * (q[1] - c[1])])
end function

sub ParityProfile(item as Object, content as Object)
    g = item.findNode("itemGroup")
    k = g.scale[0]
    cg = item.findNode("circleGroup")
    cs = cg.scale[0] * k
    p0 = ParityItemPoint(item, [62, 53])
    isAdd = content.presetId = "add"
    name = content.title
    if isAdd
        name = "+ Sign in ADD ANOTHER PROFILE"
    else if content.statusText = "WATCHING NOW"
        name = content.title + ", current profile"
    else if content.statusText = "PIN REQUIRED"
        name = content.title + ", PIN required"
    else
        name = content.title + ", ready"
    end if
    height = 301.6
    ParityBox("button", name, p0[0], p0[1], 244 * k, height * k, 0, "bg")
    c0 = ParityCirclePoint(item, [0, 0])
    ParityBox("container", "", c0[0], c0[1], 244 * cs, 244 * cs, 50, "bg")
    if isAdd
        t = ParityCirclePoint(item, [99.0, 69.4])
        ParityLayoutEmit({ k: "tracked", bg: ParityToken("bg"), id: "plus", text: "+", x: t[0], y: t[1], w: 46.1 * cs, h: 105 * cs, op: 1, role: "", color: ParityHex(ThemeColor("inkSoft")), lines: 1, tracking: 0, size: 76.8, font: PlayarrFontPath(300) })
    else
        i0 = ParityCirclePoint(item, [17.95, 17.95])
        ParityBox("image", "", i0[0], i0[1], 208.1 * cs, 208.1 * cs, 0, "bg")
    end if
    ctx = { measure: CreateObject("roSGNode", "Label"), count: 0 }
    ParityLayoutWalk(g, 1.0, ctx)
end sub

' The profiles page: logo, theme and language buttons, the action buttons under the current profile and the footer action.
sub ParityProfilesPage()
    logo = m.top.findNode("profilesLogo")
    ParityBox("container", "", 0, 0, 1920, 1080, 0, "bg")
    ParityBox("image", "", 60.63, 60.16, 42, 42, 0, "bg")
    cc = m.top.findNode("profilesChromeControls")
    o = cc.translation
    ParityBox("button", "Theme: " + m.profilesThemeLabel.text, o[0] - 0.2, o[1] - 0.3, 144, 48, 0, "bg")
    ParityBox("image", "", o[0] + 19.2, o[1] + 15.7, 16, 16, 0, "bg")
    ParityBox("image", "", o[0] + 112.4, o[1] + 17.7, 12, 12, 0, "bg")
    ParityBox("button", m.top.findNode("profilesLangLabel").text, o[0] + 157.8, o[1] - 0.3, 168, 48, 0, "bg")
    ParityBox("image", "", o[0] + 177.2, o[1] + 15.7, 16, 16, 0, "bg")
    ParityBox("image", "", o[0] + 294.4, o[1] + 17.7, 12, 12, 0, "bg")
    ag = m.profileActionsGroup
    if ag <> invalid and ag.opacity > 0.5
        a = ag.translation
        who = ""
        if m.profiles <> invalid and m.profiles.Count() > 0
            idx = m.profilesFocusIndex
            if idx = invalid or idx < 0 or idx >= m.profiles.Count() then idx = profilesCurrentIndex()
            if m.profiles[idx] <> invalid and m.profiles[idx].display_name <> invalid then who = m.profiles[idx].display_name
        end if
        tok = "c:1d191d:fbfbfa"
        ParityBox("button", who + " settings", a[0], a[1], 44, 44, 999, tok)
        ParityBox("image", "", a[0] + 13, a[1] + 13, 18, 18, 0, tok)
        ParityBox("button", "Sign out " + who, a[0] + 52.8, a[1], 101.2, 44, 999, tok)
        ParityBox("image", "", a[0] + 69.8, a[1] + 13, 18, 18, 0, tok)
        ParityLayoutEmit({ k: "tracked", bg: ParityToken(tok), id: "signout", text: "Sign out", x: a[0] + 95, y: a[1] + 14, w: 42, h: 15, op: 1, role: "", color: ParityHex(ThemeColor("inkSoft")), lines: 1, tracking: 0, size: 10.75, font: PlayarrFontPath(720) })
    end if
end sub

' The search page: the pill field with its magnifier and text box, and the empty-state badge.
sub ParitySearch()
    tok = "c:201c20:fffefe"
    ParityBox("search", "", 153.6, 172.8, 590, 76, 999, tok)
    ParityBox("image", "", 178.6, 198.8, 24, 24, 0, tok)
    ParityBox("textbox", "Search your libraries and playlists", 215.6, 180.8, 506, 60, 0, tok)
    if m.searchEmptyState <> invalid and m.searchEmptyState.visible
        etok = "c:1e1b1e:fdfdfc"
        ParityBox("container", "", 1124.6, 311.8, 132, 132, 50, etok)
        ParityBox("image", "", 1163.6, 359.8, 54, 36, 0, etok)
    end if
end sub

' The detail page action tiles. specs hold the tile boxes and the glyph and label metrics buildTiles laid out.
sub ParityTiles(specs as Object, title as String)
    for each t in specs
        if t.gw = invalid then continue for
        outline = "c:1f1c1f:fefefd"
        tok = outline
        name = "+ " + t.text
        role = "button"
        if t.icon = "nav-playlists.png" then name = "Playback settings for " + title
        inkOn = t.ink = true and t.hot <> true
        if t.primary or t.ink = true
            role = "link"
            name = "Play " + title
            if m.top.layoutKind = "series" then name = t.text + " " + title
            tok = "brandStrong"
            if inkOn then tok = "ink"
        end if
        if t.ink = true and m.top.layoutKind = "series" then role = "button"
        radius = 999
        ParityBox(role, name, t.x, t.y, t.w, t.h, radius, tok)
        cy = t.y + t.h / 2
        glyph = "+"
        if t.icon = "nav-playlists.png" then glyph = "☷"
        if t.icon = "player-play.png" then glyph = "▶"
        grole = "brandInk"
        if t.primary then grole = "playerInk"
        if inkOn then grole = "bg"
        if t.ink = true and not inkOn then grole = "playerInk"
        gh = Int(t.glyphSize * 1.011 + 0.5) + Int(t.glyphSize * 0.353 + 0.5)
        if glyph = "▶" then gh = t.glyphSize * 1.46
        ParityLayoutEmit({ k: "tracked", fixed: true, bg: ParityToken(tok), id: "tile", text: glyph, x: t.startX, y: cy - 0.65 - gh / 2, w: t.gw, h: gh, op: 1, role: "", color: ParityHex(ThemeColor(grole)), lines: 1, tracking: 0, size: t.glyphSize, font: PlayarrFontPath(400) })
        lrole = "ink"
        if t.primary then lrole = "playerInk"
        if inkOn then lrole = "bg"
        if t.ink = true and not inkOn then lrole = "playerInk"
        lh = Int(t.labelSize * 1.011 + 0.5) + Int(t.labelSize * 0.353 + 0.5)
        if t.labelSize > 11.5 then lh = 17
        ParityLayoutEmit({ k: "tracked", fixed: true, bg: ParityToken(tok), id: "tile", text: t.text, x: t.startX + t.gw + t.gap, y: cy - 0.95 - lh / 2, w: t.lw, h: lh, op: 1, role: "", color: ParityHex(ThemeColor(lrole)), lines: 1, tracking: 0, size: t.labelSize, font: PlayarrFontPath(700) })
    end for
end sub

' Entry i of a per-row array (the last entry holds for later rows); rowItemSize entries are [w, h] pairs, the others numbers.
function ParityAt(arr as Object, i as Integer, which as Integer) as Float
    if arr = invalid or arr.Count() = 0 then return 0
    if i >= arr.Count() then i = arr.Count() - 1
    v = arr[i]
    if type(v) = "roArray" then return v[which]
    return v
end function
