' Pages.brs
'
' The web "page shell" screens on Roku: Watchlist, Requests, Release Calendar and Preferences (Settings). They share
' one builder: a header (round back button, title, the shell clock), an optional right-hand content panel and a list of
' focusable controls moved with the D-pad. Geometry, sizes, weights and colours come from the web DOM at 1920x1080
' (scripts/parity/capture-web.mjs --dump-dom). Colours are theme roles (Theme.brs), never literals.

sub pagesInit()
    browseChromeInit()
    edgeFadesInit()
    m.pageGroup = m.top.findNode("pageGroup")
    m.pageBg = m.top.findNode("pageBg")
    m.pageHead = m.top.findNode("pageHead")
    m.pageBody = m.top.findNode("pageBody")
    m.pageRing = m.top.findNode("pageRing")
    m.pagePanel = m.top.findNode("pagePanel")
    m.pagePanelFade = m.top.findNode("pagePanelFade")
    m.clientsStageBg = m.top.findNode("clientsStageBg")
    m.clientsStageChrome = m.top.findNode("clientsStageChrome")
    m.clientsStageLogo = m.top.findNode("clientsStageLogo")
    m.clientsThemePill = m.top.findNode("clientsThemePill")
    m.clientsThemeIcon = m.top.findNode("clientsThemeIcon")
    m.clientsThemeLabel = m.top.findNode("clientsThemeLabel")
    m.clientsThemeChevron = m.top.findNode("clientsThemeChevron")
    m.clientsLangPill = m.top.findNode("clientsLangPill")
    m.clientsLangIcon = m.top.findNode("clientsLangIcon")
    m.clientsLangLabel = m.top.findNode("clientsLangLabel")
    m.clientsLangChevron = m.top.findNode("clientsLangChevron")
    m.clientBubbles = []
    ThemeSetRole(m.pagePanel, "panel")
    ThemeSetRole(m.pagePanelFade, "panel")
    ThemeSetRole(m.pageRing, "focusRing")
    m.pageItems = []
    m.pageFocusIdx = 0
    m.pageKind = ""
    m.clientGuideOpen = false
    m.clientActiveId = ""
    m.clientsScrollBottom = 0
    m.pageData = invalid
    m.pageStatus = ""
    m.calendarAnchor = invalid
    m.calendarView = "month"
    m.calendarViewDialogPendingClose = false
    m.calendarKinds = []
    m.pageScrollY = 0
    m.settingsPanel = "appearance"
    m.artworkSizePref = "medium"
end sub

' ---------------------------------------------------------------------------
' Builders

function pgLabel(parent as Object, x as Float, y as Float, w as Float, h as Float, text as String, size as Integer, weight as Integer, role as String, opts = invalid as Dynamic) as Object
    label = CreateObject("roSGNode", "Label")
    label.translation = [x, y]
    if w > 0 then label.width = w
    label.height = h
    label.text = text
    label.font = PlayarrMakeFont(weight, size)
    label.color = ThemeColor(role)
    ThemeSetRole(label, role)
    label.vertAlign = "top"
    if opts <> invalid
        if opts.horizAlign <> invalid then label.horizAlign = opts.horizAlign
        if opts.vertAlign <> invalid then label.vertAlign = opts.vertAlign
        if opts.wrap = true
            label.wrap = true
            ' Roku adds the font's full line gap between wrapped lines; pull it back to the web's ~1.45 line height.
            label.lineSpacing = -Int(size * 0.6)
        end if
        if opts.maxLines <> invalid then label.maxLines = opts.maxLines
        if opts.lineSpacing <> invalid then label.lineSpacing = opts.lineSpacing
        if opts.mono = true then label.font = PlayarrMakeFont(weight, size, true)
    end if
    parent.AppendChild(label)
    return label
end function

function pgTrackedText(parent as Object, x as Float, y as Float, w as Float, text as String, size as Integer, weight as Integer, tracking as Float, role as String, upper = false as Boolean, horizAlign = "left" as String, maxLines = 1 as Integer, lineHeight = 0.0 as Float) as Object
    label = CreateObject("roSGNode", "TrackedText")
    label.translation = [x, y]
    spec = { text: text, size: size, weight: weight, tracking: tracking, role: role, upper: upper }
    if w > 0
        spec.width = w
        spec.horizAlign = horizAlign
        spec.maxLines = maxLines
        spec.lineHeight = lineHeight
    end if
    label.spec = spec
    parent.AppendChild(label)
    return label
end function

function pgRect(parent as Object, x as Float, y as Float, w as Float, h as Float, role as String, alpha = -1 as Integer) as Object
    rect = CreateObject("roSGNode", "Rectangle")
    rect.translation = [x, y]
    rect.width = w
    rect.height = h
    rect.color = ThemeColor(role, alpha)
    ThemeSetRole(rect, role, alpha)
    parent.AppendChild(rect)
    return rect
end function

function pgRadiusFor(h as Float, r as Float) as Integer
    if r >= 82 then return 82
    if r >= 25 then return 25
    if r >= 12 then return 12
    return 6
end function

' Rounded rectangle (9-patch white mask tinted by `role`). outline: draw only a 1px outline.
function pgRound(parent as Object, x as Float, y as Float, w as Float, h as Float, r as Float, role as String, alpha = -1 as Integer, outline = false as Boolean) as Object
    poster = CreateObject("roSGNode", "Poster")
    radius = pgRadiusFor(h, r)
    smallest = h
    if w < smallest then smallest = w
    if radius = 82 and smallest < 160 then radius = 25
    if radius = 25 and smallest < 49 then radius = 12
    if radius = 12 and smallest < 23 then radius = 6
    name = "round"
    if outline then name = "round-outline"
    poster.uri = "pkg:/images/" + name + "-r" + radius.ToStr() + ".9.png"
    poster.translation = [x, y]
    poster.width = w
    poster.height = h
    poster.blendColor = ThemeColor(role, alpha)
    ThemeSetRole(poster, role, alpha)
    parent.AppendChild(poster)
    return poster
end function

function pgIcon(parent as Object, x as Float, y as Float, size as Integer, file as String, role as String, alpha = -1 as Integer) as Object
    poster = CreateObject("roSGNode", "Poster")
    poster.uri = "pkg:/images/" + file
    poster.translation = [x, y]
    poster.width = size
    poster.height = size
    poster.blendColor = ThemeColor(role, alpha)
    ThemeSetRole(poster, role, alpha)
    parent.AppendChild(poster)
    return poster
end function

function pgArtwork(parent as Object, x as Float, y as Float, w as Float, h as Float, url as String) as Object
    poster = CreateObject("roSGNode", "Poster")
    poster.translation = [x, y]
    poster.width = w
    poster.height = h
    poster.loadDisplayMode = "scaleToZoom"
    if url <> ""
        agent = CreateObject("roHttpAgent")
        agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
        agent.InitClientCertificates()
        g = GetGlobalAA()
        if g.playarrArtHeaders <> invalid then agent.SetHeaders(g.playarrArtHeaders)
        poster.SetHttpAgent(agent)
        poster.uri = url
    end if
    parent.AppendChild(poster)
    return poster
end function

' Register a focusable control (rect in canvas px) with an action name and optional payload.
sub pgFocusable(x as Float, y as Float, w as Float, h as Float, r as Float, action as String, data = invalid as Dynamic, scrolls = false as Boolean)
    m.pageItems.Push({ x: x, y: y, w: w, h: h, r: r, action: action, data: data, scrolls: scrolls })
end sub

' Pill button: width from the text. style "primary" (accent fill) or "secondary" (outlined). Returns the width.
function pgButtonWidth(parent as Object, text as String, padX as Float, h as Float, fontSize = 15 as Integer, fontWeight = 700 as Integer) as Float
    probe = pgLabel(parent, 0, 0, 0, h, text, fontSize, fontWeight, "inkSoft")
    textW = probe.boundingRect().width
    parent.removeChild(probe)
    return textW + padX * 2
end function

function pgButton(parent as Object, x as Float, y as Float, h as Float, text as String, style as String, action as String, data = invalid as Dynamic, padX = 21 as Float, scrolls = false as Boolean, fontSize = 15 as Integer, fontWeight = 700 as Integer) as Float
    w = pgButtonWidth(parent, text, padX, h, fontSize, fontWeight)
    textRole = "inkSoft"
    if style = "primary"
        pgRound(parent, x, y, w, h, h / 2, "accent")
        textRole = "onAccent"
    else
        pgRound(parent, x, y, w, h, h / 2, "surface")
        pgRound(parent, x, y, w, h, h / 2, "line", -1, true)
    end if
    pgLabel(parent, x, y, w, h, text, fontSize, fontWeight, textRole, { horizAlign: "center", vertAlign: "center" })
    pgFocusable(x, y, w, h, h / 2, action, data, scrolls)
    return w
end function

' App-shell action column: every button that opens a side panel or creates something is a tile in ONE column at the right of the
' shell, stacked vertically (web .tv-filter-launcher stack); pages register their actions and never place them per page.
function shellActionX() as Float
    return 1845.5
end function

function shellActionY(slot as Integer) as Float
    return 151.2 + 84.9 * slot
end function

' Header action tile (web .tv-filter-launcher, the 30 September reference): 62 x 72, radius 14, a 1px line, an icon over a
' tiny label. Used for every header action (Calendar link, Filters).
sub pgTile(parent as Object, x as Float, y as Float, label as String, icon as String, action as String, data = invalid as Dynamic)
    pgRound(parent, x, y, 62, 72, 14, "surfaceStrong", 199)
    pgRound(parent, x, y, 62, 72, 14, "line", -1, true)
    pgIcon(parent, x + 20, y + 15, 22, icon, "inkMuted")
    pgLabel(parent, x, y + 44, 62, 14, label, 8, 800, "inkMuted", { horizAlign: "center" })
    pgFocusable(x, y, 62, 72, 14, action, data)
end sub

' Shell header shared by every page: round back button, title; panelX is where the right-hand panel starts (0 = none).
sub pageBegin(title as String, panelX as Float)
    clientsPage = m.pageKind = "clients"
    m.pageBody.removeChildrenIndex(m.pageBody.getChildCount(), 0)
    m.pageHead.removeChildrenIndex(m.pageHead.getChildCount(), 0)
    m.pageItems = []
    if m.pageKeepScroll <> true
        m.pageScrollY = 0
        m.pageScrollX = 0
        m.pageBody.translation = [0, 0]
    end if
    m.pagePanel.visible = panelX > 0
    m.pagePanelFade.visible = panelX > 0
    if panelX > 0
        m.pagePanelFade.translation = [panelX, 0]
        m.pagePanel.translation = [panelX + 260, 0]
        m.pagePanel.width = 1920 - panelX - 260
    end if
    if m.pageBg <> invalid then m.pageBg.visible = not clientsPage
    if m.clientsStageBg <> invalid then m.clientsStageBg.visible = clientsPage
    if m.clientsStageChrome <> invalid then m.clientsStageChrome.visible = clientsPage
    backX = 153.6
    if clientsPage then backX = 0
    pgRound(m.pageHead, backX, 56.3, 50, 50, 25, "surface", 179)
    pgRound(m.pageHead, backX, 56.3, 50, 50, 25, "line", -1, true)
    pgIcon(m.pageHead, backX + 16.4, 73, 17, "arrow-left.png", "inkSoft")
    pgFocusable(backX, 56.3, 50, 50, 25, "back")
    if clientsPage
        pgFocusable(1552, 50, 144, 48, 24, "clientsTheme")
        pgFocusable(1710, 50, 168, 48, 24, "clientsLanguage")
        applyClientsChrome()
    else
        pgLabel(m.pageHead, 226.6, 56.2, 900, 50, title, 34, 600, "ink", { vertAlign: "center" })
    end if
end sub

sub pageEmptyState(x as Float, title as String, description as String)
    pgRound(m.pageBody, x, 89.6, 164, 164, 82, "surface", 138)
    pgRound(m.pageBody, x, 89.6, 164, 164, 82, "line", -1, true)
    pgIcon(m.pageBody, x + 62, 150, 40, "icon-empty.png", "brand")
    pgLabel(m.pageBody, x + 206, 133, 460, 36, title, 22, 700, "ink")
    pgLabel(m.pageBody, x + 206, 174, 230, 34, description, 11, 400, "inkMuted", { wrap: true, maxLines: 2 })
end sub

' ---------------------------------------------------------------------------
' Focus

sub pageFocusRender()
    if m.pageItems.Count() = 0
        m.pageRing.visible = false
        return
    end if
    if m.pageFocusIdx >= m.pageItems.Count() then m.pageFocusIdx = 0
    item = m.pageItems[m.pageFocusIdx]
    if item.scrolls = true
        ' Keep the focused control inside the visible band (the panel scrolls under the fixed header).
        top = item.y + m.pageScrollY
        bottom = item.y + item.h + m.pageScrollY
        if bottom > 1030 then m.pageScrollY = m.pageScrollY - (bottom - 1030)
        if top < 140 and m.pageScrollY < 0 then m.pageScrollY = m.pageScrollY + (140 - top)
        if m.pageScrollY > 0 then m.pageScrollY = 0
        m.pageBody.translation = [0, m.pageScrollY]
    end if
    ox = 0
    if item.sx = true
        ' Week view: scroll the columns sideways so the focused card stays on screen.
        if m.pageScrollX = invalid then m.pageScrollX = 0
        if item.x + item.w + m.pageScrollX > 1850 then m.pageScrollX = 1850 - (item.x + item.w)
        if item.x + m.pageScrollX < 154 then m.pageScrollX = 154 - item.x
        if m.pageScrollX > 0 then m.pageScrollX = 0
        m.pageBody.translation = [m.pageScrollX, m.pageBody.translation[1]]
        ox = m.pageScrollX
    else if m.pageScrollX <> invalid and m.pageScrollX <> 0 and m.pageKind = "calendar" and m.calendarView <> "week"
        m.pageScrollX = 0
        m.pageBody.translation = [0, m.pageBody.translation[1]]
    end if
    oy = 0
    if item.scrolls = true then oy = m.pageScrollY
    bottom = 0.0
    for each it in m.pageItems
        if it.scrolls = true and it.y + it.h > bottom then bottom = it.y + it.h
    end for
    if m.pageKind = "clients"
        m.pageFadeTop.visible = false
        m.pageFadeBottom.visible = false
    else
        pageFadesUpdate(bottom)
    end if
    radius = 25
    if item.r < 25 then radius = 12
    if m.pageKind = "clients"
        if item.action = "clientChoice" or item.action = "clientActive"
            m.pageRing.uri = "pkg:/images/clients-focus-ring.png"
        else
            m.pageRing.uri = "pkg:/images/round-ring-r" + radius.ToStr() + ".9.png"
        end if
        m.pageRing.translation = [item.x + ox - 5, item.y + oy - 5]
        m.pageRing.width = item.w + 10
        m.pageRing.height = item.h + 10
    else
        m.pageRing.uri = "pkg:/images/round-ring-r" + radius.ToStr() + ".9.png"
        m.pageRing.translation = [item.x + ox - 3, item.y + oy - 3]
        m.pageRing.width = item.w + 6
        m.pageRing.height = item.h + 6
    end if
    if m.pageKind = "calendar"
        focusX = item.x + ox
        focusY = item.y + oy
        parityEmit("calendarFocus", item.action + "|" + focusX.ToStr() + "," + focusY.ToStr() + "," + item.w.ToStr() + "," + item.h.ToStr())
    end if
    m.pageRing.visible = not m.navDockMode
    pageOnFocus(item)
