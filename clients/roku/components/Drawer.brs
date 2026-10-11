' Shared right-side drawer (web Drawer): a 360 px full-height panel with a kicker, a title, a close button and a column of
' action rows. One builder for every drawer; the title actions drawer below is its first user. The caller supplies the rows
' ({ id, label, glyph, icon }) and handles the chosen id in drawerChoose().

sub drawerOpen(kicker as String, title as String, items as Object, returnTo as String)
    if m.drawerGroup = invalid
        m.drawerGroup = CreateObject("roSGNode", "Group")
        m.drawerGroup.visible = false
        m.top.AppendChild(m.drawerGroup)
    end if
    g = m.drawerGroup
    g.removeChildrenIndex(g.getChildCount(), 0)
    m.drawerItems = items
    m.drawerIndex = 0
    m.drawerReturn = returnTo
    m.drawerOpen = true
    ' Dims the page behind the panel in either theme.
    pgRect(g, 0, 0, 1920, 1080, "bg", 110)
    pgRect(g, 1560, 0, 360, 1080, "panel")
    pgLabel(g, 1606, 56, 190, 16, UCase(kicker), 11, 700, "inkMuted")
    pgLabel(g, 1606, 82, 200, 110, title, 36, 600, "ink", { wrap: true, maxLines: 2 })
    pgRound(g, 1826, 54, 48, 48, 24, "surface", 179)
    pgRound(g, 1826, 54, 48, 48, 24, "line", -1, true)
    pgIcon(g, 1838, 66, 24, "player-close.png", "ink")
    m.drawerRings = []
    for i = 0 to items.Count() - 1
        y = 218 + 82 * i
        pgRound(g, 1602, y, 276, 68, 14, "surfaceSoft")
        icon = items[i].icon
        if icon = "plus"
            pgRect(g, 1625, y + 33, 18, 2, "brand")
            pgRect(g, 1633, y + 25, 2, 18, "brand")
        else if icon = "circle"
            pgRound(g, 1624, y + 24, 20, 20, 10, "brand", -1, true)
        else if icon <> invalid and icon <> ""
            pgIcon(g, 1624, y + 24, 20, icon, "brand")
        end if
        pgLabel(g, 1666, y, 200, 68, items[i].label, 19, 700, "ink", { vertAlign: "center" })
        ring = pgRound(g, 1599, y - 3, 282, 74, 16, "focusRing", -1, true)
        pgRound(g, 1600, y - 2, 280, 72, 15, "focusRing", -1, true)
        ring.visible = false
        m.drawerRings.Push(ring)
    end for
    g.visible = true
    m.top.SetFocus(true)
    parityEmit("screen", "drawer")
    drawerRenderFocus()
end sub

sub drawerRenderFocus()
    for i = 0 to m.drawerRings.Count() - 1
        m.drawerRings[i].visible = (i = m.drawerIndex)
    end for
    item = m.drawerItems[m.drawerIndex]
    parityEmit("focus", item.glyph + item.label)
end sub

function drawerOnKey(key as String) as Boolean
    if key = "up" and m.drawerIndex > 0
        m.drawerIndex = m.drawerIndex - 1
        drawerRenderFocus()
    else if key = "down" and m.drawerIndex < m.drawerItems.Count() - 1
        m.drawerIndex = m.drawerIndex + 1
        drawerRenderFocus()
    else if key = "OK"
        drawerChoose(m.drawerItems[m.drawerIndex].id)
    else if key = "back"
        drawerClose()
    end if
    return true
end function

sub drawerClose()
    m.drawerGroup.visible = false
    m.drawerOpen = false
    back = m.drawerReturn
    parityEmit("screen", back)
    if back = "home"
        focusCurrentHomeRail()
    else if back = "browse"
        m.browseGrid.SetFocus(true)
    else if back = "search"
        m.searchGrid.SetFocus(true)
    end if
end sub

' ---------------------------------------------------------------------------
' Title actions (web MediaContextMenu): long-press SELECT on a card, or the Info (*) key on Home. Download is not offered:
' Roku has no storage the channel can keep media in.

sub selectWork(work as Object, origin as String)
    m.pendingSelect = { work: work, origin: origin }
    if m.holdTimer = invalid
        m.holdTimer = CreateObject("roSGNode", "Timer")
        m.holdTimer.duration = 0.6
        m.holdTimer.repeat = false
        m.holdTimer.ObserveField("fire", "onSelectHeld")
    end if
    m.holdTimer.control = "stop"
    m.holdTimer.control = "start"
end sub

' A short press: the key came up before the timer fired.
sub selectWorkReleased()
    if m.pendingSelect = invalid then return
    m.holdTimer.control = "stop"
    pending = m.pendingSelect
    m.pendingSelect = invalid
    openWorkDetail(pending.work, pending.origin)
end sub

' A long press: the key is still down.
sub onSelectHeld()
    if m.pendingSelect = invalid then return
    pending = m.pendingSelect
    m.pendingSelect = invalid
    openActionsDrawer(pending.work, pending.origin)
end sub

sub openActionsDrawer(work as Object, origin as String)
    m.drawerWork = work
    items = [{ id: "play", label: "Play", glyph: "▶", icon: "player-play.png" }]
    items.Push({ id: "playlist", label: "Add to Playlist", glyph: "+", icon: "plus" })
    if work.kind = "movie"
        items.Push({ id: "watched", label: "Mark as Watched", glyph: "✓", icon: "check.png" })
        items.Push({ id: "unwatched", label: "Mark as Unwatched", glyph: "○", icon: "circle" })
    end if
    drawerOpen("Title actions", work.title, items, origin)
end sub

sub drawerChoose(id as String)
    work = m.drawerWork
    origin = m.drawerReturn
    drawerClose()
    if id = "playlist"
        m.selectedDetail = { work: work }
        m.currentMediaFileId = ""
        openDetailPlaylistPicker()
    else if work.kind <> "movie" and id = "play"
        openWorkDetail(work, origin)
    else
        m.actionPending = id
        m.detailOrigin = origin
        sendApi("actionDetail", "GET", "/api/v1/catalog/" + UrlEncode(work.id), invalid, true)
    end if
end sub

sub acceptActionDetail(data as Dynamic)
    id = m.actionPending
    m.actionPending = ""
    if data = invalid or data.media_file_id = invalid then return
    if id = "play"
        m.selectedDetail = { work: data.work }
        requestPlayback(data.media_file_id)
    else
        duration = 0
        if data.runtime_ms <> invalid then duration = data.runtime_ms
        position = 0
        if id = "watched" then position = duration
        sendApi("actionProgress", "PUT", "/api/v1/playback/" + UrlEncode(data.media_file_id) + "/progress", { position_ms: position, duration_ms: duration, completed: (id = "watched") }, true)
    end if
end sub
