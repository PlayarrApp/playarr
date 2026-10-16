import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"
import "../components/NavIcons.js" as NavIcons

// Agenda: 30-day pages of releases grouped by day (web's agenda view).
Item {
    id: root
    objectName: "calendar"
    signal opened(var work)
    signal goHome()
    property string mode: Api.setting("cal.mode", "agenda")   // month | week | agenda
    property int page: 0
    property string anchorDate: ""
    property var range: rangeForPage(mode, 0, anchorDate)
    property bool periodPickerOpen: false
    property int draftYear: pickerYear
    readonly property var baseAnchor: parseDate(anchorDate)
    readonly property var pickerAnchor: dateForPage(mode, page, baseAnchor)
    readonly property int pickerYear: pickerAnchor.getFullYear()
    readonly property int pickerMonth: pickerAnchor.getMonth() + 1
    readonly property int pickerMonthIndex: monthList.currentIndex
    readonly property int pickerYearIndex: yearList.currentIndex
    property var weekRows: []
    property var groups: []
    property bool busy: false
    property bool failed: false
    property int generation: 0
    property var pickerMoveList: null
    property int pickerMoveIndex: -1

    function parseDate(iso) {
        if (!iso || iso.length < 10) return new Date()
        var parts = iso.split("-")
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
    }
    function isoDate(date) { return Qt.formatDate(date, "yyyy-MM-dd") }
    function dateForPage(view, pageNumber, base) {
        if (view === "month") return new Date(base.getFullYear(), base.getMonth() + pageNumber, 1)
        if (view === "week") return new Date(base.getFullYear(), base.getMonth(), base.getDate() + pageNumber * 7)
        return new Date(base.getFullYear(), base.getMonth(), base.getDate() + pageNumber * 30)
    }
    // The selected period is based on the visible anchor date, including page navigation.
    function rangeForPage(view, pageNumber, anchor) {
        var base = parseDate(anchor)
        var start, end, label, month = 0
        if (view === "month") {
            var first = new Date(base.getFullYear(), base.getMonth() + pageNumber, 1)
            var last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
            start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7))
            end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + (6 - ((last.getDay() + 6) % 7)))
            label = Qt.formatDate(first, "MMM yyyy")
            month = first.getMonth() + 1
        } else if (view === "week") {
            start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7) + pageNumber * 7)
            end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
            label = start.getMonth() === end.getMonth()
                ? String(start.getDate()) + " – " + Qt.formatDate(end, "d MMM")
                : Qt.formatDate(start, "d MMM") + " – " + Qt.formatDate(end, "d MMM")
        } else {
            start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + pageNumber * 30)
            end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 29)
            label = Qt.formatDate(start, "d MMM") + " – " + Qt.formatDate(end, "d MMM")
        }
        return { start: isoDate(start), end: isoDate(end), label: label, month: month }
    }
    function monthName(month) { return Qt.formatDate(new Date(2026, month - 1, 1), "MMMM") }

    function load() {
        var gen = ++generation
        busy = true
        failed = false
        range = rangeForPage(mode, page, anchorDate)
        weekRows = mode === "month" ? Calendar.weeks(range.start, range.end) : []
        Api.request("GET", "/api/v1/calendar?start=" + range.start + "&end=" + range.end, null, function (status, data) {
            if (gen !== generation) return
            busy = false
            if (status !== 200 || !data) { failed = true; groups = []; return }
            groups = Calendar.groupByDate(data.entries)
        })
    }
    function entriesOn(iso) {
        for (var i = 0; i < groups.length; ++i) if (groups[i].date === iso) return groups[i].entries
        return []
    }
    // A month cell opens that week.
    function openDay(iso) {
        mode = "week"
        anchorDate = iso
        page = 0
        Api.setSetting("cal.mode", "week")
        load()
    }
    function setMode(m) { mode = m; page = 0; load() }
    function focusRange() { rangePill.forceActiveFocus() }
    function closePeriodPicker() { periodPickerOpen = false; focusRange() }
    function openPeriodPicker() {
        if (periodPickerOpen) { closePeriodPicker(); return }
        draftYear = pickerYear
        yearModel.clear()
        for (var y = pickerYear - 15; y <= pickerYear + 15; ++y) yearModel.append({ year: y })
        periodPickerOpen = true
        monthList.currentIndex = pickerMonth - 1
        yearList.currentIndex = 15
        pickerFocus.restart()
    }
    function focusPickerIndex(list, index) {
        list.currentIndex = index
        list.positionViewAtIndex(index, ListView.Contain)
        pickerMoveList = list
        pickerMoveIndex = index
        pickerMoveFocus.restart()
    }
    function navigatePeriodPicker(focus, key) {
        var list = focus.navigationList === 1 ? yearList : monthList
        var other = focus.navigationList === 1 ? monthList : yearList
        if (key === Qt.Key_Up || key === Qt.Key_Down) {
            focusPickerIndex(list, Math.max(0, Math.min(list.count - 1, focus.parityIndex + (key === Qt.Key_Up ? -1 : 1))))
        } else if ((focus.navigationList === 0 && key === Qt.Key_Right)
                   || (focus.navigationList === 1 && key === Qt.Key_Left)) {
            focusPickerIndex(other, Math.max(0, Math.min(other.count - 1, focus.parityIndex)))
        }
    }
    function chooseYear(year) { draftYear = year }
    function chooseMonth(month) {
        anchorDate = String(draftYear) + "-" + ("0" + month).slice(-2) + "-01"
        page = 0
        load()
        closePeriodPicker()
    }
    function resetToday() { anchorDate = ""; page = 0; load() }
    function initializeMonths() {
        monthModel.clear()
        for (var m = 1; m <= 12; ++m) monthModel.append({ month: m, name: monthName(m) })
    }
    function openFilters() {
        var p = pageStack.push(Qt.resolvedUrl("FiltersPage.qml"), { calendar: true })
        p.applied.connect(function () { root.setMode(Api.setting("cal.mode", "agenda")) })
    }
    function handlePickerKey(event) {
        if (event.key === Qt.Key_Escape || event.key === Qt.Key_Back || event.key === Qt.Key_Backspace) {
            if (pageStack.currentPage.navigation.handleBack(event)) return
        } else if (event.key === Qt.Key_Left || event.key === Qt.Key_Right || event.key === Qt.Key_Up || event.key === Qt.Key_Down) {
            pageStack.currentPage.navigation.handlePressed(event)
            return
        }
    }
    function openEntry(e) {
        if (!e.work_id) return
        root.opened({ id: e.work_id, title: e.title, kind: e.media_kind === "episode" ? "series" : e.media_kind === "album" ? "artist" : e.media_kind,
                      images: [], genres: [], release_date: e.date })
    }
    // Web: a date-only release is stored as midnight UTC, so it shows "All day"; past, wanted and missing is "Missing".
    function timeOf(e) {
        if (!e.release_at) return ""
        var t = new Date(e.release_at).getTime()
        return isNaN(t) || t % 86400000 === 0 ? "" : Qt.formatTime(new Date(t), "hh:mm")
    }
    function pill(e) {
        if (e.has_file) return qsTr("Available")
        if (e.date > Qt.formatDate(new Date(), "yyyy-MM-dd")) return qsTr("Upcoming")
        return e.monitored === false ? qsTr("Not tracked") : qsTr("Missing")
    }
    onPageChanged: load()
    Component.onCompleted: { initializeMonths(); load() }

    PageTitle {
        id: head
        y: (root.mode === "agenda" ? 5 : 4) * Tokens.u
        title: qsTr("Calendar")
        onBackClicked: root.goHome()
    }
    MouseArea {
        id: filterBtn
        property bool navigationFocusable: true
        property string parityLabel: qsTr("Filters")
        property int parityRail: 1
        property int parityIndex: 0
        function navigationActivate() { root.openFilters() }
        anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: head.verticalCenter }
        width: 43.7 * Tokens.u; height: width
        onClicked: navigationActivate()
        Rectangle { anchors.fill: parent; radius: 14 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: filterBtn.pressed ? 0.5 : 1 }
        Image { anchors.centerIn: parent; width: 20 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); source: NavIcons.url("filter", Tokens.ink) }
    }
    // The web's calendar-feed (subscription) button.
    MouseArea {
        id: bellBtn
        property bool navigationFocusable: true
        property string parityLabel: qsTr("Calendar link")
        property int parityRail: 1
        property int parityIndex: 1
        function navigationActivate() { pageStack.push(Qt.resolvedUrl("CalendarLinkPage.qml")) }
        anchors { right: filterBtn.left; rightMargin: 9.7 * Tokens.u; verticalCenter: head.verticalCenter }
        width: 43.7 * Tokens.u; height: width
        onClicked: navigationActivate()
        Rectangle { anchors.fill: parent; radius: 14 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: bellBtn.pressed ? 0.5 : 1 }
        Image { anchors.centerIn: parent; width: 20 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); source: NavIcons.url("bell", Tokens.ink) }
    }
    Row {
        id: nav
        anchors { top: head.bottom; topMargin: (root.mode === "agenda" ? -3.2 : 16.4) * Tokens.u; right: parent.right; rightMargin: Tokens.pad }
        spacing: 10 * Tokens.u
        PillButton { id: rangePill; objectName: "calendar-range"; text: root.range.label; outlineOnly: true; parityRail: 0; parityIndex: 0; navigationActivate: function() { root.openPeriodPicker() }; labelFamily: Tokens.family610; fontSize: 11.5 * Tokens.u; implicitHeight: 43.7 * Tokens.u; implicitWidth: (root.mode === "week" ? 103.6 : root.mode === "month" ? 91.4 : 126) * Tokens.u; onClicked: root.openPeriodPicker() }
        PillButton { text: "←"; outlineOnly: true; parityRail: 0; parityIndex: 1; navigationActivate: function() { root.page-- }; fontSize: 9 * Tokens.u; implicitHeight: 43.7 * Tokens.u; implicitWidth: 41.6 * Tokens.u; onClicked: root.page-- }
        PillButton { text: qsTr("Today"); outlineOnly: true; restRing: true; parityRail: 0; parityIndex: 2; navigationInitialFocus: true; navigationActivate: function() { root.resetToday() }; labelFamily: Tokens.family610; fontSize: 11.5 * Tokens.u; implicitHeight: 43.7 * Tokens.u; implicitWidth: 72.1 * Tokens.u; onClicked: root.resetToday() }
        PillButton { text: "→"; outlineOnly: true; parityRail: 0; parityIndex: 3; navigationActivate: function() { root.page++ }; fontSize: 9 * Tokens.u; implicitHeight: 43.7 * Tokens.u; implicitWidth: 43.7 * Tokens.u; onClicked: root.page++ }
    }
    // Month: wide cells (a chip for the first title, the day number and "+N more"), scrolled sideways, as on the web phone.
    SilicaFlickable {
        id: month
        visible: root.mode === "month"
        anchors { top: nav.bottom; topMargin: 9.3 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: Tokens.pad; rightMargin: Tokens.pad }
        clip: true
        readonly property real cellW: 102.8 * Tokens.u
        readonly property real cellH: 83.7 * Tokens.u
        readonly property string todayIso: Qt.formatDate(new Date(), "yyyy-MM-dd")
        contentWidth: 7 * cellW
        contentHeight: 34 * Tokens.u + root.weekRows.length * cellH + 120 * Tokens.u
        flickableDirection: Flickable.AutoFlickDirection
        Row {
            Repeater {
                model: [qsTr("MON"), qsTr("TUE"), qsTr("WED"), qsTr("THU"), qsTr("FRI"), qsTr("SAT"), qsTr("SUN")]
                Label { width: month.cellW; height: 34 * Tokens.u; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; text: modelData; color: Tokens.inkSoft; font.family: Tokens.family; font.letterSpacing: 1.5 * Tokens.u; font.pixelSize: 12 * Tokens.u }
            }
        }
        Column {
            y: 34 * Tokens.u
            Repeater {
                model: root.weekRows
                Row {
                    Repeater {
                        model: modelData
                        MouseArea {
                            id: cell
                            property bool navigationFocusable: true
                            property string parityLabel: String(modelData.day)
                            property int parityRail: 0
                            property int parityIndex: index
                            function navigationActivate() { root.openDay(modelData.date) }
                            readonly property var es: root.entriesOn(modelData.date)
                            readonly property bool isToday: modelData.date === month.todayIso
                            readonly property bool past: modelData.month !== root.range.month   // the web shades only the days of the neighbouring months
                            width: month.cellW; height: month.cellH
                            onClicked: navigationActivate()
                            Rectangle {
                                anchors.fill: parent
                                color: cell.past ? (Tokens.dark ? "#241f23" : "#efeeed") : "transparent"
                                border.width: cell.isToday ? 2 * Tokens.u : 1 * Tokens.u
                                border.color: cell.isToday ? (Tokens.dark ? "#dfdcdd" : "#4d4248") : (Tokens.dark ? "#332e32" : "#d8d3d3")
                            }
                            Row {
                                visible: cell.es.length > 0
                                x: 12.2 * Tokens.u; y: 8.5 * Tokens.u
                                spacing: 4.7 * Tokens.u
                                Rectangle {
                                    anchors.verticalCenter: parent.verticalCenter
                                    width: 8 * Tokens.u; height: width; radius: width / 2
                                    color: cell.es.length === 0 ? "transparent"
                                         : cell.es[0].has_file ? (Tokens.dark ? "#8ac5a5" : "#224c3a")
                                         : cell.isToday ? (Tokens.dark ? "#f1a4a8" : "#722f34") : Tokens.brandPink
                                }
                                Label { width: month.cellW - 40 * Tokens.u; text: cell.es.length ? cell.es[0].title : ""; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 12.5 * Tokens.u }
                            }
                            Label { x: 12.2 * Tokens.u; y: 49.5 * Tokens.u; text: modelData.day; color: modelData.month === root.range.month ? Tokens.ink : Tokens.inkSoft; font.family: Tokens.family610; font.pixelSize: 12.5 * Tokens.u }
                            Label { visible: cell.es.length > 1; x: 43 * Tokens.u; y: 49.5 * Tokens.u; text: qsTr("+%1 more").arg(cell.es.length - 1); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 12.5 * Tokens.u }
                        }
                    }
                }
            }
        }
    }
    Component {
        id: dayComp
        Column {
                    id: dayCol
                    property var day
                    property real cw: col.width
                    readonly property bool wk: root.mode === "week"
                    width: cw
                    spacing: 14.7 * Tokens.u
                    Row {
                        x: dayCol.wk ? 0 : Tokens.pad
                        height: (dayCol.wk ? 6 : 40) * Tokens.u
                        spacing: 8 * Tokens.u
                    Label {
                        text: Calendar.dayHeading(day.date)
                        color: Tokens.ink
                        anchors.verticalCenter: parent.verticalCenter
                        font.family: Tokens.family580
                        font.pixelSize: 14.8 * Tokens.u
                    }
                    Rectangle {
                        visible: day.date === Qt.formatDate(new Date(), "yyyy-MM-dd")
                        anchors.verticalCenter: parent.verticalCenter
                        width: todayLbl.width + 20 * Tokens.u; height: 22 * Tokens.u; radius: height / 2
                        color: "transparent"; border.width: 1; border.color: Tokens.dark ? "#dfdcdd" : "#4d4248"
                        Label { id: todayLbl; anchors.centerIn: parent; text: qsTr("TODAY"); color: Tokens.ink; font.family: Tokens.family610; font.letterSpacing: 0.6 * Tokens.u; font.pixelSize: 11 * Tokens.u }
                    }
                    }
                    Repeater {
                        model: day.entries
                        MouseArea {
                            id: card
                            property bool navigationFocusable: true
                            property string parityLabel: modelData.title
                            property int parityRail: 0
                            property int parityIndex: index
                            function navigationActivate() { root.openEntry(modelData) }
                            x: dayCol.wk ? 0 : Tokens.pad
                            width: dayCol.cw - (dayCol.wk ? 0 : Tokens.pad - 40 * Tokens.u)   // the web agenda card runs past the right edge
                            height: Math.max(75.7 * Tokens.u, info.height + 18 * Tokens.u)   // web: the 60 px poster plus the padding is the floor
                            onClicked: navigationActivate()
                            // Left border: we have it (playable, green) or not, never which library; the card sits over it so it curves with the corners.
                            Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: modelData.has_file ? (Tokens.dark ? "#8ac5a5" : "#224c3a") : Tokens.inkMuted; opacity: card.pressed ? 0.6 : 1 }
                            Rectangle { x: 4 * Tokens.u; width: parent.width - 4 * Tokens.u; height: parent.height; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1 * Tokens.u; border.color: Tokens.line; opacity: card.pressed ? 0.6 : 1 }
                            Artwork {
                                id: poster
                                x: Math.round(15.7 * Tokens.u)   // whole pixels, as web snaps image rects
                                y: Math.round((parent.height - height) / 2)
                                width: 40 * Tokens.u; height: 60 * Tokens.u; radius: 6 * Tokens.u
                                work: null
                                emptyColor: Tokens.surfaceSoft
                                // Match the web's 40 by 60 sized poster with a true rounded crop.
                                override: modelData.poster_url ? String(modelData.poster_url).replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)original\//, "$1w185/")
                                         : modelData.work_id ? Api.artworkOf(modelData.work_id, "poster") : ""
                            }
                            Column {
                                id: info
                                anchors { left: poster.right; leftMargin: 14.7 * Tokens.u; right: parent.right; rightMargin: 12 * Tokens.u; verticalCenter: parent.verticalCenter }
                                spacing: 3 * Tokens.u
                                Label { width: parent.width; text: modelData.title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 16.3 * Tokens.u }
                                Label {
                                    width: parent.width
                                    visible: text !== ""
                                    text: [Calendar.episodeCode(modelData), modelData.subtitle].filter(function (x) { return !!x }).join(" · ")
                                    elide: Text.ElideRight; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 16.2 * Tokens.u
                                }
                                Row {
                                    spacing: 11 * Tokens.u
                                    Label { text: root.timeOf(modelData) !== "" ? root.timeOf(modelData) : qsTr("All day"); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 13.2 * Tokens.u }
                                    Label { text: modelData.release_type === "air" ? qsTr("Airs") : modelData.release_type === "cinema" ? qsTr("In cinemas") : modelData.release_type === "digital" ? qsTr("Digital release") : modelData.release_type === "physical" ? qsTr("Physical release") : qsTr("Release"); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 13.2 * Tokens.u }
                                    Label { text: modelData.media_kind === "episode" ? qsTr("Episodes") : modelData.media_kind === "movie" ? qsTr("Movies") : modelData.media_kind === "album" ? qsTr("Albums") : qsTr("Books"); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 13.2 * Tokens.u }
                                    Rectangle {
                                        width: badge.width + 22 * Tokens.u; height: 21.8 * Tokens.u; radius: height / 2
                                        color: modelData.has_file ? (Tokens.dark ? "#2b302e" : "#dde2de") : Qt.rgba(0.81, 0.19, 0.34, Tokens.dark ? 0.16 : 0.15); border.width: 1; border.color: modelData.has_file ? (Tokens.dark ? "#648975" : "#6c887c") : Tokens.brandPink
                                        Label { id: badge; anchors.centerIn: parent; text: root.pill(modelData); color: Tokens.ink; font.family: Tokens.family820; font.pixelSize: 10.5 * Tokens.u }
                                    }
                                }
                            }
                        }
                    }
                }
    }
    // Week: one column per day side by side, scrolled sideways, as the web lays it out.
    SilicaFlickable {
        id: weekFlick
        visible: root.mode === "week"
        anchors { top: nav.bottom; topMargin: 3 * Tokens.u; left: parent.left; right: parent.right; rightMargin: Tokens.pad; bottom: parent.bottom; bottomMargin: 116 * Tokens.u }   // web clips the day columns at the page padding and above the bar
        contentWidth: weekRow.width + Tokens.pad
        contentHeight: height
        flickableDirection: Flickable.HorizontalFlick
        clip: true
        Row {
            id: weekRow
            x: Tokens.pad
            y: 16.9 * Tokens.u
            spacing: 20 * Tokens.u
            Repeater {
                model: root.mode === "week" ? root.groups : []
                Loader { sourceComponent: dayComp; onLoaded: { item.day = modelData; item.cw = 320 * Tokens.u } }
            }
        }
    }
    EdgeFade { target: weekFlick; horizontal: true }
    SilicaFlickable {
        id: flick
        visible: root.mode === "agenda"
        anchors { top: nav.bottom; topMargin: 10 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        contentHeight: col.height + 120 * Tokens.u
        clip: true
        Column {
            id: col
            width: parent.width
            spacing: 33.8 * Tokens.u
            Repeater {
                model: root.mode === "week" ? [] : root.groups
                Loader { sourceComponent: dayComp; onLoaded: { item.day = modelData; item.cw = Qt.binding(function () { return col.width }) } }
            }
        }
        EdgeFade { target: flick }
        VerticalScrollDecorator {}
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
    ViewPlaceholder {
        enabled: !root.busy && (root.failed || root.groups.length === 0)
        text: root.failed ? qsTr("Could not load the calendar") : qsTr("Nothing scheduled")
    }
    Rectangle {
        id: pickerScrim
        anchors.fill: parent
        visible: root.periodPickerOpen
        z: 999
        color: "transparent"
        MouseArea { anchors.fill: parent; onClicked: root.closePeriodPicker() }
    }
    Rectangle {
        id: periodPicker
        visible: root.periodPickerOpen
        z: 1000
        objectName: "calendar-period-picker"
        property bool navigationFocusable: false
        function navigationBack() { root.closePeriodPicker() }
        x: Math.max(8 * Tokens.u, Math.min(root.width - width - 8 * Tokens.u, nav.x + rangePill.x + rangePill.width - width))
        y: nav.y + nav.height + 8 * Tokens.u
        width: Math.min(root.width - 16 * Tokens.u, 320 * Tokens.u)
        height: Math.min(440 * Tokens.u, root.height - y - 8 * Tokens.u)
        color: Tokens.surfaceStrong
        radius: 12 * Tokens.u
        border.width: Tokens.u
        border.color: Tokens.lineStrong
        MouseArea { anchors.fill: parent; onClicked: {} }
        ListModel { id: monthModel }
        ListModel { id: yearModel }
        Row {
            x: 8 * Tokens.u; y: 7 * Tokens.u
            width: parent.width - 16 * Tokens.u
            height: 28 * Tokens.u
            Label { width: parent.width / 2; height: parent.height; text: qsTr("Month"); horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.inkSoft; font.family: Tokens.family610; font.pixelSize: 13 * Tokens.u }
            Label { width: parent.width / 2; height: parent.height; text: qsTr("Year"); horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.inkSoft; font.family: Tokens.family610; font.pixelSize: 13 * Tokens.u }
        }
        SilicaListView {
            id: monthList
            x: 8 * Tokens.u; y: 37 * Tokens.u
            width: (parent.width - 24 * Tokens.u) / 2
            height: parent.height - 45 * Tokens.u
            clip: true
            model: monthModel
            Keys.priority: Keys.BeforeItem
            Keys.onPressed: root.handlePickerKey(event)
            Keys.onReleased: pageStack.currentPage.navigation.handleReleased(event)
            delegate: MouseArea {
                id: monthChoice
                objectName: "calendar-month-option-" + model.month
                width: monthList.width; height: 42 * Tokens.u
                property bool navigationFocusable: true
                property bool navigationTrap: true
                property int navigationList: 0
                property int parityIndex: index
                property int parityRail: 0
                property string parityLabel: model.name
                property var navigationActivate: function() { root.chooseMonth(model.month) }
                property var navigationTrapMove: function(key) { root.navigatePeriodPicker(monthChoice, key) }
                Keys.priority: Keys.BeforeItem
                Keys.onPressed: root.handlePickerKey(event)
                Keys.onReleased: pageStack.currentPage.navigation.handleReleased(event)
                onClicked: root.chooseMonth(model.month)
                Rectangle {
                    anchors.fill: parent; radius: 8 * Tokens.u
                    color: root.draftYear === root.pickerYear && model.month === root.pickerMonth ? Tokens.surfaceSoft : "transparent"
                    border.width: monthChoice.activeFocus ? 2 * Tokens.u : 0
                    border.color: Tokens.brandInk
                }
                Label { anchors.fill: parent; text: model.name; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u }
            }
        }
        SilicaListView {
            id: yearList
            x: monthList.x + monthList.width + 8 * Tokens.u; y: monthList.y
            width: monthList.width; height: monthList.height
            clip: true
            model: yearModel
            Keys.priority: Keys.BeforeItem
            Keys.onPressed: root.handlePickerKey(event)
            Keys.onReleased: pageStack.currentPage.navigation.handleReleased(event)
            delegate: MouseArea {
                id: yearChoice
                objectName: "calendar-year-option-" + model.year
                width: yearList.width; height: 42 * Tokens.u
                property bool navigationFocusable: true
                property bool navigationTrap: true
                property int navigationList: 1
                property int parityIndex: index
                property int parityRail: 0
                property string parityLabel: String(model.year)
                property var navigationActivate: function() { root.chooseYear(model.year) }
                property var navigationTrapMove: function(key) { root.navigatePeriodPicker(yearChoice, key) }
                Keys.priority: Keys.BeforeItem
                Keys.onPressed: root.handlePickerKey(event)
                Keys.onReleased: pageStack.currentPage.navigation.handleReleased(event)
                onClicked: { root.chooseYear(model.year); root.focusPickerIndex(yearList, index) }
                Rectangle {
                    anchors.fill: parent; radius: 8 * Tokens.u
                    color: model.year === root.draftYear ? Tokens.surfaceSoft : "transparent"
                    border.width: yearChoice.activeFocus ? 2 * Tokens.u : 0
                    border.color: Tokens.brandInk
                }
                Label { anchors.fill: parent; text: String(model.year); horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u }
            }
        }
        Timer {
            id: pickerFocus
            interval: 0
            repeat: false
            onTriggered: {
                root.focusPickerIndex(monthList, root.pickerMonth - 1)
                yearList.positionViewAtIndex(15, ListView.Center)
                yearList.currentIndex = 15
            }
        }
        Timer {
            id: pickerMoveFocus
            interval: 0
            repeat: false
            onTriggered: {
                if (root.pickerMoveList && root.pickerMoveList.currentIndex === root.pickerMoveIndex && root.pickerMoveList.currentItem)
                    root.pickerMoveList.currentItem.forceActiveFocus()
            }
        }
    }
}