end sub

sub pageOnFocus(item as Object)
    if m.pageKind = "calendar" and item.action = "entry"
        if m.calendarSelected <> item.data
            m.calendarSelected = item.data
            ' Re-render, keeping focus on the same entry.
            focusKey = item.data
            m.pageKeepScroll = true
            renderCalendar()
            m.pageKeepScroll = false
            for i = 0 to m.pageItems.Count() - 1
                if m.pageItems[i].action = "entry" and m.pageItems[i].data = focusKey then m.pageFocusIdx = i
            end for
            pageFocusRender()
        end if
    end if
end sub

function pageMoveFocus(dir as String) as Boolean
    if m.pageItems.Count() = 0 then return false
    cur = m.pageItems[m.pageFocusIdx]
    cx = cur.x + cur.w / 2
    cy = cur.y + cur.h / 2
    best = -1
    bestScore = 1000000.0
    forwardDeadZone = 4
    if m.pageKind = "calendar" then forwardDeadZone = 2
    for i = 0 to m.pageItems.Count() - 1
        if i <> m.pageFocusIdx
            it = m.pageItems[i]
            ix = it.x + it.w / 2
            iy = it.y + it.h / 2
            dx = ix - cx
            dy = iy - cy
            ok = false
            primary = 0.0
            cross = 0.0
            if dir = "right" and dx > forwardDeadZone
                ok = true : primary = dx : cross = Abs(dy)
            else if dir = "left" and dx < -forwardDeadZone
                ok = true : primary = -dx : cross = Abs(dy)
            else if dir = "down" and dy > forwardDeadZone
                ok = true : primary = dy : cross = Abs(dx)
            else if dir = "up" and dy < -forwardDeadZone
                ok = true : primary = -dy : cross = Abs(dx)
            end if
            if ok
                if m.pageKind = "calendar"
                    overlapStart = cur.y
                    overlapEnd = cur.y + cur.h
                    crossAxisSize = cur.h
                    if dir = "up" or dir = "down"
                        overlapStart = cur.x
                        overlapEnd = cur.x + cur.w
                        candidateStart = it.x
                        candidateEnd = it.x + it.w
                        crossAxisSize = cur.w
                        if it.w < crossAxisSize then crossAxisSize = it.w
                    else
                        candidateStart = it.y
                        candidateEnd = it.y + it.h
                        if it.h < crossAxisSize then crossAxisSize = it.h
                    end if
                    if candidateStart > overlapStart then overlapStart = candidateStart
                    if candidateEnd < overlapEnd then overlapEnd = candidateEnd
                    overlap = overlapEnd - overlapStart
                    if overlap < 0 then overlap = 0
                    coneAllowance = primary * 0.85 + crossAxisSize * 0.2
                    if overlap <= 0 and cross > coneAllowance then
                        ok = false
                    else
                        if overlap > 180 then overlap = 180
                        score = primary + cross * 4 - overlap * 0.55
                    end if
                else
                    score = primary + cross * 2.5
                end if
            end if
            if ok
                if score < bestScore
                    bestScore = score
                    best = i
                end if
            end if
        end if
    end for
    if best < 0 then return false
    m.pageFocusIdx = best
    pageFocusRender()
    return true
end function

function pageOnKey(key as String) as Boolean
    if m.navDockMode = true
        if key = "up" then return moveNavDockFocus(-1)
        if key = "down" then return moveNavDockFocus(1)
        if key = "right"
            m.navDockMode = false
            renderNavDockFocus()
            pageFocusRender()
            return true
        end if
        if key = "left" then return true
        if key = "OK"
            selectNavDockItem()
            return true
        end if
        if key = "back"
            m.navDockMode = false
            renderNavDockFocus()
            pageFocusRender()
            return true
        end if
        return false
    end if
    if key = "back"
        if m.pageKind = "household"
            loadProfiles()
        else if m.pageKind = "clients"
            if m.clientGuideOpen
                leaveClientDetailsToClientList()
            else
                leaveClientsToProfiles()
            end if
        else
            pageLeaveToHome()
        end if
        return true
    end if
    if key = "OK"
        if m.pageItems.Count() > 0 then pageActivate(m.pageItems[m.pageFocusIdx])
        return true
    end if
    if key = "up" or key = "down" or key = "left" or key = "right"
        if m.pageKind = "clients" and m.pageItems.Count() > 0
            action = m.pageItems[m.pageFocusIdx].action
            if action = "back" or action = "clientsTheme" or action = "clientsLanguage"
                if key = "right"
                    if action = "back"
                        focusClientsHeader("clientsTheme")
                    else if action = "clientsTheme"
                        focusClientsHeader("clientsLanguage")
                    end if
                    return true
                else if key = "left"
                    if action = "clientsLanguage"
                        focusClientsHeader("clientsTheme")
                    else if action = "clientsTheme"
                        focusClientsHeader("back")
                    end if
                    return true
                else if key = "down"
                    if action = "back" or action = "clientsTheme" or action = "clientsLanguage"
                        if m.clientGuideOpen and m.clientActiveId <> invalid
                            focusClientTile(m.clientActiveId)
                        else
                            m.pageFocusIdx = 3
                            pageFocusRender()
                        end if
                    end if
                    return true
                end if
                return true
            end if
            if key = "up" and (action = "clientChoice" or action = "clientActive") and m.pageItems[m.pageFocusIdx].y < 500
                focusClientsHeader("clientsTheme")
                return true
            end if
            if action = "clientActive" and (key = "left" or key = "right")
                direction = -1
                if key = "right" then direction = 1
                changeClientSelection(direction)
                return true
            end if
        end if
        if pageMoveFocus(key) then return true
        if m.pageKind = "clients" and m.clientGuideOpen and (key = "up" or key = "down")
            scrollClientDetails(key)
            return true
        end if
        if key = "left"
            if m.pageKind = "clients" then return true
            m.navDockMode = true
            m.navDockIndex = activeNavDockIndex()
            if m.navDockIndex < 0 then m.navDockIndex = firstEnabledNavIndex()
            renderNavDockFocus()
            m.pageRing.visible = false
        end if
        return true
    end if
    return false
end function

sub scrollClientDetails(direction as String)
    if m.clientsScrollBottom = invalid then return
    maxScroll = m.clientsScrollBottom - 1030
    if maxScroll < 0 then return
    oldY = m.pageScrollY
    if direction = "down"
        m.pageScrollY = m.pageScrollY - 300
    else
        m.pageScrollY = m.pageScrollY + 300
    end if
    if m.pageScrollY < -maxScroll then m.pageScrollY = -maxScroll
    if m.pageScrollY > 0 then m.pageScrollY = 0
    delta = m.pageScrollY - oldY
    m.pageBody.translation = [0, m.pageScrollY]
    if m.pageRing <> invalid and m.pageRing.visible
        ringY = m.pageRing.translation[1]
        m.pageRing.translation = [m.pageRing.translation[0], ringY + delta]
    end if
end sub

sub pageActivate(item as Object)
    action = item.action
    if action = "back"
        if m.pageKind = "clients"
            if m.clientGuideOpen
                leaveClientDetailsToClientList()
            else
                leaveClientsToProfiles()
            end if
        else
            pageLeaveToHome()
        end if
    else if m.pageKind = "watchlist"
        watchlistAction(item)
    else if m.pageKind = "calendar"
        calendarAction(item)
    else if m.pageKind = "settings"
        settingsAction(item)
    else if m.pageKind = "customise"
        customiseAction(item)
    else if m.pageKind = "household"
        householdAction(item)
    else if m.pageKind = "clients" and item.action = "clientsTheme"
        openPairingThemePicker()
    else if m.pageKind = "clients" and item.action = "clientsLanguage"
        openPairingLanguagePicker()
    else if m.pageKind = "clients" and action = "clientChoice"
        showClientDetails(item.data)
    else if m.pageKind = "clients" and action = "clientOpenLink"
        showClientLinkDialog(item.data)
    else if m.pageKind = "clients" and action = "clientsGuideInfo"
        showClientLinkDialog({ title: "Roku official developer guide", url: "https://developer.roku.com/dev/docs/developer-setup" })
    end if
end sub

' ---------------------------------------------------------------------------
' Entry points

sub openPage(kind as String)
    m.pageKind = kind
    if kind = "clients"
        m.clientGuideOpen = false
        m.clientActiveId = ""
        m.clientsContentBottom = 0
        m.clientsScrollBottom = 0
    end if
    parityEmit("page", kind)
    m.pageData = invalid
    m.pageStatus = "loading"
    showOnly("page")
    m.top.screenState = "page"
    renderNavDockFocus()
    m.pageFocusIdx = 0
    if kind = "watchlist"
        renderWatchlist()
        sendApi("watchlist", "GET", "/api/v1/watchlist", invalid, true)
    else if kind = "requests"
        renderRequests()
        sendApi("requests", "GET", "/api/v1/requests", invalid, true)
    else if kind = "calendar"
        m.calendarAnchor = invalid
        m.calendarView = "month"
        parityEmit("calendarView", m.calendarView)
        m.calendarFocusAction = ""
        m.calendarPlaceFirst = true
        m.calendarSelected = ""
        loadCalendar()
        renderCalendar()
    else if kind = "household"
        m.householdNote = ""
        renderHousehold()
    else if kind = "customise"
        renderCustomise()
        sendApi("railPrefs", "GET", "/api/v1/home/rails/preferences?lang=en", invalid, true)
    else if kind = "settings"
        sendApi("selfCaps", "GET", "/api/v1/users/me/capabilities", invalid, true)
        m.settingsPanel = "appearance"
        renderSettings()
        pageSettingsFocusDefault()
    else if kind = "clients"
        m.pageStatus = "ready"
        m.clientGuideOpen = false
        m.clientActiveId = ""
        renderClientsIndex()
    end if
    pageFocusRender()
    m.top.SetFocus(true)
end sub

' Page data arrives through onApiResult.
sub acceptPageData(action as String, data as Dynamic)
    if m.top.screenState <> "page" then return
    m.pageStatus = "ready"
    if action = "watchlist" and m.pageKind = "watchlist"
        m.pageData = data
        renderWatchlist()
    else if action = "requests" and m.pageKind = "requests"
        m.pageData = data
        renderRequests()
    else if action = "railPrefs" and m.pageKind = "customise"
        m.pageData = data
        renderCustomise()
    else if action = "calendar" and m.pageKind = "calendar"
        m.pageData = data
        m.calendarSelected = ""
        renderCalendar()
    end if
    pageFocusRender()
end sub

sub acceptPageFailure(action as String, result as Object)
    if m.top.screenState <> "page" then return
    m.pageStatus = "error"
    m.pageError = result.error
    if m.pageKind = "watchlist" then renderWatchlist()
    if m.pageKind = "requests" then renderRequests()
    if m.pageKind = "calendar" then renderCalendar()
    pageFocusRender()
end sub

' ---------------------------------------------------------------------------
' Watchlist and Requests (web TvEmptyState page with list rows)

function pageListItems(data as Dynamic) as Object
    if data = invalid then return []
    if GetInterface(data, "ifArray") <> invalid then return data
    if data.items <> invalid then return data.items
    return []
end function

sub renderWatchlist()
    pageBegin("Watchlist", 729.6)
    items = pageListItems(m.pageData)
    if m.pageStatus = "loading"
        pgLabel(m.pageBody, 912, 133, 600, 30, "Loading your watchlist…", 14, 400, "inkMuted")
    else if m.pageStatus = "error"
        pageEmptyState(911, "Couldn’t load your watchlist", m.pageError)
    else if items.Count() = 0
        pageEmptyState(911, "Your watchlist is empty", "Add titles from search or a title page to keep them here on every device.")
    else
        y = 96.0
        for each entry in items
            if y > 980 then exit for
            title = entry.title
            pgRound(m.pageBody, 786, y, 1048, 100, 12, "surfaceStrong")
            pgLabel(m.pageBody, 820, y + 18, 640, 30, title.title, 19, 700, "ink")
            meta = ""
            if title.year <> invalid then meta = title.year.ToStr()
            pgLabel(m.pageBody, 820, y + 56, 640, 24, meta, 13, 400, "inkMuted")
            pgButton(m.pageBody, 1580, y + 22, 56, "Open", "secondary", "wlOpen", entry)
            pgButton(m.pageBody, 1690, y + 22, 56, "Remove", "secondary", "wlRemove", entry)
            y = y + 116
        end for
    end if
end sub

sub watchlistAction(item as Object)
    entry = item.data
    if entry = invalid then return
    if item.action = "wlRemove"
        sendApi("watchlistRemove", "DELETE", "/api/v1/watchlist/" + UrlEncode(entry.title.title_key), invalid, true)
    else if item.action = "wlOpen"
        wid = invalid
        if entry.actions <> invalid
            for each a in entry.actions
                if a.work_id <> invalid and wid = invalid then wid = a.work_id
            end for
        end if
        if wid <> invalid then openWorkDetail({ id: wid, title: entry.title.title, kind: entry.title.kind }, "home")
    end if
end sub

