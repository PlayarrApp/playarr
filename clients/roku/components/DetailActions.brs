sub init()
    m.tilesGroup = m.top.findNode("tiles")
    m.focusIdx = 0
    m.top.focusable = true
    m.top.ObserveField("focusedChild", "onFocusChange")
    buildTiles()
end sub

' id (selected index), x, y, w, h, icon, text
function tileSpecs() as Object
    watchText = "Add to watchlist"
    if m.top.watchlisted then watchText = "In watchlist"
    playText = "Play"
    if m.top.layoutKind = "series" then playText = m.top.playLabel
    if m.top.playMode = "unavailable" then playText = "Unavailable"
    if m.top.layoutKind = "series"
        ' Web series page (y 622.6): a white Start pill, then the two outlined tiles.
        return [
            { id: 0, x: 153.6, y: 508.6, w: 156, h: 64, icon: "player-play.png", text: playText, primary: true, ink: true }
            { id: 2, x: 325.6, y: 508.6, w: 142, h: 64, icon: "", text: watchText, primary: false }
            { id: 3, x: 483.6, y: 508.6, w: 142, h: 64, icon: "", text: "Add to Playlist", primary: false }
        ]
    end if
    return [
        { id: 1, x: 311.6, y: 508.6, w: 142, h: 64, icon: "nav-playlists.png", text: "Playback", primary: false }
        { id: 0, x: 464.9, y: 506.7, w: 165.4, h: 67.8, icon: "player-play.png", text: playText, primary: true, ink: true }
        { id: 2, x: 153.6, y: 584.6, w: 142, h: 64, icon: "", text: watchText, primary: false }
        { id: 3, x: 311.6, y: 584.6, w: 142, h: 64, icon: "", text: "Add to Playlist", primary: false }
    ]
end function

sub buildTiles()
    m.tilesGroup.removeChildrenIndex(m.tilesGroup.getChildCount(), 0)
    m.specs = tileSpecs()
    ' Keep the current selection when possible, but a layout may remove that action.
    if specFor(m.focusIdx) = invalid then m.focusIdx = 0
    m.rings = {}
    m.parts = {}
    for each t in m.specs
        fill = CreateObject("roSGNode", "Poster")
        fill.uri = "pkg:/images/round-r32.9.png"
        fill.translation = [t.x, t.y]
        fill.width = t.w
        fill.height = t.h
        if t.ink = true
            fill.blendColor = ThemeColor("ink")
            ThemeSetRole(fill, "ink")
        else if t.primary
            fill.blendColor = ThemeColor("brand")
            ThemeSetRole(fill, "brand")
        else
            fill.blendColor = ThemeColor("surfaceStrong", 199)
            ThemeSetRole(fill, "surfaceStrong", 199)
        end if
        m.tilesGroup.AppendChild(fill)
        fill.id = tileSemantics(t)
        A11yStamp(fill, true)
        ic = invalid
        plus = invalid
        ' Web (global.css .tv-detail-play / .tv-detail-playback-settings): a glyph, the CSS gap, then the label, centred as a group in the
        ' pill. The glyph advance is the symbol font's own (hmtx units over unitsPerEm 2048: play 1575, sliders mark 1836) or Nunito Sans's
        ' plus; the gap is 0.65rem on the play pill and 0.55rem on the others.
        ' Font sizes are the CSS values: the pill's clamp(0.54rem, 0.62 * --vw, 0.78rem) and clamp(0.5rem, 0.58 * --vw, 0.72rem), the glyph span 0.85em (play) or 1.15em.
        playFont = WebClamp(8.64, 0.62 * WebVw(), 12.48)
        settingsFont = WebClamp(8.0, 0.58 * WebVw(), 11.52)
        glyphSize = 1.15 * settingsFont
        gw = PlayarrTextWidth("+", glyphSize, 400, 0)
        if t.icon = "nav-playlists.png" then gw = 1836 * glyphSize / 2048
        if t.icon = "player-play.png"
            glyphSize = 0.85 * playFont
            gw = 1575 * glyphSize / 2048
        end if
        labelSize = settingsFont
        if t.primary or t.ink = true then labelSize = playFont
        lw = PlayarrTextWidth(t.text, labelSize, 700, 0)
        gap = 0.55 * 16.0
        if t.ink = true then gap = 0.65 * 16.0
        startX = t.x + (t.w - (gw + gap + lw)) / 2
        centreY = t.y + t.h / 2
        glyphRole = "brandInk"
        labelRole = "ink"
        if t.primary
            glyphRole = "playerInk"
            labelRole = "playerInk"
        end if
        if t.ink = true
            glyphRole = "bg"
            labelRole = "bg"
        end if
        if t.icon <> ""
            ' The web draws these glyphs as text: play from the symbol font, the sliders mark for Playback.
            ch = "☷"
            if t.icon = "player-play.png" then ch = "▶"
            ' The glyph's span is a flex item one Nunito Sans line (PlayarrContentHeight) tall, centred on the pill; the web baseline falls
            ' Int(1.011 em + 0.5) below its top. The native symbol Label's baseline is its integer-size font ascent (hhea 1901 / 2048) below its top.
            rectH = PlayarrContentHeight(glyphSize)
            nativeAscent = (1901 * Int(glyphSize + 0.5) + 2047) \ 2048
            ic = CreateObject("roSGNode", "WebLabel")
            ic.setFields({ size: glyphSize, weight: 400, symbol: true })
            ic.text = ch
            ic.color = ThemeColor(glyphRole)
            ThemeSetRole(ic, glyphRole)
            ic.translation = [startX, centreY - rectH / 2 + Int(1.011 * glyphSize + 0.5) - nativeAscent]
            m.tilesGroup.AppendChild(ic)
        else
            plus = CreateObject("roSGNode", "WebLabel")
            plus.setFields({ size: glyphSize, weight: 400 })
            plus.text = "+"
            plus.color = ThemeColor("brandInk")
            ThemeSetRole(plus, "brandInk")
            plus.translation = [startX, centreY - PlayarrContentHeight(glyphSize) / 2]
            m.tilesGroup.AppendChild(plus)
        end if
        label = CreateObject("roSGNode", "WebLabel")
        label.setFields({ size: labelSize, weight: 700, height: 16 })
        label.text = t.text
        label.color = ThemeColor(labelRole)
        ThemeSetRole(label, labelRole)
        label.translation = [startX + gw + gap, centreY - PlayarrContentHeight(labelSize) / 2]
        m.tilesGroup.AppendChild(label)
        t.gw = gw
        t.gap = gap
        t.startX = startX
        t.glyphSize = glyphSize
        t.labelSize = labelSize
        t.lw = lw
        ring = CreateObject("roSGNode", "Poster")
        ring.uri = "pkg:/images/round-ring-r32.9.png"
        ring.translation = [t.x - 3, t.y - 3]
        ring.width = t.w + 6
        ring.height = t.h + 6
        ring.blendColor = ThemeColor("focusRing")
        ThemeSetRole(ring, "focusRing")
        ring.visible = false
        m.tilesGroup.AppendChild(ring)
        m.rings[t.id.ToStr()] = ring
        m.parts[t.id.ToStr()] = { fill: fill, icon: ic, label: label }
    end for
    applyFocus()
