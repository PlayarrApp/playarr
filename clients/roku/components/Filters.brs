' Library filters drawer (web FiltersDrawer in Library.tsx): View (List, Screen, Cover), Sort by, Order, and the Audio and Subtitle
' language multi-selects. Built on the shared drawer panel; Sort, Order and the languages refetch the library, View reflows it.
' State lives on m: browseView, browseSort, browseOrder, browseAudioLangs, browseSubLangs ({code, name, count} facets in
' browseLangFacets). Focus rows: 0 View (3), 1 Sort (2), 2 Order (2), 3 Audio language, 4 Subtitle language, 5 Clear languages.

sub filtersOpen()
    if m.filtersGroup = invalid
        m.filtersGroup = CreateObject("roSGNode", "Group")
        m.filtersGroup.visible = false
        m.top.AppendChild(m.filtersGroup)
    end if
    m.filtersOpen = true
    m.global.cardFocusOff = true
    m.filtersRow = 0
    m.filtersCol = 0
    if m.browseView = "list" then m.filtersCol = 0
    if m.browseView = "screen" then m.filtersCol = 1
    if m.browseView = "cover" then m.filtersCol = 2
    m.filtersPicker = ""
    m.browseFiltersMode = true
    m.browseFiltersPanel.visible = false
    filtersLoadFacets()
    filtersRender()
    m.filtersGroup.visible = true
    m.top.SetFocus(true)
    parityEmit("screen", "drawer")
    filtersEmitFocus()
end sub

sub filtersClose()
    m.filtersGroup.visible = false
    m.filtersOpen = false
    m.global.cardFocusOff = false
    m.browseFiltersMode = false
    parityEmit("screen", "browse")
    m.browseGrid.SetFocus(true)
end sub

sub filtersLoadFacets()
    path = "/api/v1/catalog/languages?kind=" + m.browseKind + "&available_only=true"
    if m.browseAudioLangs.Count() > 0 then path = path + "&audio_lang=" + joinStrings(m.browseAudioLangs, ",")
    if m.browseSubLangs.Count() > 0 then path = path + "&subtitle_lang=" + joinStrings(m.browseSubLangs, ",")
    sendApi("browseLanguages", "GET", path, invalid, true)
end sub

sub acceptBrowseLanguages(data as Dynamic)
    m.browseLangFacets = { audio: [], subtitle: [] }
    if data <> invalid
        if data.audio <> invalid then m.browseLangFacets.audio = data.audio
        if data.subtitle <> invalid then m.browseLangFacets.subtitle = data.subtitle
    end if
    m.browseLangLoaded = true
    if m.filtersOpen = true then filtersRender()
end sub

' "Any language", or the chosen names (codes the facets no longer list keep their code).
function filtersLangSummary(codes as Object, facets as Object) as String
    if codes.Count() = 0 then return "Any language"
    names = []
    for each code in codes
        name = UCase(code)
        for each f in facets
            if f.code = code then name = f.name
        end for
        names.Push(name)
    end for
    return joinStrings(names, ", ")
end function

sub filtersRender()
    g = m.filtersGroup
    g.removeChildrenIndex(g.getChildCount(), 0)
    pgRect(g, 1560, 0, 360, 1080, "panel")
    pgLabel(g, 1606, 56, 190, 16, "LIBRARY CONTROLS", 11, 700, "inkMuted")
    pgLabel(g, 1606, 82, 200, 56, "Filters", 36, 600, "ink")
    pgRound(g, 1826, 54, 48, 48, 24, "surface", 179)
    pgRound(g, 1826, 54, 48, 48, 24, "line", -1, true)
    pgIcon(g, 1838, 66, 24, "player-close.png", "ink")
    if m.filtersPicker <> ""
        filtersRenderPicker(g)
        return
    end if
    m.filtersFocus = []
    pgLabel(g, 1606, 162, 250, 16, "VIEW", 10, 700, "inkMuted")
    views = ["list", "screen", "cover"]
    names = ["List", "Screen", "Cover"]
    for i = 0 to 2
        x = 1606 + 92 * i
        filtersTile(g, x, 190, 84, 56, names[i], m.browseView = views[i], 0, i, views[i])
    end for
    pgLabel(g, 1606, 275, 250, 16, "SORT BY", 10, 700, "inkMuted")
    filtersTile(g, 1605, 302, 131, 56, "Title", m.browseSort = "title", 1, 0, "")
    filtersTile(g, 1744, 302, 130, 56, "Date Added", m.browseSort = "date_added", 1, 1, "")
    pgLabel(g, 1606, 388, 250, 16, "ORDER", 10, 700, "inkMuted")
    ascText = "A-Z"
    descText = "Z-A"
    if m.browseSort = "date_added"
        ascText = "Oldest first"
        descText = "Newest first"
    end if
    filtersTile(g, 1605, 415, 131, 56, ascText, m.browseOrder = "asc", 2, 0, "")
    filtersTile(g, 1744, 415, 130, 56, descText, m.browseOrder = "desc", 2, 1, "")
    facets = { audio: [], subtitle: [] }
    if m.browseLangFacets <> invalid then facets = m.browseLangFacets
    pgLabel(g, 1606, 500, 250, 16, "AUDIO LANGUAGE", 10, 700, "inkMuted")
    filtersSelect(g, 528, filtersLangSummary(m.browseAudioLangs, facets.audio), 3)
    pgLabel(g, 1606, 616, 250, 16, "SUBTITLE LANGUAGE", 10, 700, "inkMuted")
    filtersSelect(g, 643, filtersLangSummary(m.browseSubLangs, facets.subtitle), 4)
    if m.browseAudioLangs.Count() + m.browseSubLangs.Count() > 0
        filtersTile(g, 1606, 726, 268, 48, "Clear languages", false, 5, 0, "")
    end if
    filtersRenderRing()