sub renderRequests()
    pageBegin("Requests", 729.6)
    items = pageListItems(m.pageData)
    if m.pageStatus = "loading"
        pgLabel(m.pageBody, 924, 133, 600, 30, "Loading your requests…", 14, 400, "inkMuted")
    else if m.pageStatus = "error"
        pageEmptyState(923, "Couldn’t load your requests", m.pageError)
    else if items.Count() = 0
        pageEmptyState(923, "No requests yet", "Request a title that is not in the library and its progress shows up here.")
    else
        y = 96.0
        for each req in items
            if y > 980 then exit for
            pgRound(m.pageBody, 786, y, 1048, 100, 12, "surfaceStrong")
            pgLabel(m.pageBody, 820, y + 18, 900, 30, req.title, 19, 700, "ink")
            meta = requestStatusLabel(req.status)
            if req.year <> invalid then meta = req.year.ToStr() + "  ·  " + meta
            if req.requested_by <> invalid
                if req.mine = true
                    meta = meta + "  ·  by you"
                else
                    meta = meta + "  ·  by " + req.requested_by
                end if
            end if
            pgLabel(m.pageBody, 820, y + 56, 900, 24, meta, 13, 400, "inkMuted")
            y = y + 116
        end for
    end if
end sub

function requestStatusLabel(status as Dynamic) as String
    if status = "pending" then return "Pending"
    if status = "approved" then return "Approved"
    if status = "declined" then return "Declined"
    if status = "available" then return "Available"
    if status = "failed" then return "Failed"
    return "Unknown"
end function

' The Web /clients index is a standalone 4-column bubble grid, not an authenticated app-shell page.
sub applyClientsChrome()
    if m.clientsStageBg = invalid then return
    isLight = ResolvePairingTheme(m.themePreference) = "light"
    m.clientsStageBg.uri = "pkg:/images/profiles-bg.png"
    if isLight then m.clientsStageBg.uri = "pkg:/images/profiles-bg-light.png"
    tokens = ThemeTokens(ResolvePairingTheme(m.themePreference))
    if m.clientsThemeLabel <> invalid
        m.clientsThemeLabel.text = PairingThemeChromeLabel(m.themePreference, ResolvePairingLanguage(m.languagePreference))
        m.clientsThemeLabel.color = tokens.ink
        ThemeSetRole(m.clientsThemeLabel, "ink")
    end if
    if m.clientsLangLabel <> invalid
        m.clientsLangLabel.text = PairingLanguageChromeLabel(m.languagePreference)
        m.clientsLangLabel.color = tokens.ink
        ThemeSetRole(m.clientsLangLabel, "ink")
    end if
    suffix = ""
    if isLight then suffix = "-light"
    if m.clientsThemeIcon <> invalid then m.clientsThemeIcon.uri = "pkg:/images/pairing-icon-theme" + suffix + ".png"
    if m.clientsLangIcon <> invalid then m.clientsLangIcon.uri = "pkg:/images/pairing-icon-lang" + suffix + ".png"
    if m.clientsThemeChevron <> invalid then m.clientsThemeChevron.uri = "pkg:/images/pairing-icon-chevron" + suffix + ".png"
    if m.clientsLangChevron <> invalid then m.clientsLangChevron.uri = "pkg:/images/pairing-icon-chevron" + suffix + ".png"
    if m.clientsThemePill <> invalid then m.clientsThemePill.uri = pairingChromeUri("theme", false)
    if m.clientsLangPill <> invalid then m.clientsLangPill.uri = pairingChromeUri("lang", false)

    for each bubble in m.clientBubbles
        if bubble.fill <> invalid then ThemeSetRole(bubble.fill, "surfaceStrong")
        if bubble.border <> invalid
            line = ThemeColor("lineStrong")
            borderAlpha = Int((line and &hFF) * 0.66)
            bubble.border.blendColor = ThemeWithAlpha(line, borderAlpha)
        end if
        if bubble.icon <> invalid then bubble.icon.blendColor = clientPlatformIconColor(bubble.id)
    end for
end sub

function clientPlatformIconRole(clientId as String) as String
    if clientId = "vidaa" then return "brand"
    if clientId = "android" then return "clientAndroid"
    if clientId = "apple" or clientId = "harmony" or clientId = "server" then return "ink"
    if clientId = "webos" then return "clientWebOS"
    if clientId = "tizen" then return "clientTizen"
    if clientId = "roku" then return "clientRoku"
    if clientId = "chromecast" then return "clientChromecast"
    if clientId = "xbox" then return "clientXbox"
    if clientId = "firetv" then return "clientFireTV"
    return "ink"
end function

function clientPlatformIconColor(clientId as String) as Integer
    return ThemeColor(clientPlatformIconRole(clientId))
end function

sub centerClientsKicker()
    if m.clientsKicker = invalid then return
    width = m.clientsKicker.textWidth
    if width > 0 then m.clientsKicker.translation = [Int((1920 - width) / 2), 188]
end sub

sub centerClientsTitle()
    if m.clientsTitle = invalid then return
    width = m.clientsTitle.textWidth
    if width > 0 then m.clientsTitle.translation = [Int((1920 - width) / 2), 198]
end sub

' Web's shared client order is used for both the four-column landing grid and the detail coverflow.
function clientsIds() as Object
    return ["vidaa", "android", "apple", "webos", "tizen", "roku", "chromecast", "xbox", "harmony", "firetv", "server"]
end function

function clientsIndexOf(clientId as String) as Integer
    ids = clientsIds()
    for i = 0 to ids.Count() - 1
        if ids[i] = clientId then return i
    end for
    return -1
end function

function clientCoverflowPosition(offset as Integer) as Float
    magnitude = Abs(offset)
    position = 0.0
    stepSize = 1.0
    for i = 0 to magnitude - 1
        position = position + stepSize
        stepSize = stepSize * 0.55
    end for
    if offset < 0 then position = -position
    return position
end function

function clientCoverflowScale(offset as Integer) as Float
    magnitude = Abs(offset)
    if magnitude = 0 then return 1.22
    scale = 0.87 - (magnitude - 1) * 0.13
    if scale < 0.4 then scale = 0.4
    return scale
end function

sub drawClientBubble(clientId as String, x as Float, y as Float, size as Float)
    fill = CreateObject("roSGNode", "Poster")
    fill.uri = "pkg:/images/clients-bubble.png"
    fill.translation = [x, y]
    fill.width = size
    fill.height = size
    fill.blendColor = ThemeColor("surfaceStrong")
    ThemeSetRole(fill, "surfaceStrong")
    m.pageBody.AppendChild(fill)

    border = CreateObject("roSGNode", "Poster")
    border.uri = "pkg:/images/clients-bubble-border.png"
    border.translation = [x, y]
    border.width = size
    border.height = size
    m.pageBody.AppendChild(border)

    icon = CreateObject("roSGNode", "Poster")
    icon.uri = "pkg:/images/client-icon-" + clientId + ".png"
    iconSize = size * 0.48
    if clientId = "harmony" then iconSize = size * 0.62
    icon.translation = [x + (size - iconSize) / 2, y + (size - iconSize) / 2]
    icon.width = iconSize
    icon.height = iconSize
    icon.blendColor = clientPlatformIconColor(clientId)
    m.pageBody.AppendChild(icon)
    m.clientBubbles.Push({ id: clientId, fill: fill, border: border, icon: icon })
end sub

sub renderClientTrack(activeId as String)
    ids = clientsIds()
    if activeId = ""
        columns = 4
        rows = 3
        tileSize = 220.0
        pitch = 286.0
        for i = 0 to ids.Count() - 1
            row = Int(i / columns)
            col = i - row * columns
            itemsInRow = columns
            if row = rows - 1 then itemsInRow = ids.Count() - row * columns
            offsetX = col - (itemsInRow - 1) / 2.0
            offsetY = row - (rows - 1) / 2.0
            x = 960 + offsetX * pitch - tileSize / 2
            y = 770 + offsetY * pitch - tileSize / 2
            drawClientBubble(ids[i], x, y, tileSize)
            pgFocusable(x, y, tileSize, tileSize, tileSize / 2, "clientChoice", ids[i], true)
        end for
        return
    end if

    selected = clientsIndexOf(activeId)
    total = ids.Count()
    tileSize = 220.0
    spacing = tileSize * 1.15
    for layer = 5 to 0 step -1
        offsets = [0]
        if layer > 0 then offsets = [-layer, layer]
        for each offset in offsets
            idx = selected + offset
            while idx < 0
                idx = idx + total
            end while
            while idx >= total
                idx = idx - total
            end while
            size = tileSize * clientCoverflowScale(offset)
            x = 960 + clientCoverflowPosition(offset) * spacing - size / 2
            y = 494 - size / 2
            drawClientBubble(ids[idx], x, y, size)
            if offset = 0
                pgFocusable(x, y, size, size, size / 2, "clientActive", activeId, true)
            end if
        end for
    end for
end sub

sub renderClientsHeader()
    m.clientsKicker = CreateObject("roSGNode", "TrackedText")
    m.clientsKicker.ObserveField("textWidth", "centerClientsKicker")
    m.clientsKicker.spec = { text: "PLAYARR CLIENTS", size: 12, weight: 760, tracking: 2.16, role: "inkMuted", upper: true }
    m.clientsKicker.translation = [890, 188]
    centerClientsKicker()
    m.pageBody.AppendChild(m.clientsKicker)

    m.clientsTitle = CreateObject("roSGNode", "TrackedText")
    m.clientsTitle.ObserveField("textWidth", "centerClientsTitle")
    m.clientsTitle.spec = { text: "Watch your way.", size: 81, weight: 500, tracking: -5.83, role: "ink" }
    m.clientsTitle.translation = [700, 198]
    centerClientsTitle()
    m.pageBody.AppendChild(m.clientsTitle)
end sub

sub renderClientsIndex()
    pageBegin("", 0)
    m.clientBubbles = []
    renderClientsHeader()
    renderClientTrack("")
    applyClientsChrome()
    m.pageFocusIdx = 3 ' Back, theme and language precede the default first platform.
    pageFocusRender()
end sub

function clientMetadata(clientId as String) as Object
    data = { name: "", platform: "", description: "", status: "Coming soon" }
    if clientId = "vidaa"
        data = { name: "Hisense VIDAA", platform: "Hisense smart TVs", description: "The hosted custom store can add a Playarr launcher tile when used with a compatible DNS or interception setup.", status: "Available · Experimental install" }
    else if clientId = "android"
        data = { name: "Android", platform: "Phones, tablets and TVs", description: "The same responsive APK detects phones, tablets, Android TV and Google TV, then selects touch or remote navigation automatically.", status: "Available" }
    else if clientId = "apple"
        data = { name: "Apple", platform: "iPhone, iPad and Apple TV", description: "The native Apple client is coming soon; a distributable signed release is not available yet.", status: "Coming soon" }
    else if clientId = "webos"
        data = { name: "LG webOS", platform: "LG smart TVs", description: "The webOS app packages Playarr's full TV interface, server pairing, remote navigation and playback in an installable IPK for LG televisions.", status: "Available · Developer preview" }
    else if clientId = "tizen"
        data = { name: "Samsung Tizen", platform: "Samsung smart TVs", description: "The Tizen app packages Playarr's full TV interface, server pairing, remote navigation and AVPlay playback in a Samsung TV widget.", status: "Available · Developer preview" }
    else if clientId = "roku"
        data = { name: "Roku TV", platform: "Roku televisions", description: "The preview ZIP is the complete Roku channel bundle. Roku's development installer expects the archive itself, so keep it zipped.", status: "Available · Experimental install" }
    else if clientId = "chromecast"
        data = { name: "Chromecast", platform: "Chromecast built-in devices", description: "The Chromecast sender and receiver are built and tested for the Playarr web and Android apps, with an iOS sender in progress. Casting is not live yet: it needs a receiver registered with the Google Cast Developer Console before any real device can use it.", status: "Coming soon" }
    else if clientId = "xbox"
        data = { name: "Xbox", platform: "Xbox Series X|S and Xbox One", description: "The native Xbox client is in development. It will install as a signed package, so no release is available to download yet.", status: "Coming soon" }
    else if clientId = "harmony"
        data = { name: "HarmonyOS", platform: "Huawei phones, tablets and Vision TVs", description: "The native HarmonyOS client is in development. It will install as a signed package, so no release is available to download yet.", status: "Coming soon" }
    else if clientId = "firetv"
        data = { name: "Fire TV", platform: "Amazon Fire TV devices", description: "The native Fire TV client is in development. It will install as a signed package, so no release is available to download yet.", status: "Coming soon" }
    else if clientId = "server"
        data = { name: "Playarr Server", platform: "Linux, Docker and Kubernetes hosts", description: "Playarr Server catalogues your library from the library sources you already run, generates thumbnails, probes audio and subtitle tracks and transcodes on demand. Every Playarr client on this page connects to it. Your media stays on your own hardware.", status: "Release 0.1.0 · Linux and Docker" }
    end if
    return data
end function

function centeredClientButton(y as Float, label as String, url as String, style = "primary" as String) as Float
    width = pgButtonWidth(m.pageBody, label, 16, 44, 13, 720)
    x = 960 - width / 2
    return pgButton(m.pageBody, x, y, 44, label, style, "clientOpenLink", { title: label, url: url }, 16, true, 13, 720)
end function

sub clientActionPair(y as Float, firstLabel as String, firstUrl as String, secondLabel as String, secondUrl as String)
    gap = 12.0
    firstWidth = pgButtonWidth(m.pageBody, firstLabel, 16, 44, 13, 720)
    secondWidth = pgButtonWidth(m.pageBody, secondLabel, 16, 44, 13, 720)
    x = 960 - (firstWidth + gap + secondWidth) / 2
    pgButton(m.pageBody, x, y, 44, firstLabel, "primary", "clientOpenLink", { title: firstLabel, url: firstUrl }, 16, true, 13, 720)
    pgButton(m.pageBody, x + firstWidth + gap, y, 44, secondLabel, "secondary", "clientOpenLink", { title: secondLabel, url: secondUrl }, 16, true, 13, 720)
end sub

sub drawClientPanel(x as Float, y as Float, w as Float, h as Float, safety = false as Boolean)
    if safety
        pgRound(m.pageBody, x, y, w, h, 28, "surfaceStrong", 204)
    else
        line = ThemeColor("lineStrong")
        borderAlpha = Int((line and &hFF) * 0.68)
        pgRound(m.pageBody, x, y, w, h, 28, "surfaceStrong", 184)
        pgRound(m.pageBody, x, y, w, h, 28, "lineStrong", borderAlpha, true)
    end if
