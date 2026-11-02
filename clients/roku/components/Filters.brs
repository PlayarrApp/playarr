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
    drawerChrome(g, "Library controls", "Filters", "Close filters")
    if m.filtersPicker <> ""
        filtersRenderPicker(g)
        return
    end if
    m.filtersFocus = []
    if m.filtersRow < 0
        ' Web's Close button is a focus stop above the first row.
        pgRound(g, 1823, 51, 54, 56, 28, "focusRing", -1, true)
        pgRound(g, 1824, 52, 52, 54, 27, "focusRing", -1, true)
    end if
    filtersHeading(g, 163.4, "VIEW")
    views = ["list", "screen", "cover"]
    names = ["List", "Screen", "Cover"]
    for i = 0 to 2
        filtersViewTile(g, 1606 + 92 * i, names[i], m.browseView = views[i], i, views[i])
    end for
    filtersHeading(g, 276.1, "SORT BY")
    filtersChoice(g, 1605.5, 302, 131, "Title", PlayarrTextWidth("Title", 10.56, 680, 0), m.browseSort = "title", 1, 0)
    filtersChoice(g, 1744, 302, 130, "Date Added", PlayarrTextWidth("Date Added", 10.56, 680, 0), m.browseSort = "date_added", 1, 1)
    filtersHeading(g, 388.7, "ORDER")
    ascText = "A-Z"
    descText = "Z-A"
    if m.browseSort = "date_added"
        ascText = "Oldest first"
        descText = "Newest first"
    end if
    ascW = PlayarrTextWidth(ascText, 10.56, 680, 0)
    descW = PlayarrTextWidth(descText, 10.56, 680, 0)
    filtersChoice(g, 1605.5, 415, 131, ascText, ascW, m.browseOrder = "asc", 2, 0)
    filtersChoice(g, 1744, 415, 130, descText, descW, m.browseOrder = "desc", 2, 1)
    facets = { audio: [], subtitle: [] }
    if m.browseLangFacets <> invalid then facets = m.browseLangFacets
    filtersHeading(g, 501.3, "AUDIO LANGUAGE")
    filtersSelect(g, 527.7, filtersLangSummary(m.browseAudioLangs, facets.audio), 3)
    filtersHeading(g, 616.7, "SUBTITLE LANGUAGE")
    filtersSelect(g, 643.1, filtersLangSummary(m.browseSubLangs, facets.subtitle), 4)
    if m.browseAudioLangs.Count() + m.browseSubLangs.Count() > 0
        filtersTile(g, 1606, 726, 268, 48, "Clear languages", false, 5, 0, "")
    end if
    filtersRenderRing()
end sub

' A drawer section heading (web h3): 9.6 px caps, 0.07 em.
sub filtersHeading(g as Object, y as Float, text as String)
    pgLabel(g, 1606, y, 190, 13, text, 9.6, 720, "inkMuted", { tracking: 0.07 * 9.6, aria: "heading" })
end sub

' A tile chosen in a segmented control is drawn 1.0249 times larger about its centre (web transform).
function filtersScaled(chosen as Boolean) as Float
    if chosen then return 1.0249
    return 1.0
end function