end sub

' A segmented-control tile: ink fill and on-accent text when chosen, a soft tinted pill otherwise.
sub filtersTile(g as Object, x as Float, y as Float, w as Float, h as Float, text as String, chosen as Boolean, row as Integer, col as Integer, icon as String)
    if chosen
        pgRound(g, x, y, w, h, 12, "ink")
    else
        pgRound(g, x, y, w, h, 12, "surfaceSoft", 170)
        pgRound(g, x, y, w, h, 12, "line", -1, true)
    end if
    role = "inkSoft"
    if chosen then role = "onAccent"
    if icon <> ""
        filtersViewIcon(g, x + w / 2, y + 14, icon, role)
        pgLabel(g, x, y + 33, w, 16, text, 11, 700, role, { horizAlign: "center" })
    else
        pgLabel(g, x, y, w, h, text, 11, 700, role, { horizAlign: "center", vertAlign: "center" })
    end if
    m.filtersFocus.Push({ row: row, col: col, x: x, y: y, w: w, h: h })
end sub

' The View glyphs of web's ViewToggle: stacked bars (List), three wide cards (Screen), three tall cards (Cover).
sub filtersViewIcon(g as Object, cx as Float, y as Float, kind as String, role as String)
    if kind = "list"
        for i = 0 to 3
            pgRect(g, cx - 10, y + 2 + i * 4, 20, 2, role)
        end for
    else if kind = "screen"
        for i = 0 to 2
            pgRound(g, cx - 12 + i * 9, y + 2, 7, 15, 2, role, -1, true)
        end for
    else
        for i = 0 to 2
            pgRound(g, cx - 12 + i * 9, y, 7, 18, 2, role, -1, true)
        end for
    end if
end sub

sub filtersSelect(g as Object, y as Float, text as String, row as Integer)
    pgRound(g, 1606, y, 268, 58, 12, "surfaceSoft", 170)
    pgRound(g, 1606, y, 268, 58, 12, "line", -1, true)
    pgLabel(g, 1625, y, 215, 58, text, 12, 700, "ink", { vertAlign: "center", maxLines: 1 })
    pgIcon(g, 1844, y + 22, 14, "chevron-down.png", "inkSoft")
    m.filtersFocus.Push({ row: row, col: 0, x: 1606, y: y, w: 268, h: 58 })
end sub

sub filtersRenderRing()
    for each f in m.filtersFocus
        if f.row = m.filtersRow and f.col = m.filtersCol
            ring = pgRound(m.filtersGroup, f.x - 3, f.y - 3, f.w + 6, f.h + 6, 15, "focusRing", -1, true)
            pgRound(m.filtersGroup, f.x - 2, f.y - 2, f.w + 4, f.h + 4, 14, "focusRing", -1, true)
        end if
    end for
end sub

function filtersRowSize(row as Integer) as Integer
    if row = 0 then return 3
    if row = 1 or row = 2 then return 2
    return 1
end function

function filtersRowCount() as Integer
    if m.browseAudioLangs.Count() + m.browseSubLangs.Count() > 0 then return 6
    return 5
end function

sub filtersEmitFocus()
    if m.filtersPicker <> ""
        parityEmit("focus", "language " + m.filtersPickerIndex.ToStr())
        return
    end if
    labels = [["List", "Screen", "Cover"], ["Title", "Date Added"], ["A-Z", "Z-A"], ["Audio language"], ["Subtitle language"], ["Clear languages"]]
    parityEmit("focus", labels[m.filtersRow][m.filtersCol])
end sub

' ---------------------------------------------------------------------------
' Language picker: one row per facet (name and title count), OK toggles it, Back returns to the drawer.

sub filtersOpenPicker(which as String)
    m.filtersPicker = which
    m.filtersPickerIndex = 0
    m.filtersPickerTop = 0
    filtersRender()
    filtersEmitFocus()
end sub

function filtersPickerList() as Object
    facets = { audio: [], subtitle: [] }
    if m.browseLangFacets <> invalid then facets = m.browseLangFacets
    if m.filtersPicker = "audio" then return facets.audio
    return facets.subtitle
end function

function filtersPickerSelected() as Object
    if m.filtersPicker = "audio" then return m.browseAudioLangs
    return m.browseSubLangs
end function