end sub

sub drawClientPackageNote(x as Float, y as Float, w as Float, h as Float, text as String, fontSize as Integer, maxLines as Integer)
    line = ThemeColor("lineStrong")
    borderAlpha = Int((line and &hFF) * 0.56)
    pgRound(m.pageBody, x, y, w, h, 16, "surface", 184)
    pgRound(m.pageBody, x, y, w, h, 16, "lineStrong", borderAlpha, true)
    pgLabel(m.pageBody, x + 20, y + 14, w - 40, h - 28, text, fontSize, 400, "inkSoft", { horizAlign: "center", wrap: true, maxLines: maxLines })
end sub

sub clientSectionHeading(y as Float, number as String, kicker as String, title as String)
    pgLabel(m.pageBody, 530, y, 36, 22, number, 11, 700, "inkMuted", { mono: true })
    pgLabel(m.pageBody, 580, y, 780, 18, UCase(kicker), 10, 800, "brandInk")
    pgLabel(m.pageBody, 580, y + 24, 920, 42, title, 30, 500, "ink")
end sub

sub serverSectionHeading(panelY as Float, number as String, kicker as String, title as String)
    pgLabel(m.pageBody, 548, panelY + 51, 34, 20, number, 11, 700, "inkMuted", { mono: true })
    pgTrackedText(m.pageBody, 598, panelY + 48, 770, kicker, 12, 780, 1.68, "brandInk", true, "left", 1, 16)
    pgTrackedText(m.pageBody, 598, panelY + 58, 770, title, 59, 500, -3.54, "ink", false, "left", 2, 59)
end sub

sub clientInstallStep(x as Float, y as Float, number as String, title as String, description as String)
    line = ThemeColor("lineStrong")
    lineAlpha = Int((line and &hFF) * 0.62)
    pgRound(m.pageBody, x, y, 430, 190, 18, "surface", 189)
    pgRound(m.pageBody, x, y, 430, 190, 18, "lineStrong", lineAlpha, true)
    pgLabel(m.pageBody, x + 22, y + 18, 38, 20, number, 11, 700, "inkMuted", { mono: true })
    pgLabel(m.pageBody, x + 74, y + 16, 326, 48, title, 17, 700, "ink", { wrap: true, maxLines: 2 })
    pgLabel(m.pageBody, x + 74, y + 70, 326, 108, description, 13, 400, "inkSoft", { wrap: true, maxLines: 6 })
end sub

sub showClientDetails(clientId as String)
    m.clientActiveId = clientId
    m.clientGuideOpen = true
    showOnly("page")
    renderClientDetails(clientId)
    focusClientTile(clientId)
    m.top.SetFocus(true)
end sub

sub changeClientSelection(direction as Integer)
    ids = clientsIds()
    current = clientsIndexOf(m.clientActiveId)
    if current < 0 then return
    current = current + direction
    if current < 0 then current = ids.Count() - 1
    if current >= ids.Count() then current = 0
    m.clientActiveId = ids[current]
    renderClientDetails(m.clientActiveId)
    focusClientTile(m.clientActiveId)
    m.top.SetFocus(true)
end sub

sub focusClientTile(clientId as String)
    for i = 0 to m.pageItems.Count() - 1
        if m.pageItems[i].action = "clientActive" and m.pageItems[i].data = clientId
            m.pageFocusIdx = i
            pageFocusRender()
            return
        end if
    end for
end sub

sub renderClientSummary(clientId as String, info as Object)
    panelHeight = 495
    if clientId = "roku" then panelHeight = 563
    if clientId = "android" then panelHeight = 379
    if clientId = "webos" then panelHeight = 674
    if clientId = "tizen" then panelHeight = 760
    if clientId = "server" then panelHeight = 967
    drawClientPanel(580, 700, 760, panelHeight)
    if clientId = "android"
        pgTrackedText(m.pageBody, 629, 750, 662, "Android", 12, 760, 2.13, "inkMuted", true, "center", 1, 16)
        pgTrackedText(m.pageBody, 629, 763, 662, "One Android app. Every screen.", 64, 500, -3.84, "ink", false, "center", 2, 64)
        pgLabel(m.pageBody, 729, 919, 462, 44, info.description, 14, 400, "inkSoft", { horizAlign: "center", wrap: true, maxLines: 2 })
        return
    end if

    logo = CreateObject("roSGNode", "Poster")
    logo.uri = "pkg:/images/clients-bubble.png"
    logo.translation = [868, 750]
    logo.width = 184
    logo.height = 184
    logo.blendColor = ThemeColor("surfaceStrong", 199)
    ThemeSetRole(logo, "surfaceStrong", 199)
    m.pageBody.AppendChild(logo)
    logoBorder = CreateObject("roSGNode", "Poster")
    logoBorder.uri = "pkg:/images/clients-bubble-border.png"
    logoBorder.translation = [868, 750]
    logoBorder.width = 184
    logoBorder.height = 184
    line = ThemeColor("lineStrong")
    borderAlpha = Int((line and &hFF) * 0.66)
    logoBorder.blendColor = ThemeWithAlpha(line, borderAlpha)
    ThemeSetRole(logoBorder, "lineStrong", borderAlpha)
    m.pageBody.AppendChild(logoBorder)
    logoMark = CreateObject("roSGNode", "Poster")
    logoMark.uri = "pkg:/images/client-icon-" + clientId + ".png"
    iconSize = 88
    logoMark.translation = [960 - iconSize / 2, 842 - iconSize / 2]
    logoMark.width = iconSize
    logoMark.height = iconSize
    logoMark.blendColor = clientPlatformIconColor(clientId)
    ThemeSetRole(logoMark, clientPlatformIconRole(clientId))
    m.pageBody.AppendChild(logoMark)
    platform = info.platform
    if clientId = "server" then platform = "Server, not a playback app"
    pgTrackedText(m.pageBody, 629, 958, 662, platform, 12, 760, 2.13, "inkMuted", true, "center", 1, 18)

    title = info.name
    if clientId = "webos" then title = "Playarr for LG webOS."
    if clientId = "tizen" then title = "Playarr for Samsung Tizen."
    if clientId = "server" then title = "Playarr Server."
    titleHeight = 64
    if clientId = "tizen" then titleHeight = 128
    titleY = 983
    ' SceneGraph Label top alignment includes more font ascent space than the Web line box.
    ' Keep titleY as the CSS line-box anchor for following content, but offset visible glyphs up to match it.
    pgTrackedText(m.pageBody, 629, titleY - 12, 662, title, 64, 500, -3.84, "ink", false, "center", 2, 64)

    descriptionY = titleY + titleHeight + 16
    descriptionW = 462
    descriptionHeight = 44
    descriptionSize = 14
    descriptionLines = 2
    if clientId = "webos" or clientId = "tizen" or clientId = "server"
        descriptionW = 512
        descriptionSize = 14
    end if
    if clientId = "server"
        descriptionHeight = 88
        descriptionLines = 4
    else if clientId = "chromecast" or clientId = "xbox" or clientId = "harmony" or clientId = "firetv"
        descriptionHeight = 88
        descriptionLines = 4
    end if
    pgLabel(m.pageBody, 960 - descriptionW / 2, descriptionY, descriptionW, descriptionHeight, info.description, descriptionSize, 400, "inkSoft", { horizAlign: "center", wrap: true, maxLines: descriptionLines })

    statusText = info.status
    if clientId = "webos" or clientId = "tizen" then statusText = "Developer preview"
    statusY = descriptionY + descriptionHeight + 20
    pgTrackedText(m.pageBody, 629, statusY, 662, statusText, 11, 780, 1.3, "inkSoft", true, "center", 1, 17)

    if clientId = "webos" or clientId = "tizen"
        note = "A WGT must carry valid Samsung/Tizen signatures for its target install path. The package is shown when a compatible signed artifact has been published; otherwise build with your own certificate profile."
        noteHeight = 117
        if clientId = "webos"
            note = "The package button serves the latest developer IPK only after one has been published. If it is unavailable, build the same IPK from source with the commands below."
            noteHeight = 95
        end if
        noteY = statusY + 36
        drawClientPackageNote(729, noteY, 462, noteHeight, note, 14, 5)
    end if
end sub

sub renderClientDetails(clientId as String)
    pageBegin("", 0)
    m.clientBubbles = []
    renderClientsHeader()
    renderClientTrack(clientId)
    info = clientMetadata(clientId)
    if clientId <> "vidaa" then renderClientSummary(clientId, info)

    if clientId = "roku"
        centeredClientButton(1171, "Download Roku ZIP", "https://playarr.app/downloads/roku/playarr-roku.zip")
    else if clientId = "android"
        centeredClientButton(987, "Download Android APK", "https://playarr.app/downloads/android/playarr-android.apk")
    else if clientId = "webos"
        clientActionPair(1282, "Download LG webOS IPK", "https://playarr.app/downloads/webos/playarr-webos.ipk", "Open source and README", "https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-webos")
    else if clientId = "tizen"
        clientActionPair(1368, "Download signed Samsung WGT", "https://playarr.app/downloads/tizen/playarr-tizen.wgt", "Open source and README", "https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-tizen")
    else if clientId = "server"
        drawClientPackageNote(729, 1207, 462, 88, "Prebuilt Linux tarballs (x86-64 and ARM64) and a public container image are published with every release. Each tarball holds the server, the Admin UI, the licence and example systemd units. Pick the build for your CPU.", 12, 4)
        clientActionPair(1318, "Download Linux x86-64 (.tar.gz)", "https://playarr.app/downloads/server/playarr-server-linux-amd64.tar.gz", "Download Linux ARM64 (.tar.gz)", "https://playarr.app/downloads/server/playarr-server-linux-arm64.tar.gz")
        pgLabel(m.pageBody, 629, 1378, 662, 19, "LINUX-AMD64", 12, 760, "inkMuted")
        pgButton(m.pageBody, 1110, 1380, 44, "SHA-256 checksum file", "secondary", "clientOpenLink", { title: "SHA-256 checksum file, x86-64", url: "https://playarr.app/downloads/server/playarr-server-linux-amd64.tar.gz.sha256" }, 16, true, 13, 720)
        pgLabel(m.pageBody, 629, 1428, 662, 19, "LINUX-ARM64", 12, 760, "inkMuted")
        pgButton(m.pageBody, 1110, 1430, 44, "SHA-256 checksum file", "secondary", "clientOpenLink", { title: "SHA-256 checksum file, ARM64", url: "https://playarr.app/downloads/server/playarr-server-linux-arm64.tar.gz.sha256" }, 16, true, 13, 720)
        drawClientPackageNote(729, 1480, 462, 117, "Check the download with sha256sum before you run it. Needs 64-bit Linux with glibc 2.39 or newer (Debian 13, Ubuntu 24.04 or newer) and ffmpeg on the PATH; the container image has everything included.", 12, 5)
    end if

    m.clientsContentBottom = 1280
    if clientId = "android" then m.clientsContentBottom = 1080
    if clientId = "roku" then m.clientsContentBottom = 2178
    if clientId = "vidaa" then m.clientsContentBottom = 2040
    if clientId = "webos" or clientId = "tizen" then m.clientsContentBottom = 2200
    if clientId = "server" then m.clientsContentBottom = 4513
    if clientId = "roku"
        renderRokuClientGuide()
    else if clientId = "vidaa"
        renderVidaaClientGuide()
    else if clientId = "webos" or clientId = "tizen"
        renderSmartTvClientGuide(clientId)
    else if clientId = "server"
        renderServerClientGuide()
    end if
    pgLabel(m.pageBody, 560, m.clientsContentBottom + 60, 800, 26, "One library. Every screen. Your server stays yours.", 12, 400, "inkSoft", { horizAlign: "center" })
    m.clientsScrollBottom = m.clientsContentBottom + 86
    applyClientsChrome()
end sub

sub showClientLinkDialog(info as Object)
    if info = invalid then return
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = info.title
    dialog.message = "Roku has no web browser or package installer for this link. On a phone or computer, open: " + info.url
    dialog.buttons = ["OK"]
    dialog.ObserveField("buttonSelected", "onSimpleDialogButton")
    m.top.dialog = dialog
end sub

sub renderRokuClientGuide()
    y = 1340
    clientSectionHeading(y, "01", "Developer-mode sideload", "Install Playarr on your Roku")
    pgLabel(m.pageBody, 580, y + 78, 900, 48, "Keep the Roku and the phone or computer used for installation on the same local network. You will need the Roku remote, the ZIP above and a developer password you create on the TV.", 14, 400, "inkSoft", { wrap: true, maxLines: 2 })
    drawClientPanel(500, y + 122, 920, 486)
    clientInstallStep(540, y + 220, "01", "Enable Developer Mode", "On the Roku remote, press Home three times, Up twice, then Right, Left, Right, Left, Right. Note the URL shown, enable the Development Application Installer, accept the agreement and create a password. The Roku will restart.")
    clientInstallStep(970, y + 220, "02", "Open the web installer", "From a phone or computer on the same network, open the URL shown on the TV. Sign in with the username rokudev and the developer password you created.")
    clientInstallStep(540, y + 422, "03", "Upload the ZIP unchanged", "Choose Upload, select playarr-roku.zip without extracting it, then choose Install. Roku launches Playarr when the sideload finishes.")
    clientInstallStep(970, y + 422, "04", "Connect Playarr", "Enter your Playarr Server base URL, follow the code shown on the TV to authorise the Roku, then choose a household profile.")
    pgButton(m.pageBody, 700, y + 620, 48, "Open Roku's official developer guide", "secondary", "clientOpenLink", { title: "Roku official developer guide", url: "https://developer.roku.com/dev/docs/developer-setup" }, 18, true)
    drawClientPanel(500, y + 684, 920, 154, true)
    pgLabel(m.pageBody, 540, y + 704, 840, 18, "IMPORTANT", 10, 800, "brandInk")
    pgLabel(m.pageBody, 540, y + 732, 840, 34, "Only one sideloaded app can be installed.", 22, 650, "ink")
    pgLabel(m.pageBody, 540, y + 772, 830, 48, "Installing another development app replaces Playarr. If Roku rejects an identical version, remove the existing sideloaded app and install the ZIP again.", 13, 400, "inkSoft", { wrap: true, maxLines: 3 })