end sub

sub onLayoutChange()
    if m.tilesGroup = invalid then return
    buildTiles()
end sub

sub onFocusChange()
    applyFocus()
end sub

sub applyFocus()
    if m.rings = invalid then return
    on = m.top.isInFocusChain()
    for each key in m.rings
        m.rings[key].visible = on and key = m.focusIdx.ToStr()
    end for
    ' Web .tv-detail-play:focus-visible: the ink pill turns brand-strong with white text.
    for each key in m.parts
        t = specFor(key.toInt())
        if t <> invalid and t.ink = true
            hot = on and key = m.focusIdx.ToStr()
            t.hot = hot
            fillRole = "ink"
            textRole = "bg"
            if hot
                fillRole = "brandStrong"
                textRole = "playerInk"
            end if
            part = m.parts[key]
            part.fill.blendColor = ThemeColor(fillRole)
            ThemeSetRole(part.fill, fillRole)
            A11yStamp(part.fill, true)
            part.label.color = ThemeColor(textRole)
            ThemeSetRole(part.label, textRole)
            if part.icon <> invalid
                part.icon.color = ThemeColor(textRole)
                ThemeSetRole(part.icon, textRole)
            end if
        end if
    end for
end sub

function specFor(id as Integer) as Object
    for each t in m.specs
        if t.id = id then return t
    end for
    return invalid
end function

' Nearest tile in a direction (by centre), so Down from Play lands under it and Left/Right stay in the row.
function neighbour(dir as String) as Integer
    cur = specFor(m.focusIdx)
    if cur = invalid then return -1
    best = -1
    bestScore = 1.0e9
    for each t in m.specs
        if t.id <> cur.id
            dx = (t.x + t.w / 2) - (cur.x + cur.w / 2)
            dy = (t.y + t.h / 2) - (cur.y + cur.h / 2)
            ok = false
            score = 0.0
            if dir = "right" and dx > 20 and Abs(dy) < 40
                ok = true : score = dx
            else if dir = "left" and dx < -20 and Abs(dy) < 40
                ok = true : score = -dx
            else if dir = "down" and dy > 20
                ok = true : score = dy * 10 + Abs(dx)
            else if dir = "up" and dy < -20
                ok = true : score = -dy * 10 + Abs(dx)
            end if
            if ok and score < bestScore
                best = t.id
                bestScore = score
            end if
        end if
    end for
    return best
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "OK"
        if m.focusIdx = 0 and m.top.playMode = "unavailable" then return true
        m.top.itemSelected = m.focusIdx
        return true
    end if
    if key = "left" or key = "right" or key = "up" or key = "down"
        n = neighbour(key)
        if n >= 0
            m.focusIdx = n
            applyFocus()
            return true
        end if
        if key = "right" or key = "left" or key = "up" or key = "down" then return false
    end if
    return false
end function


' What the tile is for assistive tech, as `a11y|role|radius|name` on the drawn pill (ECP prints ids).
function tileSemantics(t as Object) as String
    title = m.top.workTitle
    if t.icon = "nav-playlists.png" then return "a11y|button|999|Playback settings for " + title
    if t.primary or t.ink = true
        if m.top.layoutKind = "series" then return "a11y|button|999|" + t.text + " " + title
        return "a11y|link|999|Play " + title
    end if
    return "a11y|button|999|" + t.text
end function

sub onWorkTitle()
    if m.parts = invalid then return
    for each key in m.parts
        t = specFor(key.toInt())
        if t <> invalid
            m.parts[key].fill.id = tileSemantics(t)
            A11yStamp(m.parts[key].fill, true)
        end if
    end for
end sub