sub filtersRenderPicker(g as Object)
    title = "Audio language"
    if m.filtersPicker = "subs" then title = "Subtitle language"
    pgLabel(g, 1606, 162, 250, 16, UCase(title), 10, 700, "inkMuted")
    list = filtersPickerList()
    chosen = filtersPickerSelected()
    if list.Count() = 0
        pgLabel(g, 1606, 200, 268, 40, "No languages available.", 12, 400, "inkMuted")
        return
    end if
    rows = 11
    if m.filtersPickerIndex < m.filtersPickerTop then m.filtersPickerTop = m.filtersPickerIndex
    if m.filtersPickerIndex >= m.filtersPickerTop + rows then m.filtersPickerTop = m.filtersPickerIndex - rows + 1
    for i = 0 to rows - 1
        idx = m.filtersPickerTop + i
        if idx < list.Count()
            y = 190 + i * 70
            isOn = false
            for each c in chosen
                if c = list[idx].code then isOn = true
            end for
            if isOn
                pgRound(g, 1606, y, 268, 60, 12, "ink")
            else
                pgRound(g, 1606, y, 268, 60, 12, "surfaceSoft", 170)
                pgRound(g, 1606, y, 268, 60, 12, "line", -1, true)
            end if
            role = "ink"
            if isOn then role = "onAccent"
            pgLabel(g, 1625, y, 170, 60, list[idx].name, 12, 700, role, { vertAlign: "center", maxLines: 1 })
            pgLabel(g, 1795, y, 62, 60, JsonString(list[idx].count), 11, 400, role, { vertAlign: "center", horizAlign: "right" })
            if idx = m.filtersPickerIndex
                pgRound(g, 1603, y - 3, 274, 66, 15, "focusRing", -1, true)
                pgRound(g, 1604, y - 2, 272, 64, 14, "focusRing", -1, true)
            end if
        end if
    end for
end sub

' ---------------------------------------------------------------------------

function filtersOnKey(key as String) as Boolean
    if m.filtersPicker <> ""
        list = filtersPickerList()
        if key = "up" and m.filtersPickerIndex > 0
            m.filtersPickerIndex = m.filtersPickerIndex - 1
        else if key = "down" and m.filtersPickerIndex < list.Count() - 1
            m.filtersPickerIndex = m.filtersPickerIndex + 1
        else if key = "OK" and list.Count() > 0
            filtersToggleLanguage(list[m.filtersPickerIndex].code)
            return true
        else if key = "back"
            m.filtersPicker = ""
            filtersLoadFacets()
        end if
        filtersRender()
        filtersEmitFocus()
        return true
    end if
    if key = "back"
        filtersClose()
    else if key = "up" and m.filtersRow > 0
        m.filtersRow = m.filtersRow - 1
        if m.filtersCol >= filtersRowSize(m.filtersRow) then m.filtersCol = filtersRowSize(m.filtersRow) - 1
    else if key = "down" and m.filtersRow < filtersRowCount() - 1
        m.filtersRow = m.filtersRow + 1
        if m.filtersCol >= filtersRowSize(m.filtersRow) then m.filtersCol = filtersRowSize(m.filtersRow) - 1
    else if key = "left" and m.filtersCol > 0
        m.filtersCol = m.filtersCol - 1
    else if key = "right" and m.filtersCol < filtersRowSize(m.filtersRow) - 1
        m.filtersCol = m.filtersCol + 1
    else if key = "OK"
        filtersChoose()
        return true
    end if
    filtersRender()
    filtersEmitFocus()
    return true
end function

sub filtersChoose()
    row = m.filtersRow
    if row = 0
        views = ["list", "screen", "cover"]
        if m.browseView <> views[m.filtersCol]
            m.browseView = views[m.filtersCol]
            applyBrowseView()
            rebuildBrowseContent()
        end if
    else if row = 1
        sorts = ["title", "date_added"]
        if m.browseSort <> sorts[m.filtersCol]
            m.browseSort = sorts[m.filtersCol]
            filtersRefetch()
        end if
    else if row = 2
        orders = ["asc", "desc"]
        if m.browseOrder <> orders[m.filtersCol]
            m.browseOrder = orders[m.filtersCol]
            filtersRefetch()
        end if
    else if row = 3
        filtersOpenPicker("audio")
        return
    else if row = 4
        filtersOpenPicker("subs")
        return
    else if row = 5
        m.browseAudioLangs = []
        m.browseSubLangs = []
        m.filtersRow = 3
        filtersRefetch()
        filtersLoadFacets()
    end if
    filtersRender()
    filtersEmitFocus()
end sub

sub filtersToggleLanguage(code as String)
    current = filtersPickerSelected()
    updated = []
    found = false
    for each c in current
        if c = code then found = true else updated.Push(c)
    end for
    if not found then updated.Push(code)
    if m.filtersPicker = "audio" then m.browseAudioLangs = updated else m.browseSubLangs = updated
    filtersRefetch()
    filtersRender()
end sub

' Sort, Order and the language filters change what the server returns: reload the first page.
sub filtersRefetch()
    m.browseItems = []
    m.browseTotal = invalid
    loadBrowseCatalog(false)
end sub