end sub

sub renderVidaaClientGuide()
    yOff = -660
    pgLabel(m.pageBody, 610, 1360 + yOff, 680, 18, "HISENSE VIDAA", 10, 800, "brandInk", { horizAlign: "center" })
    pgLabel(m.pageBody, 560, 1388 + yOff, 780, 56, "Put Playarr on your home screen.", 38, 500, "ink", { horizAlign: "center" })
    pgLabel(m.pageBody, 580, 1454 + yOff, 740, 60, "Compatible VIDAA TVs can install a Playarr launcher through the Playarr custom store. You choose and operate the DNS or interception method; Playarr hosts only the store assets.", 14, 400, "inkSoft", { horizAlign: "center", wrap: true, maxLines: 3 })
    drawClientPanel(580, 1528 + yOff, 760, 88, true)
    pgLabel(m.pageBody, 610, 1544 + yOff, 700, 58, "Firmware support varies. Your chosen setup must present the store as vidaahub.com and handle any required certificate trust; some TVs omit the installation API entirely.", 13, 400, "inkSoft", { wrap: true, maxLines: 3 })
    clientSectionHeading(1644 + yOff, "01", "Custom app store", "Use the Playarr store")
    pgLabel(m.pageBody, 580, 1720 + yOff, 860, 48, "Playarr publishes the fixed, Playarr-only custom store at the address below. Configure your own compatible DNS, proxy or self-hosted interception setup to present it to the television.", 14, 400, "inkSoft", { wrap: true, maxLines: 2 })
    centeredClientButton(1780 + yOff, "Open custom store", "https://playarr.app/vidaa-store/", "primary")
    pgLabel(m.pageBody, 930, 1782 + yOff, 480, 48, "Playarr does not operate a public DNS resolver. You remain in control of the DNS method and restore your normal settings after installation.", 13, 400, "inkSoft", { wrap: true, maxLines: 2 })
    clientSectionHeading(1850 + yOff, "02", "On your router and TV", "Install Playarr")
    pgLabel(m.pageBody, 580, 1920 + yOff, 840, 48, "Choose a trusted DNS or interception setup, install the Playarr-only launcher, then return your router or TV to automatic DNS.", 14, 400, "inkSoft", { wrap: true, maxLines: 2 })
    drawClientPanel(500, 1980 + yOff, 920, 442)
    clientInstallStep(540, 2000 + yOff, "01", "Set the temporary DNS", "Choose a trusted DNS or interception setup that can present the custom store as vidaahub.com. Enter its resolver address in your router or TV and keep every other network setting unchanged.")
    clientInstallStep(970, 2000 + yOff, "02", "Open the VIDAA portal", "On the TV, open the VIDAA store or browser route used by your chosen setup. Accept a certificate warning only when you understand and trust that setup.")
    clientInstallStep(540, 2202 + yOff, "03", "Choose Install Playarr", "Confirm the Playarr-only installation on the TV. Do not switch off the television while the launcher tile is being written.")
    clientInstallStep(970, 2202 + yOff, "04", "Restart and restore DNS", "Restart the TV, confirm that Playarr opens, then return your router or TV to automatic DNS immediately.")
    drawClientPanel(580, 2440 + yOff, 760, 156, true)
    pgLabel(m.pageBody, 620, 2460 + yOff, 680, 24, "IMPORTANT", 10, 800, "brandInk")
    pgLabel(m.pageBody, 620, 2492 + yOff, 680, 38, "Restore automatic DNS after installation.", 18, 500, "ink")
    pgLabel(m.pageBody, 620, 2534 + yOff, 680, 48, "Your chosen resolver is only needed for installation. Restoring your normal DNS keeps everyday browsing private and reliable; the installed Playarr tile will continue to work.", 13, 400, "inkSoft", { wrap: true, maxLines: 3 })
end sub

sub clientCommandBlock(x as Float, y as Float, w as Float, h as Float, label as String, commands as String)
    pgRound(m.pageBody, x, y, w, h, 12, "surfaceStrong", 210)
    pgRound(m.pageBody, x, y, w, h, 12, "line", 156, true)
    pgLabel(m.pageBody, x + 14, y + 10, w - 28, 16, label, 9, 800, "inkMuted")
    pgLabel(m.pageBody, x + 14, y + 30, w - 28, h - 38, commands, 9, 400, "ink", { mono: true, wrap: true, maxLines: 16 })
end sub

sub renderSmartTvClientGuide(clientId as String)
    isWebOS = clientId = "webos"
    brand = "Samsung"
    device = "Samsung TV"
    title = "Install Playarr on your Samsung TV"
    installDescription = "Use a 2023-or-newer Samsung television running Tizen 7.0 or newer, and keep it on the same local network as the computer. You need Tizen Studio with the Samsung TV extensions, a valid certificate profile and either a compatible signed WGT above or one you sign from source."
    officialUrl = "https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html"
    sourceUrl = "https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-tizen"
    appId = "StrmarrTV1.Playarr Server"
    if isWebOS
        brand = "LG"
        device = "LG TV"
        title = "Install Playarr on your LG TV"
        installDescription = "Use an LG television running webOS 23 or newer, and keep it on the same local network as the computer. You need an LG developer account, the Developer Mode app, the webOS CLI and either the published IPK above or a package you build from source."
        officialUrl = "https://webostv.developer.lge.com/develop/getting-started/developer-mode-app"
        sourceUrl = "https://github.com/ThomasMcFarlane/playarr/tree/main/clients/tv-web/apps/tv-webos"
        appId = "com.playarr.tv"
    end if
    clientSectionHeading(1360, "01", brand + " Developer Mode", title)
    pgLabel(m.pageBody, 580, 1438, 840, 78, installDescription, 13, 400, "inkSoft", { wrap: true, maxLines: 4 })
    if isWebOS
        clientInstallStep(540, 1530, "01", "Enable Developer Mode", "Install Developer Mode from the LG Content Store, sign in with your LG developer account, enable Dev Mode Status and let the TV restart. Reopen the app, select Key Server and use EXTEND before the remaining session expires.")
        clientInstallStep(970, 1530, "02", "Get the Playarr IPK", "Try the package download above. If no release IPK has been published, install Node.js, clone Playarr, install the official webOS CLI and build the package locally.")
        clientCommandBlock(540, 1732, 860, 142, "BUILD THE IPK FROM SOURCE", "git clone https://github.com/ThomasMcFarlane/playarr.git" + Chr(10) + "cd playarr/clients/tv-web" + Chr(10) + "npm install -g pnpm@11.13.0" + Chr(10) + "pnpm install --frozen-lockfile" + Chr(10) + "npm install -g @webos-tools/cli" + Chr(10) + "pnpm --filter @playarr-tv/app-webos run package:ipk")
        clientInstallStep(540, 1890, "03", "Connect the TV", "Run the device setup, choose add and name the target playarr-tv. Enter the TV's IP address, port 9922 and user prisoner without a password. With Key Server still enabled, fetch the key and enter the six-character passphrase shown on the TV.")
        clientCommandBlock(540, 2092, 860, 90, "CONNECT AND FETCH THE KEY", "ares-setup-device --add playarr-tv -i ""host=<TV-IP>"" -i ""port=9922"" -i ""username=prisoner""" + Chr(10) + "ares-novacom --device playarr-tv --getkey" + Chr(10) + "ares-device --system-info --device playarr-tv")
        clientInstallStep(540, 2198, "04", "Install and launch", "Run the commands from the tv-web directory for a locally built IPK. If you downloaded playarr-webos.ipk instead, substitute that file's path. When Playarr opens, scan its link code and choose your Playarr Server and household profile in Playarr.")
        clientCommandBlock(540, 2400, 860, 72, "INSTALL AND LAUNCH", "ares-install --device playarr-tv apps/tv-webos/out/com.playarr.tv_*_all.ipk" + Chr(10) + "ares-launch --device playarr-tv com.playarr.tv")
        centeredClientButton(2488, "Open LG's official Developer Mode guide", officialUrl, "secondary")
        drawClientPanel(580, 2552, 760, 150, true)
        pgLabel(m.pageBody, 610, 2570, 700, 22, "BEFORE YOU INSTALL", 10, 800, "brandInk")
        pgLabel(m.pageBody, 610, 2600, 700, 88, "Playarr launches as com.playarr.tv. LG removes Developer Mode apps when the session expires, so keep the TV online and use EXTEND before the timer reaches zero. Treat this build as a developer preview until playback, remote, suspend and resume are validated on representative hardware.", 13, 400, "inkSoft", { wrap: true, maxLines: 5 })
        m.clientsContentBottom = 2720
    else
        clientInstallStep(540, 1530, "01", "Install the TV SDK and create a certificate", "Install Tizen Studio, then add the Samsung TV Extension, Samsung Certificate Extension and Web CLI in Package Manager. Create and activate a Samsung certificate profile; Tizen will not install an unsigned widget.")
        clientInstallStep(970, 1530, "02", "Enable Developer Mode", "On the TV open Apps, then App Settings, and enter 12345. Turn Developer Mode on, enter the computer's local IP address, confirm and reboot the TV. Keep both devices on the same network.")
        clientInstallStep(540, 1732, "03", "Build and sign the WGT", "Try the signed package download above first. If it is unavailable or its signature is not valid for your TV, build Playarr and package the dist directory with the exact active certificate profile name from Tizen Studio.")
        clientCommandBlock(540, 1934, 860, 112, "BUILD AND SIGN THE WIDGET", "git clone https://github.com/ThomasMcFarlane/playarr.git" + Chr(10) + "cd playarr/clients/tv-web" + Chr(10) + "npm install -g pnpm@11.13.0" + Chr(10) + "pnpm install --frozen-lockfile" + Chr(10) + "pnpm --filter @playarr-tv/app-tizen... run build" + Chr(10) + "tizen package -t wgt -s <certificate-profile> -- apps/tv-tizen/dist")
        clientInstallStep(540, 2058, "04", "Connect, install and launch", "Connect with SDB. In Tizen Studio Device Manager, right-click the connected TV and choose Permit to install applications. Use tizen list tv to find the CLI target name, then substitute the generated WGT filename, package directory and target name. Launch Playarr with its fixed application ID, scan its link code and choose your Playarr Server and household profile in Playarr.")
        clientCommandBlock(540, 2258, 860, 112, "CONNECT, INSTALL AND LAUNCH", "sdb connect <TV-IP>" + Chr(10) + "sdb devices" + Chr(10) + "tizen list tv" + Chr(10) + "tizen install -n <generated-package>.wgt -t <target-name> -- apps/tv-tizen/dist" + Chr(10) + "tizen run -p StrmarrTV1.Playarr Server -t <target-name>")
        centeredClientButton(2382, "Open Samsung's official TV device guide", officialUrl, "secondary")
        drawClientPanel(580, 2446, 760, 130, true)
        pgLabel(m.pageBody, 610, 2464, 700, 92, "The WGT must stay signed and unchanged. Tizen rejects unsigned or modified packages, and the certificate profile must permit the target TV. Playarr launches as StrmarrTV1.Playarr Server after installation. Treat this build as a developer preview until remote and AVPlay behaviour are validated on a supported real TV.", 13, 400, "inkSoft", { wrap: true, maxLines: 5 })
        m.clientsContentBottom = 2590
    end if
end sub