' The View tiles: glyph over a lower-case name. (x) is the tile's left edge; geometry is the web's unscaled numbers.
sub filtersViewTile(g as Object, x as Float, name as String, chosen as Boolean, col as Integer, kind as String)
    s = filtersScaled(chosen)
    cx = x + 42
    cy = 217.8
    bx = cx + s * (x - cx)
    by = cy + s * (189.8 - cy)
    bw = 84 * s
    bh = 56 * s
    if chosen
        pgRound(g, bx, by, bw, bh, 12, "ink")
    else
        pgRound(g, bx, by, bw, bh, 12, "surfaceSoft", 170)
        pgRound(g, bx, by, bw, bh, 12, "line", -1, true)
    end if
    role = "inkMuted"
    if chosen then role = "bg"
    pgMark(g, "button", kind, bx, by, bw, bh, 12)
    for i = 0 to 2
        if kind = "list"
            ux = x + 32
            uy = 201.2 + i * 4.95
            uw = 20.0
            uh = 2.9
        else if kind = "screen"
            ux = x + 32.05 + 7.32 * i
            uy = 201.21
            uw = 5.37
            uh = 12.78
        else
            ux = x + 34 + 6 * i
            uy = 201.1
            uw = 4.0
            uh = 13.0
        end if
        gx = cx + s * (ux - cx)
        gy = cy + s * (uy - cy)
        pgTag(pgRound(g, gx, gy, uw * s, uh * s, 1, role), "container", 1)
    end for
    ' Web tile label: 0.66rem, weight 900, no letter-spacing, centred; its width is the font's advances.
    tw = PlayarrTextWidth(name, 10.56, 900, 0)
    tx = cx - tw / 2
    ty = 220.8
    tgx = cx + s * (tx - cx)
    tgy = cy + s * (ty - cy)
    l = pgLabel(g, tgx, tgy, tw * s + 4, 15 * s, name, 10.56 * s, 900, role)
    m.filtersFocus.Push({ row: 0, col: col, x: x, y: 189.8, w: 84, h: 56 })
end sub

' A Sort by / Order choice: the tile is a button whose text is its only child, so the web reports the text run.
sub filtersChoice(g as Object, x as Float, y as Float, w as Float, text as String, tw as Float, chosen as Boolean, row as Integer, col as Integer)
    s = filtersScaled(chosen)
    cx = x + w / 2
    cy = y + 28
    bx = cx + s * (x - cx)
    by = cy + s * (y - cy)
    if chosen
        pgTag(pgRound(g, bx, by, w * s, 56 * s, 12, "ink"), "button", 12, text)
    else
        pgTag(pgRound(g, bx, by, w * s, 56 * s, 12, "surfaceSoft", 170), "button", 12, text)
        pgRound(g, bx, by, w * s, 56 * s, 12, "line", -1, true)
    end if
    role = "inkMuted"
    if chosen
        role = "bg"
    end if
    tx = cx - tw * s / 2
    ty = y + 20.4 - 7.5 * (s - 1)
    l = pgLabel(g, tx, ty, tw * s + 4, 15 * s, text, 10.56 * s, 680, role)
    m.filtersFocus.Push({ row: row, col: col, x: x, y: y, w: w, h: 56 })
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
    pgLabel(g, x, y, w, h, text, 11.5, 700, role, { horizAlign: "center", vertAlign: "center" })
    m.filtersFocus.Push({ row: row, col: col, x: x, y: y, w: w, h: h })
end sub

sub filtersSelect(g as Object, y as Float, text as String, row as Integer)
    pgRound(g, 1606, y, 268, 58.8, 12, "surfaceSoft", 170)
    pgRound(g, 1606, y, 268, 58.8, 12, "line", -1, true)
    pgMark(g, "button", text, 1606, y, 268, 58.8, 12)
    tw = PlayarrTextWidth(text, 11.84, 680, 0)
    l = pgLabel(g, 1625.4, y + 20.5, 215, 16, text, 11.84, 680, "ink", { maxLines: 1 })
    pgGlyph(g, "⌄", 1844.7, y + 20.5, 11.84, 680, "inkMuted")
    m.filtersFocus.Push({ row: row, col: 0, x: 1606, y: y, w: 268, h: 58.8 })
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
    if m.filtersRow < 0
        parityEmit("focus", "Close filters")
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
    else if key = "OK" and m.filtersRow < 0
        filtersClose()
        return true
    else if key = "up" and m.filtersRow = 0
        m.filtersRow = -1
    else if key = "down" and m.filtersRow < 0
        m.filtersRow = 0
        m.filtersCol = 0
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

' ---------------------------------------------------------------------------
' Release Calendar filters drawer (web FiltersDrawer in Calendar.tsx): View (Month, Week, Agenda), Type, Status (multi-select,
' values OR-ed within a section and AND-ed across sections), Monitored only and Clear filters. State on m: calFilterTypes,
' calFilterStatuses ({name: true}) and calFilterMonitored. Focus rows: 0 View, 1-2 Type, 3-4 Status, 5 Monitored, 6 Clear.