sub renderServerClientGuide()
    requirementsY = 1709
    drawClientPanel(500, requirementsY, 920, 610)
    serverSectionHeading(requirementsY, "01", "Before you install", "System requirements")
    clientInstallStep(540, 1874, "01", "64-bit Linux", "x86-64 or ARM64. Docker is optional; the container image is built for both architectures. The server stores its SQLite database and artwork cache in a writable data directory, so it needs persistent storage.")
    clientInstallStep(970, 1874, "02", "ffmpeg and ffprobe", "Required for thumbnails, track probing and on-demand transcoding. The Docker image includes them. On systemd or Kubernetes installs without that image, install ffmpeg (which provides ffprobe) on the host and make sure both are on the server's PATH.")
    clientInstallStep(540, 2076, "03", "Your media apps", "Playarr Server reads from the library sources that you already run. Register each one through the server's admin API after it starts.")
    clientInstallStep(970, 2076, "04", "Network port 8484", "The API listens on TCP 8484, plain HTTP by default. Clients on the same network can connect to it directly. Metrics are on 9090 and should stay on your private network.")

    installY = 2361
    drawClientPanel(500, installY, 920, 1330)
    serverSectionHeading(installY, "02", "Supported install methods", "Choose one")
    pgLabel(m.pageBody, 598, 2506, 720, 48, "Pick one. Each method runs the same single all-in-one server process. The Docker commands pull the public image; the other methods use the downloaded tarball or your own chart values.", 13, 400, "inkSoft", { wrap: true, maxLines: 2 })
    clientInstallStep(540, 2594, "01", "Docker", "Pulls the multi-arch image, ffmpeg included, and starts one container with SQLite state in a named volume. The generated PLAYARR_JWT_SECRET keeps sessions across restarts; save it if you recreate the container.")
    clientInstallStep(970, 2594, "02", "Docker Compose", "The same image as a compose file. Replace the secret with a long random string, then start it and open port 8484.")
    clientCommandBlock(540, 2796, 860, 120, "DOCKER", "docker pull ghcr.io/thomasmcfarlane/playarr:latest" + Chr(10) + "docker run -d --name playarr --restart unless-stopped -p 8484:8484 -v playarr-data:/data -e DATABASE_URL=sqlite:///data/playarr.db -e PLAYARR_JWT_SECRET=""$(openssl rand -hex 32)"" ghcr.io/thomasmcfarlane/playarr:latest" + Chr(10) + "curl http://localhost:8484/healthz")
    clientCommandBlock(540, 2926, 860, 248, "DOCKER COMPOSE", "services:" + Chr(10) + "  playarr:" + Chr(10) + "    image: ghcr.io/thomasmcfarlane/playarr:latest" + Chr(10) + "    container_name: playarr" + Chr(10) + "    restart: unless-stopped" + Chr(10) + "    ports:" + Chr(10) + "      - ""8484:8484""" + Chr(10) + "    environment:" + Chr(10) + "      DATABASE_URL: sqlite:///data/playarr.db" + Chr(10) + "      PLAYARR_JWT_SECRET: change-me-to-a-long-random-string" + Chr(10) + "    volumes:" + Chr(10) + "      - playarr-data:/data" + Chr(10) + "volumes:" + Chr(10) + "  playarr-data:" + Chr(10) + "docker compose up -d")
    clientInstallStep(540, 3189, "03", "systemd on a Linux host", "Unpack the tarball, then install.sh installs the playarr-server binary, the Admin UI, an unprivileged playarr user and the unit files. It does not enable or start anything until you do. Set DATABASE_URL in the env file first, for example sqlite:///var/lib/playarr/playarr.db.")
    clientInstallStep(970, 3189, "04", "Kubernetes (Helm chart)", "The playarr-standalone chart runs one Pod with a Recreate strategy for a single SQLite-backed server. Point it at the public image, an existing Secret and persistent storage. The chart never creates Secrets and has no migration or deletion hooks. Render and review it before applying.")
    clientCommandBlock(540, 3391, 860, 142, "SYSTEMD", "tar -xzf playarr-server-linux-amd64.tar.gz" + Chr(10) + "cd playarr-server-*-linux-amd64" + Chr(10) + "sudo ./systemd/install.sh" + Chr(10) + "sudoedit /etc/playarr/playarr.env" + Chr(10) + "sudo systemctl enable --now playarr.service" + Chr(10) + "journalctl -u playarr.service -f")
    clientCommandBlock(540, 3541, 860, 90, "KUBERNETES HELM", "helm template playarr infra/kubernetes/helm/playarr-standalone --values my-values.yaml")

    connectY = 3733
    drawClientPanel(500, connectY, 920, 480)
    serverSectionHeading(connectY, "03", "Connect your clients", "HTTPS and the playarr.app relay")
    pgLabel(m.pageBody, 598, 3888, 720, 62, "Native apps can connect to the server's address on your network. The hosted web client at playarr.app is served over HTTPS, so it needs a browser-trusted certificate for the server. Bring your own, or use the optional relay.", 13, 400, "inkSoft", { wrap: true, maxLines: 3 })
    pgLabel(m.pageBody, 550, 3985, 840, 26, "OPTIONAL RELAY (OFF BY DEFAULT)", 10, 800, "brandInk")
    pgLabel(m.pageBody, 550, 4019, 840, 92, "For a server with a public IPv4 address and TCP 8484 reachable from the internet. The server registers with playarr.app, which publishes a DNS-only name such as v4-203-0-113-10.relay.playarr.app pointing at your address. The server then obtains its own Let's Encrypt certificate over DNS-01, so port 80 is not needed. For a short period after start, typically under two minutes, the API is plain HTTP; it then switches to HTTPS on the same port.", 13, 400, "inkSoft", { wrap: true, maxLines: 5 })
    clientCommandBlock(550, 4121, 840, 84, "RELAY ENVIRONMENT", "PLAYARR_RELAY_REGISTER=true" + Chr(10) + "PLAYARR_ACME_CHALLENGE=relay-dns-01" + Chr(10) + "PLAYARR_ACME_DOMAIN=v4-<A>-<B>-<C>-<D>.relay.playarr.app" + Chr(10) + "PLAYARR_ACME_ACCEPT_TERMS=true")
    privacyY = 4243
    drawClientPanel(500, privacyY, 920, 270, true)
    pgLabel(m.pageBody, 580, privacyY + 32, 760, 16, "WHAT THE RELAY SHARES", 10, 800, "brandInk", { horizAlign: "center" })
    pgTrackedText(m.pageBody, 560, privacyY + 42, 800, "Your address, not your media.", 59, 500, -3.54, "ink", false, "center", 1, 59)
    pgLabel(m.pageBody, 580, privacyY + 119, 760, 128, "Enabling the relay sends your public IPv4 address and a key fingerprint to playarr.app, and the name is public DNS data. No streaming or API traffic passes through Cloudflare. Registration proves control of the address, not who owns the server. Leave it off if you would rather use your own certificate and name.", 13, 400, "inkSoft", { horizAlign: "center", wrap: true, maxLines: 5 })
end sub

sub leaveClientsToProfiles()
    m.pageScrollY = 0
    m.navDockMode = false
    m.clientActiveId = ""
    showOnly("profiles")
    m.top.screenState = "profiles"
    if m.profilesClientsHit <> invalid then m.profilesClientsHit.SetFocus(true)
    updateProfileActionsLayout()
    applyProfilesChromeFocus()
end sub

sub leaveClientDetailsToClientList()
    m.clientGuideOpen = false
    showOnly("page")
    renderClientsIndex()
    index = clientsIndexOf(m.clientActiveId)
    if index < 0 then index = 0
    m.pageFocusIdx = 3 + index
    pageFocusRender()
    m.top.SetFocus(true)
end sub

sub focusClientsHeader(action as String)
    if m.pageKind <> "clients" then return
    for i = 0 to m.pageItems.Count() - 1
        if m.pageItems[i].action = action
            m.pageFocusIdx = i
            pageFocusRender()
            return
        end if
    end for
end sub

' ---------------------------------------------------------------------------
' Release calendar

function calendarMonthName(month as Integer, short as Boolean) as String
    names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    name = names[month - 1]
    if short then return Left(name, 3)
    return name
end function

function calendarDateString(dt as Object) as String
    return dt.ToISOString().Left(10)
end function

function calendarToday() as Object
    dt = CreateObject("roDateTime")
    dt.ToLocalTime()
    return dt
end function

sub calendarEnsureRange()
    if m.calendarView = invalid then m.calendarView = "month"
    if m.calendarAnchor = invalid then m.calendarAnchor = calendarTodayString()
end sub

' Dates are "YYYY-MM-DD" strings in UTC midnight arithmetic, so no time zone can shift a day.
function calendarTodayString() as String
    dt = calendarToday()
    return dt.GetYear().ToStr() + "-" + calendarTwo(dt.GetMonth()) + "-" + calendarTwo(dt.GetDayOfMonth())
end function

function calDate(day as String) as Object
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(day + "T00:00:00Z")
    return dt
end function

function calAddDays(day as String, n as Integer) as String
    dt = calDate(day)
    dt.FromSeconds(dt.AsSeconds() + n * 86400)
    return dt.ToISOString().Left(10)
end function

' 0 = Monday ... 6 = Sunday.
function calWeekday(day as String) as Integer
    return (calDate(day).GetDayOfWeek() + 6) mod 7
end function

function calAddMonths(day as String, n as Integer) as String
    total = Val(day.Left(4)) * 12 + (Val(Mid(day, 6, 2)) - 1) + n
    return Int(total / 12).ToStr() + "-" + calendarTwo((total mod 12) + 1) + "-01"
end function

' First and last visible day of the current view (month: whole Monday-based weeks; week: Monday to Sunday; agenda: 30 days).
function calendarViewRange() as Object
    calendarEnsureRange()
    anchor = m.calendarAnchor
    if m.calendarView = "month"
        first = anchor.Left(8) + "01"
        gridStart = calAddDays(first, -calWeekday(first))
        monthEnd = calAddDays(calAddMonths(first, 1), -1)
        gridEnd = calAddDays(monthEnd, 6 - calWeekday(monthEnd))
        return { start: gridStart, finish: gridEnd, first: first }
    else if m.calendarView = "week"
        monday = calAddDays(anchor, -calWeekday(anchor))
        return { start: monday, finish: calAddDays(monday, 6), first: monday }
    end if
    return { start: anchor, finish: calAddDays(anchor, 29), first: anchor }
end function

sub loadCalendar()
    r = calendarViewRange()
    path = "/api/v1/calendar?start=" + r.start + "&end=" + r.finish
    if m.calendarKinds.Count() > 0 then path = path + "&kind=" + joinStrings(m.calendarKinds, ",")
    m.pageStatus = "loading"
    m.pageData = invalid
    sendApi("calendar", "GET", path, invalid, true)
end sub

function calendarShortDay(day as String) as String
    return Val(Mid(day, 9, 2)).ToStr() + " " + calendarMonthName(Val(Mid(day, 6, 2)), true)
end function

function calendarRangeLabel() as String
    r = calendarViewRange()
    if m.calendarView = "month" then return calendarMonthName(Val(Mid(r.first, 6, 2)), true) + " " + r.first.Left(4)
    if m.calendarView = "week" then return Val(Mid(r.start, 9, 2)).ToStr() + " – " + calendarShortDay(r.finish)
    return calendarShortDay(r.start) + " – " + calendarShortDay(r.finish)
end function

' Web releaseInstant: a release has a time of day unless it is missing or exactly midnight UTC (a date-only release).
function calendarHasTime(entry as Object) as Boolean
    if entry.release_at = invalid or entry.release_at = "" then return false
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(entry.release_at)
    return dt.AsSeconds() mod 86400 <> 0
end function

' Web entryLocalDay: the local day of a timed release, else the entry's own date.
function calendarEntryLocalDay(entry as Object) as String
    if calendarHasTime(entry)
        dt = calendarEntryDate(entry)
        return dt.GetYear().ToStr() + "-" + calendarTwo(dt.GetMonth()) + "-" + calendarTwo(dt.GetDayOfMonth())
    end if
    return JsonString(entry.date)
end function

function calendarEntryDate(entry as Object) as Object
    dt = CreateObject("roDateTime")
    if calendarHasTime(entry)
        dt.FromISO8601String(entry.release_at)
        dt.ToLocalTime()
    else if entry.date <> invalid
        dt.FromISO8601String(entry.date + "T00:00:00Z")
    end if
    return dt
end function

' Status text as web shows it: Available, Upcoming (monitored, still to come), Missing (monitored, already due), Not tracked.
function calendarStatusText(entry as Object) as String
    if entry.has_file = true then return "Available"
    if entry.monitored <> true then return "Not tracked"
    if calendarEntryLocalDay(entry) <= calendarTodayString() then return "Missing"
    return "Upcoming"
end function

function calendarTwo(value as Integer) as String
    if value < 10 then return "0" + value.ToStr()
    return value.ToStr()
end function

' "All day" when the release has no time of day (web), else HH:MM.
function calendarTimeText(entry as Object) as String
    if not calendarHasTime(entry) then return "All day"
    return calendarTime(calendarEntryDate(entry))
end function

' Web order within a day: releases without a time first, then by time.
function calendarDayList(list as Object) as Object
    allDay = []
    timed = []
    for each e in list
        if calendarHasTime(e) then timed.Push(e) else allDay.Push(e)
    end for
    timed.SortBy("release_at")
    for each e in timed
        allDay.Push(e)
    end for
    return allDay
end function

' Meta row of a calendar entry (web .calendar-entry-meta): time, release type, kind, then the status chip. Returns the end x.
function calendarMetaRow(parent as Object, x as Float, y as Float, entry as Object, size as Integer) as Float
    cx = x
    for each part in [calendarTimeText(entry), calendarReleaseLabel(entry), calendarKindLabel(entry)]
        probe = pgLabel(parent, cx, y, 0, size + 6, part, size, 400, "inkMuted")
        cx = cx + probe.boundingRect().width + 12
    end for
    return cx + calendarBadge(parent, cx, y, size * 2, calendarStatusText(entry), size)
end function

function calendarTime(dt as Object) as String
    return calendarTwo(dt.GetHours()) + ":" + calendarTwo(dt.GetMinutes())
end function

function calendarDayHeading(dt as Object, withYear as Boolean) as String
    text = dt.GetWeekday() + " " + dt.GetDayOfMonth().ToStr() + " " + calendarMonthName(dt.GetMonth(), false)
    if withYear then text = dt.GetWeekday() + ", " + dt.GetDayOfMonth().ToStr() + " " + calendarMonthName(dt.GetMonth(), false) + " " + dt.GetYear().ToStr()
    return text
end function

function calendarEntrySubtitle(entry as Object) as String
    text = ""
    if entry.season_number <> invalid and entry.episode_number <> invalid
        text = "S" + calendarTwo(entry.season_number) + "E" + calendarTwo(entry.episode_number)
    end if
    if entry.subtitle <> invalid and entry.subtitle <> ""
        if text <> "" then text = text + " · "
        text = text + entry.subtitle
    end if
    return text
end function

function calendarKindLabel(entry as Object) as String
    if entry.media_kind = "episode" then return "Episodes"
    if entry.media_kind = "movie" then return "Movies"
    if entry.media_kind = "album" then return "Albums"
    return "Books"
end function

function calendarReleaseLabel(entry as Object) as String
    t = entry.release_type
    if t = "air" then return "Airs"
    if t = "cinema" then return "In cinemas"
    if t = "digital" then return "Digital release"
    if t = "physical" then return "Physical release"
    return "Release"
end function

' Redraws the calendar and keeps focus on the control the viewer just used (the range switcher, Previous, Today, Next), or on the
' view's own default (today's cell, the first card) when the data arrives.
sub renderCalendar()
    renderCalendarBody()
    wanted = m.calendarFocusAction
    if wanted <> invalid and wanted <> ""
        for i = 0 to m.pageItems.Count() - 1
            if m.pageItems[i].action = wanted then m.pageFocusIdx = i
        end for
    else if m.calendarView <> "month" and m.calendarPlaceFirst = true
        for i = 0 to m.pageItems.Count() - 1
            if m.pageItems[i].action = "calToday"
                m.pageFocusIdx = i
                exit for
            end if
        end for
    end if
    if m.pageFocusIdx >= m.pageItems.Count() then m.pageFocusIdx = 0
end sub

sub renderCalendarBody()
    calendarEnsureRange()
    pageBegin("Calendar", 0)
    ' Controls on the right of the header row (web: the range switcher, Previous, Today, Next).
    pgRound(m.pageHead, 1793, 56.2, 50, 50, 25, "surface")
    pgRound(m.pageHead, 1793, 56.2, 50, 50, 25, "line", -1, true)
    pgIcon(m.pageHead, 1810.5, 73, 15, "arrow-right.png", "inkSoft")
    pgFocusable(1793, 56.2, 50, 50, 25, "calNext")
    todayW = pgButton(m.pageHead, 1692, 54.8, 52.8, "Today", "secondary", "calToday")
    pgRound(m.pageHead, 1629, 56.2, 50, 50, 25, "surface")
    pgRound(m.pageHead, 1629, 56.2, 50, 50, 25, "line", -1, true)
    pgIcon(m.pageHead, 1646.5, 73, 15, "arrow-left.png", "inkSoft")
    pgFocusable(1629, 56.2, 50, 50, 25, "calPrev")
    probe = pgLabel(m.pageHead, 0, 0, 0, 30, calendarRangeLabel(), 15, 700, "inkSoft")
    rw = probe.boundingRect().width + 36
    m.pageHead.removeChild(probe)
    pgButton(m.pageHead, 1616 - rw, 54.8, 52.8, calendarRangeLabel(), "secondary", "calView", invalid, 18)
    pgTile(m.pageHead, shellActionX(), shellActionY(0), "Calendar link", "tile-bell.png", "calLink")
    pgTile(m.pageHead, shellActionX(), shellActionY(1), "Filters", "tile-filters.png", "calFilters")

    entries = []
    if m.pageData <> invalid and m.pageData.entries <> invalid then entries = m.pageData.entries
    if m.pageStatus = "loading" and entries.Count() = 0
        pgLabel(m.pageBody, 786, 240, 600, 30, "Loading the release calendar…", 14, 400, "inkMuted")
        return
    end if
    if m.pageStatus = "error"
        pgLabel(m.pageBody, 153.6, 240, 1200, 30, m.pageError, 14, 400, "danger")
        return
    end if
    if m.calendarView = "month"
        renderCalendarMonth(entries)
    else if m.calendarView = "week"
        renderCalendarWeek(entries)
    else
        renderCalendarAgenda(entries)
    end if
    if m.artTelemetryEnabled = true and m.pageStatus = "ready"
        if m.calendarView = "agenda"
            renderedState = "entries"
            if entries.Count() = 0 then renderedState = "empty"
            parityEmit("calendarContent", "agenda|" + renderedState)
        else if m.calendarView = "month" or m.calendarView = "week"
            parityEmit("calendarContent", m.calendarView + "|ready")
        end if
    end if
end sub

sub renderCalendarAgenda(entries as Object)
    if entries.Count() = 0
        pgLabel(m.pageBody, 153.6, 240, 1200, 30, "No releases in this range.", 19, 400, "inkSoft")
        return
    end if
    selected = invalid
    if m.calendarSelected = invalid then m.calendarSelected = ""
    for each entry in entries
        if entry.id = m.calendarSelected then selected = entry
    end for
    if selected = invalid
        selected = entries[0]
        m.calendarSelected = selected.id
    end if

    ' Left: the selected entry's sheet.
    dt = calendarEntryDate(selected)
    pgLabel(m.pageHead, 153.6, 240, 600, 18, UCase(calendarKindLabel(selected) + " · " + calendarReleaseLabel(selected)), 12, 800, "inkMuted")
    pgLabel(m.pageHead, 153.6, 272, 600, 58, selected.title, 38, 600, "ink")
    pgLabel(m.pageHead, 153.6, 344, 600, 30, calendarEntrySubtitle(selected), 19, 400, "ink")
    pgLabel(m.pageHead, 153.6, 387, 600, 17, UCase("Release"), 11, 400, "inkMuted")
    pgLabel(m.pageHead, 153.6, 405, 620, 26, calendarDayHeading(dt, true) + " at " + calendarTime(dt), 19, 400, "ink")
    pgLabel(m.pageHead, 153.6, 443, 600, 17, UCase("Status"), 11, 400, "inkMuted")
    statusText = calendarStatusText(selected)
    badgeW = calendarBadge(m.pageHead, 153.6, 461.3, 26, statusText, 19)
    pgLabel(m.pageHead, 153.6, 498.7, 600, 17, UCase("Reported by"), 11, 400, "inkMuted")
    y = 516.0
    if selected.sources <> invalid
        for each src in selected.sources
            pgLabel(m.pageHead, 153.6, y, 620, 28, src.source_name + "  (" + src.source_kind + ")", 19, 400, "ink")
            y = y + 29
        end for
    end if
    btnY = y + 14
    x = 153.6
    playFile = ""
    openWork = ""
    if selected.actions <> invalid
        for each a in selected.actions
            if a.action = "play" and a.media_file_id <> invalid then playFile = a.media_file_id
            if a.action = "open" and a.work_id <> invalid then openWork = a.work_id
        end for
    end if
    if playFile <> ""
        x = x + pgButton(m.pageHead, x, btnY, 58, "Play", "primary", "calPlay", playFile, 24) + 10
    end if
    if openWork <> ""
        label = "Open title"
        if selected.media_kind = "episode" then label = "Open series"
        if selected.media_kind = "movie" then label = "Open movie"
        x = x + pgButton(m.pageHead, x, btnY, 58, label, "secondary", "calOpen", openWork, 24) + 10
    end if
    pgButton(m.pageHead, x, btnY, 58, "+  Add to watchlist", "secondary", "calWatch", selected, 24)

    ' Right: the agenda, grouped by day; within a day the releases without a time come first, then by time (web order).
    for each e in entries
        key = "1" + JsonString(e.release_at)
        if not calendarHasTime(e) then key = "0"
        e.sortKey = JsonString(e.date) + key
    end for
    entries.SortBy("sortKey")
    ay = 240.0
    lastDay = ""
    for each entry in entries
        edt = calendarEntryDate(entry)
        day = entry.date
        if day <> lastDay
            pgLabel(m.pageBody, 786.4, ay, 900, 28, calendarDayHeading(edt, false), 18, 600, "ink")
            ay = ay + 34
            lastDay = day
        end if
        pgRound(m.pageBody, 786.4, ay, 1048.8, 99.6, 14, "surfaceStrong")
        if entry.id = m.calendarSelected then pgRound(m.pageBody, 786.4, ay, 1048.8, 99.6, 14, "ink", 56, true)
        art = ""
        if entry.work_id <> invalid then art = m.serverUrl + "/api/v1/artwork/work/" + UrlEncode(entry.work_id) + "/poster"
        pgRound(m.pageBody, 802.4, ay + 19.8, 40, 60, 6, "surfaceSoft")
        pgArtwork(m.pageBody, 802.4, ay + 19.8, 40, 60, art)
        pgLabel(m.pageBody, 856.8, ay + 9, 900, 28, entry.title, 19, 600, "ink")
        pgLabel(m.pageBody, 856.8, ay + 40, 900, 28, calendarEntrySubtitle(entry), 19, 400, "inkSoft")
        calendarMetaRow(m.pageBody, 856.8, ay + 71, entry, 13)
        pgFocusable(786.4, ay, 1048.8, 99.6, 14, "entry", entry.id, true)
        ay = ay + 114
    end for
end sub

' Month grid (web calendar month): Monday-first weeks, up to four chips per day (a dot in the availability colour and the
' title), "+N more" and the day number at the bottom of the cell.
sub renderCalendarMonth(entries as Object)
    r = calendarViewRange()
    days = Int((calDate(r.finish).AsSeconds() - calDate(r.start).AsSeconds()) / 86400) + 1
    rows = Int(days / 7)
    gx = 154.0
    gy = 205.0
    cw = 237.4
    ch = 755.0 / rows
    byDay = {}
    for each entry in entries
        if entry.date <> invalid
            if byDay[entry.date] = invalid then byDay[entry.date] = []
            byDay[entry.date].Push(entry)
        end if
    end for
    names = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
    for c = 0 to 6
        pgLabel(m.pageBody, gx + c * cw, 183, cw, 16, names[c], 11, 700, "inkMuted", { horizAlign: "center" })
    end for
    for rr = 0 to rows
        pgRect(m.pageBody, gx, gy + rr * ch, cw * 7, 1, "line")
    end for
    for c = 0 to 7
        pgRect(m.pageBody, gx + c * cw, gy, 1, ch * rows, "line")
    end for
    maxChips = 4
    if rows > 5 then maxChips = 3
    today = calendarTodayString()
    todayIdx = 0
    for i = 0 to days - 1
        day = calAddDays(r.start, i)
        x = gx + (i mod 7) * cw
        y = gy + Int(i / 7) * ch
        list = byDay[day]
        n = 0
        if list <> invalid then n = list.Count()
        ' One chip per title ("Title · 2×" when it airs more than once that day), as web groups them.
        chips = []
        index = {}
        if list <> invalid
            for each e in list
                if index[e.title] = invalid
                    index[e.title] = chips.Count()
                    chips.Push({ title: e.title, count: 0, have: true })
                end if
                chip = chips[index[e.title]]
                chip.count = chip.count + 1
                if e.has_file <> true then chip.have = false
            end for
        end if
        n = chips.Count()
        shown = n
        if shown > maxChips then shown = maxChips
        for k = 0 to shown - 1
            role = "brand"
            if chips[k].have then role = "success"
            text = chips[k].title
            if chips[k].count > 1 then text = text + " · " + chips[k].count.ToStr() + "×"
            pgRound(m.pageBody, x + 10, y + 13 + k * 25.4, 6, 6, 3, role)
            pgLabel(m.pageBody, x + 22, y + 8 + k * 25.4, cw - 30, 18, text, 11, 600, "ink", { maxLines: 1 })
        end for
        pgLabel(m.pageBody, x + 10, y + ch - 24, 60, 16, Val(Mid(day, 9, 2)).ToStr(), 11, 600, "inkMuted")
        if n > shown then pgLabel(m.pageBody, x + 60, y + ch - 24, cw - 70, 16, "+" + (n - shown).ToStr() + " more", 11, 600, "inkMuted", { horizAlign: "right" })
        if day = today then todayIdx = m.pageItems.Count()
        pgFocusable(x + 1, y + 1, cw - 1, ch - 1, 6, "cell", day)
    end for
    m.pageFocusIdx = m.pageItems.Count() - days + 0
    if todayIdx > 0 then m.pageFocusIdx = todayIdx
end sub

' Week view (web calendar week): one column per day, a card per release with the availability colour on its left edge.
sub renderCalendarWeek(entries as Object)
    r = calendarViewRange()
    byDay = {}
    for each entry in entries
        if entry.date <> invalid
            if byDay[entry.date] = invalid then byDay[entry.date] = []
            byDay[entry.date].Push(entry)
        end if
    end for
    today = calendarTodayString()
    todayIdx = -1
    for c = 0 to 6
        day = calAddDays(r.start, c)
        x = 154.0 + c * 460
        dt = calDate(day)
        heading = dt.GetWeekday() + " " + Val(Mid(day, 9, 2)).ToStr() + " " + calendarMonthName(Val(Mid(day, 6, 2)), false)
        headLabel = pgLabel(m.pageBody, x, 176, 0, 28, heading, 18, 600, "ink")
        if day = today
            ' Web's TODAY chip beside the day heading.
            hx = x + headLabel.boundingRect().width + 10
            pgRound(m.pageBody, hx, 177, 61, 22, 11, "lineStrong", -1, true)
            pgLabel(m.pageBody, hx, 177, 61, 22, "TODAY", 11, 700, "ink", { horizAlign: "center", vertAlign: "center" })
        end if
        list = byDay[day]
        y = 208.0
        if list <> invalid
            for each entry in calendarDayList(list)
                ' Web's 4 px availability border follows the card's rounded corners: the accent shape under a card face shifted 4 px.
                role = "inkMuted"
                if entry.has_file = true then role = "success"
                pgRound(m.pageBody, x, y, 440, 106, 14, role)
                pgRound(m.pageBody, x + 4, y, 436, 106, 14, "surfaceStrong")
                pgRound(m.pageBody, x, y, 440, 106, 14, "line", -1, true)
                art = ""
                if entry.work_id <> invalid then art = m.serverUrl + "/api/v1/artwork/work/" + UrlEncode(entry.work_id) + "/poster"
                pgRound(m.pageBody, x + 16, y + 23, 40, 60, 6, "surfaceSoft")
                pgArtwork(m.pageBody, x + 16, y + 23, 40, 60, art)
                pgLabel(m.pageBody, x + 70, y + 9, 360, 26, entry.title, 20, 600, "ink", { maxLines: 1 })
                pgLabel(m.pageBody, x + 70, y + 40, 360, 26, calendarEntrySubtitle(entry), 20, 400, "inkSoft", { maxLines: 1 })
                calendarMetaRow(m.pageBody, x + 70, y + 70, entry, 13)
                pgFocusable(x, y, 440, 106, 14, "entry", entry.id, true)
                m.pageItems[m.pageItems.Count() - 1].sx = true
                y = y + 120
            end for
        end if
    end for
    if m.pageItems.Count() > 0 then m.pageFocusIdx = 0
end sub

' Status chip (web .calendar-badge): tinted pill with the status text. Returns its width.
function calendarBadge(parent as Object, x as Float, y as Float, h as Float, text as String, size as Integer) as Float
    ' Web .status-pill: the tone tints the fill (14%) and the border (60%); the text is the theme ink.
    tone = "inkSoft"
    if text = "Available" then tone = "success"
    if text = "Upcoming" then tone = "brand"
    if text = "Missing" then tone = "danger"
    probe = pgLabel(parent, x, y, 0, h, text, size, 700, "ink")
    w = probe.boundingRect().width + 27
    parent.removeChild(probe)
    pgRound(parent, x, y, w, h, 13, tone, 36)
    pgRound(parent, x, y, w, h, 13, tone, 153, true)
    pgLabel(parent, x, y, w, h, text, size, 700, "ink", { horizAlign: "center", vertAlign: "center" })
    return w
end function

sub calendarAction(item as Object)
    a = item.action
    m.calendarFocusAction = a
    m.calendarPlaceFirst = false
    if a = "calPrev" or a = "calNext"
        calendarEnsureRange()
        dir = 1
        if a = "calPrev" then dir = -1
        if m.calendarView = "month"
            m.calendarAnchor = calAddMonths(m.calendarAnchor, dir)
        else if m.calendarView = "week"
            m.calendarAnchor = calAddDays(m.calendarAnchor, 7 * dir)
        else
            m.calendarAnchor = calAddDays(m.calendarAnchor, 30 * dir)
        end if
        loadCalendar()
        renderCalendar()
    else if a = "calToday"
        m.calendarAnchor = invalid
        calendarEnsureRange()
        loadCalendar()
        renderCalendar()
    else if a = "calView"
        dialog = CreateObject("roSGNode", "Dialog")
        dialog.title = "Calendar view"
        dialog.buttons = ["Month", "Week", "Agenda"]
        dialog.ObserveField("buttonSelected", "onCalendarViewButton")
        dialog.ObserveField("wasClosed", "onCalendarViewDialogClosed")
        m.calendarViewDialogPendingClose = false
        m.top.dialog = dialog
        if m.artTelemetryEnabled = true then parityEmit("calendarDialog", "open")
    else if a = "cell"
        m.calendarFocusAction = ""
        m.calendarPlaceFirst = true
        m.calendarAnchor = item.data
        m.calendarView = "agenda"
        parityEmit("calendarView", m.calendarView)
        loadCalendar()
        renderCalendar()
    else if a = "calPlay"
        requestPlayback(item.data)
    else if a = "calOpen"
        openWorkDetail({ id: item.data, title: "", kind: "" }, "home")
    else if a = "calWatch"
        entry = item.data
        if entry.snapshot <> invalid then sendApi("watchlistAdd", "POST", "/api/v1/watchlist", entry.snapshot, true)
    else if a = "calLink"
        sendApi("calendarFeed", "POST", "/api/v1/calendar/feed", {}, true)
    else if a = "calFilters"
        openCalendarFilters()
    end if
    if a = "calPrev" or a = "calNext" or a = "calToday" or a = "cell" then pageFocusRender()
end sub

sub onCalendarViewDialogClosed(event as Object)
    if m.artTelemetryEnabled <> true then return
    if m.calendarViewDialogPendingClose <> true then return
    wasClosed = event.GetData()
    if wasClosed <> true then return
    m.calendarViewDialogPendingClose = false
    parityEmit("calendarDialog", "closed")
end sub

sub onCalendarViewButton(event as Object)
    index = event.GetData()
    if m.top.dialog <> invalid
        m.calendarViewDialogPendingClose = true
        m.top.dialog.close = true
    end if
    views = ["month", "week", "agenda"]
    if index >= 0 and index < views.Count()
        m.calendarView = views[index]
        parityEmit("calendarView", m.calendarView)
        m.calendarFocusAction = "calView"
        loadCalendar()
        renderCalendar()
        pageFocusRender()
    end if
end sub

sub openCalendarFilters()
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = "Filters"
    dialog.message = ["Choose the release types to show."]
    dialog.buttons = ["All", "Episodes", "Movies", "Albums"]
    dialog.ObserveField("buttonSelected", "onCalendarFilterButton")
    m.top.dialog = dialog
end sub

sub onCalendarFilterButton(event as Object)
    index = event.GetData()
    if m.top.dialog <> invalid then m.top.dialog.close = true
    kinds = [[], ["episode"], ["movie"], ["album"]]
    if index >= 0 and index < kinds.Count() then m.calendarKinds = kinds[index]
    loadCalendar()
end sub

sub acceptCalendarFeed(data as Dynamic)
    dialog = CreateObject("roSGNode", "Dialog")
    dialog.title = "Calendar link"
    if data <> invalid and data.url <> invalid
        dialog.message = ["Add this address to a calendar app that can subscribe to a feed:", data.url]
    else
        dialog.message = ["The calendar link could not be created."]
    end if
    dialog.buttons = ["OK"]
    dialog.ObserveField("buttonSelected", "onSimpleDialogButton")
    m.top.dialog = dialog
end sub

sub onSimpleDialogButton(event as Object)
    if m.top.dialog <> invalid then m.top.dialog.close = true
end sub

' ---------------------------------------------------------------------------
' Customise Home: per-user rail visibility and order, saved on every change (GET/PUT/DELETE /api/v1/home/rails/preferences).

sub renderCustomise()
    pageBegin("Customise Home", 729.6)
    rails = []
    if m.pageData <> invalid and m.pageData.rails <> invalid then rails = m.pageData.rails
    if m.pageStatus = "loading" and rails.Count() = 0
        pgLabel(m.pageBody, 786, 120, 600, 30, "Loading your Home rails…", 14, 400, "inkMuted")
        return
    end if
    pgLabel(m.pageBody, 786, 110, 1000, 24, "Choose which rails appear on Home and in what order.", 14, 400, "inkMuted")
    for i = 0 to rails.Count() - 1
        y = 160 + i * 84.0
        hidden = rails[i].hidden = true
        pgRound(m.pageBody, 786, y, 1048, 68, 12, "surfaceStrong")
        titleRole = "ink"
        if hidden then titleRole = "inkMuted"
        pgLabel(m.pageBody, 810, y, 640, 68, rails[i].title, 18, 700, titleRole, { vertAlign: "center" })
        shown = "Hide"
        if hidden then shown = "Show"
        pgButton(m.pageBody, 1480, y + 9, 50, shown, "secondary", "railToggle", i, 22)
        pgRound(m.pageBody, 1630, y + 9, 50, 50, 25, "surface")
        pgRound(m.pageBody, 1630, y + 9, 50, 50, 25, "line", -1, true)
        pgIcon(m.pageBody, 1646, y + 25, 18, "arrow-up.png", "inkSoft")
        pgFocusable(1630, y + 9, 50, 50, 25, "railUp", i)
        pgRound(m.pageBody, 1700, y + 9, 50, 50, 25, "surface")
        pgRound(m.pageBody, 1700, y + 9, 50, 50, 25, "line", -1, true)
        pgIcon(m.pageBody, 1716, y + 25, 18, "arrow-down.png", "inkSoft")
        pgFocusable(1700, y + 9, 50, 50, 25, "railDown", i)
    end for
    pgButton(m.pageBody, 786, 160 + rails.Count() * 84.0 + 12, 58, "Reset to default", "secondary", "railReset", invalid, 24)
end sub

sub customiseAction(item as Object)
    a = item.action
    if m.pageData = invalid or m.pageData.rails = invalid then return
    rails = m.pageData.rails
    if a = "railReset"
        sendApi("railPrefsReset", "DELETE", "/api/v1/home/rails/preferences", invalid, true)
        m.homeRailsChanged = true
        return
    end if
    i = item.data
    if i = invalid or i < 0 or i >= rails.Count() then return
    if a = "railToggle"
        rails[i].hidden = not (rails[i].hidden = true)
    else if a = "railUp" and i > 0
        t = rails[i]
        rails[i] = rails[i - 1]
        rails[i - 1] = t
    else if a = "railDown" and i < rails.Count() - 1
        t = rails[i]
        rails[i] = rails[i + 1]
        rails[i + 1] = t
    else
        return
    end if
    order = []
    hiddenIds = []
    for each rail in rails
        order.Push(rail.id)
        if rail.hidden = true then hiddenIds.Push(rail.id)
    end for
    sendApi("railPrefsSave", "PUT", "/api/v1/home/rails/preferences", { order: order, hidden: hiddenIds }, true)
    m.homeRailsChanged = true
    keep = m.pageFocusIdx
    renderCustomise()
    m.pageFocusIdx = keep
    pageFocusRender()
end sub

sub pageLeaveToHome()
    if m.pageKind = "customise" and m.homeRailsChanged = true
        m.homeRailsChanged = false
        enterHome(m.currentProfileName)
        return
    end if
    showOnly("home")
    m.top.screenState = "home"
    focusCurrentHomeRail()
end sub

' ---------------------------------------------------------------------------
' Household gate (web HouseholdBlockedScreen): while the profile is outside its schedule or out of budget the app shows
' "Not available right now" with "Ask a guardian for more time" and "Switch profile". The server decides; this only
' polls GET /api/v1/household/status (every 30 s and on entering Home) so the screen appears before a request fails.

sub householdPoll()
    if m.refreshToken = invalid or m.refreshToken = "" then return
    sendApi("householdStatus", "GET", "/api/v1/household/status", invalid, true)
end sub

sub acceptHouseholdStatus(data as Dynamic)
    m.householdBlock = invalid
    if data <> invalid
        if data.state = "outside_schedule"
            m.householdBlock = { kind: "schedule", until: data.next_start_at }
        else if data.state = "budget_exhausted"
            m.householdBlock = { kind: "budget", until: data.resets_at }
        end if
    end if
    if m.householdBlock <> invalid
        if m.top.screenState <> "page" or m.pageKind <> "household"
            openPage("household")
        end if
    else if m.top.screenState = "page" and m.pageKind = "household"
        enterHome(m.currentProfileName)
    end if
end sub

function householdUntilText(iso as Dynamic) as String
    if iso = invalid or iso = "" then return ""
    dt = CreateObject("roDateTime")
    dt.FromISO8601String(iso)
    dt.ToLocalTime()
    return calendarDayHeading(dt, true) + ", " + calendarTime(dt)
end function

sub renderHousehold()
    pageBegin("", 0)
    m.pageHead.removeChildrenIndex(m.pageHead.getChildCount(), 0)
    m.pageItems = []
    block = m.householdBlock
    title = "Not available right now"
    description = "This profile can’t watch at this time."
    if block <> invalid
        until = householdUntilText(block.until)
        if block.kind = "schedule"
            if until <> "" then description = "This profile can watch again at " + until + "."
        else
            title = "That’s all for today"
            description = "Today’s watch time is used up."
            if until <> "" then description = "Today’s watch time is used up. It resets at " + until + "."
        end if
    end if
    pgRound(m.pageBody, 742.8, 129.6, 164, 164, 82, "surface", 138)
    pgRound(m.pageBody, 742.8, 129.6, 164, 164, 82, "line", -1, true)
    pgIcon(m.pageBody, 804, 191, 40, "icon-empty.png", "brand")
    pgLabel(m.pageBody, 948.8, 181, 460, 36, title, 22, 700, "ink")
    pgLabel(m.pageBody, 948.8, 223.7, 240, 34, description, 11, 400, "inkMuted", { wrap: true, maxLines: 2 })
    askW = pgButton(m.pageBody, 723.6, 313.6, 50, "Ask a guardian for more time", "secondary", "hhAsk", invalid, 26)
    pgButton(m.pageBody, 723.6 + askW + 12, 313.6, 50, "Switch profile", "secondary", "hhSwitch", invalid, 26)
    if m.householdNote <> invalid and m.householdNote <> "" then pgLabel(m.pageBody, 723.6, 384, 900, 24, m.householdNote, 13, 400, "inkMuted")
end sub

sub householdAction(item as Object)
    if item.action = "hhSwitch"
        loadProfiles()
    else if item.action = "hhAsk"
        subject = "schedule"
        if m.householdBlock <> invalid and m.householdBlock.kind = "budget" then subject = "budget"
        sendApi("householdAsk", "POST", "/api/v1/household/approvals", { kind: "time", subject: subject }, true)
        m.householdNote = "Request sent. A guardian can approve it on their profile."
        renderHousehold()
        pageFocusRender()
    end if
end sub

' Library header chrome (web .tv-library-heading): round back button, a divider before the title count, and the Filters pill.
sub browseChromeInit()
    holder = m.top.findNode("browseGroup")
    pgRound(holder, 153.6, 56.3, 50, 50, 25, "surface", 179)
    pgRound(holder, 153.6, 56.3, 50, 50, 25, "line", -1, true)
    pgIcon(holder, 170, 73, 17, "arrow-left.png", "inkSoft")
    m.browseDivider = pgRect(holder, 348, 57, 1, 48, "line")
    tx = shellActionX()
    ty = shellActionY(0)
    pgRound(holder, tx, ty, 62, 72, 14, "surfaceStrong", 199)
    pgRound(holder, tx, ty, 62, 72, 14, "line", -1, true)
    pgIcon(holder, tx + 20, ty + 15, 22, "tile-filters.png", "inkMuted")
    pgLabel(holder, tx, ty + 44, 62, 14, "Filters", 8, 800, "inkMuted", { horizAlign: "center" })
    m.browseFiltersRing = CreateObject("roSGNode", "Poster")
    m.browseFiltersRing.uri = "pkg:/images/round-ring-r12.9.png"
    m.browseFiltersRing.translation = [tx - 3, ty - 3]
    m.browseFiltersRing.width = 68
    m.browseFiltersRing.height = 78
    ThemeSetRole(m.browseFiltersRing, "focusRing")
    m.browseFiltersRing.blendColor = ThemeColor("focusRing")
    m.browseFiltersRing.visible = false
    holder.AppendChild(m.browseFiltersRing)
end sub

' ---------------------------------------------------------------------------
' Scroll edge fades (one component for every scrollable area): a page-background ramp where content continues off-screen.
' Rails: the left fade sits in the gutter left of the track start (cards scrolled past the start line vanish under it);
' grids and panels fade at the top and bottom.

function pgFade(parent as Object, side as String, x as Float, y as Float, w as Float, h as Float) as Object
    fade = CreateObject("roSGNode", "Poster")
    fade.uri = "pkg:/images/edge-fade-" + side + ".png"
    fade.translation = [x, y]
    fade.width = w
    fade.height = h
    fade.blendColor = ThemeColor("bg")
    ThemeSetRole(fade, "bg")
    fade.visible = false
    parent.AppendChild(fade)
    return fade
end function

sub edgeFadesInit()
    home = m.top.findNode("homeGroup")
    m.homeFadeLeft = pgFade(home, "l", 786, 410, 96, 670)
    m.homeFadeRight = pgFade(home, "r", 1824, 410, 96, 670)
    browse = m.top.findNode("browseGroup")
    m.browseFadeTop = pgFade(browse, "t", 740, 128, 1110, 40)
    m.browseFadeBottom = pgFade(browse, "b", 740, 1000, 1110, 80)
    m.pageFadeTop = pgFade(m.top.findNode("pageGroup"), "t", 0, 128, 1920, 56)
    m.pageFadeBottom = pgFade(m.top.findNode("pageGroup"), "b", 0, 1000, 1920, 80)
end sub

' Home rails: the left fade once the rail is scrolled, the right fade while more cards continue past the edge.
sub homeFadesUpdate(itemIndex as Integer, total as Integer)
    m.homeFadeLeft.visible = itemIndex > 0
    m.homeFadeRight.visible = total - itemIndex > 5
end sub

sub browseFadesUpdate(itemIndex as Integer)
    row = Int(itemIndex / 3)
    totalRows = Int((m.browseItems.Count() + 2) / 3)
    m.browseFadeTop.visible = row > 0
    m.browseFadeBottom.visible = (row + 3 < totalRows) or (m.browseTotal <> invalid and m.browseItems.Count() < m.browseTotal)
end sub

sub pageFadesUpdate(contentBottom as Float)
    m.pageFadeTop.visible = m.pageScrollY < 0
    m.pageFadeBottom.visible = contentBottom + m.pageScrollY > 1040
end sub