function calFilterTypeNames() as Object
    return ["tv", "movie", "music", "book"]
end function

function calFilterStatusNames() as Object
    return ["aired", "upcoming", "downloaded", "missing"]
end function

function calFilterActive() as Boolean
    return m.calFilterTypes.Count() > 0 or m.calFilterStatuses.Count() > 0 or m.calFilterMonitored = true
end function

' Web applyCalendarFilters: aired is a release day up to today, downloaded has a file, missing is aired without one.
function calendarApplyFilters(entries as Object) as Object
    if not calFilterActive() then return entries
    kindForType = { tv: "episode", movie: "movie", music: "album", book: "book" }
    today = calendarTodayString()
    out = []
    for each entry in entries
        keep = true
        if m.calFilterTypes.Count() > 0
            keep = false
            for each t in m.calFilterTypes
                if kindForType[t] = entry.media_kind then keep = true
            end for
        end if
        if keep and m.calFilterStatuses.Count() > 0
            aired = calendarEntryLocalDay(entry) <= today
            keep = false
            if m.calFilterStatuses.aired = true and aired then keep = true
            if m.calFilterStatuses.upcoming = true and not aired then keep = true
            if m.calFilterStatuses.downloaded = true and entry.has_file = true then keep = true
            if m.calFilterStatuses.missing = true and aired and entry.has_file <> true then keep = true
        end if
        if keep and m.calFilterMonitored = true and entry.monitored <> true then keep = false
        if keep then out.Push(entry)
    end for
    return out
end function

sub calFiltersOpen()
    if m.filtersGroup = invalid
        m.filtersGroup = CreateObject("roSGNode", "Group")
        m.filtersGroup.visible = false
        m.top.AppendChild(m.filtersGroup)
    end if
    m.calFiltersOpen = true
    m.global.cardFocusOff = true
    m.filtersRow = 0
    m.filtersCol = 0
    if m.calendarView = "week" then m.filtersCol = 1
    if m.calendarView = "agenda" then m.filtersCol = 2
    calFiltersRender()
    m.filtersGroup.visible = true
    m.top.SetFocus(true)
    parityEmit("screen", "drawer")
    calFiltersEmitFocus()
end sub

sub calFiltersClose()
    m.filtersGroup.visible = false
    m.calFiltersOpen = false
    m.global.cardFocusOff = false
    parityEmit("screen", "page")
    m.top.SetFocus(true)
    pageFocusRender()
end sub

sub calFiltersRender()
    g = m.filtersGroup
    g.removeChildrenIndex(g.getChildCount(), 0)
    pgRect(g, 1560, 0, 360, 1080, "drawerBase")
    pgTint(g, 1560, 0, 360, 1080, "drawerPanel")
    pgLabel(g, 1606, 52, 190, 16, "CALENDAR", 11, 700, "inkMuted")
    pgLabel(g, 1606, 75, 200, 56, "Filters", 36, 600, "ink")
    pgRound(g, 1826.5, 54.5, 49, 49, 25, "surfaceSoft")
    pgRound(g, 1826.5, 54.5, 49, 49, 25, "line", -1, true)
    pgGlyph(g, "×", 1841.9, 60.84, 26.88, 720, "ink", false)
    pgMark(g, "button", "Close filters", 1826.5, 54.5, 49, 49, 25)
    if m.filtersRow < 0
        ' Web's Close button is a focus stop above the first row.
        pgRound(g, 1823.5, 51.5, 55, 55, 28, "focusRing", -1, true)
        pgRound(g, 1824.5, 52.5, 53, 53, 27, "focusRing", -1, true)
    end if
    m.filtersFocus = []
    pgLabel(g, 1606, 162, 250, 16, "VIEW", 10, 700, "inkMuted")
    views = ["month", "week", "agenda"]
    names = ["Month", "Week", "Agenda"]
    for i = 0 to 2
        filtersTile(g, 1606 + 92 * i, 190, 84, 56, names[i], m.calendarView = views[i], 0, i, "")
    end for
    pgLabel(g, 1606, 275, 250, 16, "TYPE", 10, 700, "inkMuted")
    typeLabels = ["TV", "Movies", "Music", "Books"]
    types = calFilterTypeNames()
    for i = 0 to 3
        filtersTile(g, 1605 + 139 * (i mod 2), 302 + 66 * Int(i / 2), 130, 56, typeLabels[i], m.calFilterTypes[types[i]] = true, 1 + Int(i / 2), i mod 2, "")
    end for
    pgLabel(g, 1606, 440, 250, 16, "STATUS", 10, 700, "inkMuted")
    statusLabels = ["Aired", "Upcoming", "Downloaded", "Missing"]
    statuses = calFilterStatusNames()
    for i = 0 to 3
        filtersTile(g, 1605 + 139 * (i mod 2), 467 + 66 * Int(i / 2), 130, 56, statusLabels[i], m.calFilterStatuses[statuses[i]] = true, 3 + Int(i / 2), i mod 2, "")
    end for
    pgLabel(g, 1606, 605, 250, 16, "MONITORED", 10, 700, "inkMuted")
    filtersTile(g, 1606, 632, 268, 56, "Monitored only", m.calFilterMonitored = true, 5, 0, "")
    if calFilterActive() then filtersTile(g, 1606, 716, 268, 48, "Clear filters", false, 6, 0, "")
    filtersRenderRing()
end sub

function calFiltersRowSize(row as Integer) as Integer
    if row = 0 then return 3
    if row >= 1 and row <= 4 then return 2
    return 1
end function

function calFiltersRowCount() as Integer
    if calFilterActive() then return 7
    return 6
end function

sub calFiltersEmitFocus()
    if m.filtersRow < 0
        parityEmit("focus", "Close filters")
        return
    end if
    labels = [["Month", "Week", "Agenda"], ["TV", "Movies"], ["Music", "Books"], ["Aired", "Upcoming"], ["Downloaded", "Missing"], ["Monitored only"], ["Clear filters"]]
    parityEmit("focus", labels[m.filtersRow][m.filtersCol])
end sub

function calFiltersOnKey(key as String) as Boolean
    if key = "back"
        calFiltersClose()
        return true
    else if key = "OK" and m.filtersRow < 0
        calFiltersClose()
        return true
    else if key = "up" and m.filtersRow >= 0
        m.filtersRow = m.filtersRow - 1
    else if key = "down" and m.filtersRow < 0
        m.filtersRow = 0
    else if key = "down" and m.filtersRow < calFiltersRowCount() - 1
        m.filtersRow = m.filtersRow + 1
    else if key = "left" and m.filtersCol > 0
        m.filtersCol = m.filtersCol - 1
    else if key = "right" and m.filtersCol < calFiltersRowSize(m.filtersRow) - 1
        m.filtersCol = m.filtersCol + 1
    else if key = "OK"
        calFiltersChoose()
        return true
    end if
    if m.filtersRow >= 0 and m.filtersCol >= calFiltersRowSize(m.filtersRow) then m.filtersCol = calFiltersRowSize(m.filtersRow) - 1
    calFiltersRender()
    calFiltersEmitFocus()
    return true
end function

sub calFiltersChoose()
    row = m.filtersRow
    if row = 0
        views = ["month", "week", "agenda"]
        if m.calendarView <> views[m.filtersCol]
            m.calendarView = views[m.filtersCol]
            parityEmit("calendarView", m.calendarView)
            loadCalendar()
        end if
    else if row = 1 or row = 2
        calFiltersToggle(m.calFilterTypes, calFilterTypeNames()[(row - 1) * 2 + m.filtersCol])
    else if row = 3 or row = 4
        calFiltersToggle(m.calFilterStatuses, calFilterStatusNames()[(row - 3) * 2 + m.filtersCol])
    else if row = 5
        m.calFilterMonitored = not m.calFilterMonitored
    else if row = 6
        m.calFilterTypes = {}
        m.calFilterStatuses = {}
        m.calFilterMonitored = false
        m.filtersRow = 5
    end if
    renderCalendar()
    calFiltersRender()
    calFiltersEmitFocus()
end sub

sub calFiltersToggle(set as Object, name as String)
    if set[name] = true then set.Delete(name) else set[name] = true
end sub
