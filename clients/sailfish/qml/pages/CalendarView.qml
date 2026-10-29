import QtQuick 2.6
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0
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
        if (!iso || iso.length < 10) iso = Calendar.todayIso()   // the pinned parity clock, not the system date
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
        if (!anchor) return Calendar.rangeFor(view, pageNumber)   // today, from the pinned parity clock when set
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
            if (mode === "week") todayScroll.restart()
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
    // Web's entry pill tone: have it, not out yet, out and wanted but absent, or nothing to report (not tracked).
    function toneOf(e) {
        if (e.has_file) return "available"
        if (e.date > Calendar.todayIso()) return "upcoming"
        return e.monitored === false ? "neutral" : "missing"
    }
    // A grouped card reports its worst member: missing, then upcoming, then neutral, then available.
    function tone(e) {
        var tones = (e.members || [e]).map(toneOf)
        var order = ["missing", "upcoming", "neutral"]
        for (var i = 0; i < order.length; ++i) if (tones.indexOf(order[i]) >= 0) return order[i]
        return "available"
    }
    function pill(e) {
        var t = tone(e)
        return t === "available" ? qsTr("Available") : t === "upcoming" ? qsTr("Upcoming") : t === "neutral" ? qsTr("Not tracked") : qsTr("Missing")
    }
    function releaseText(e) { return e.release_type === "air" ? qsTr("Airs") : e.release_type === "cinema" ? qsTr("In cinemas") : e.release_type === "digital" ? qsTr("Digital release") : e.release_type === "physical" ? qsTr("Physical release") : qsTr("Release") }
    function kindText(e) { return e.media_kind === "episode" ? qsTr("Episodes") : e.media_kind === "movie" ? qsTr("Movies") : e.media_kind === "album" ? qsTr("Albums") : qsTr("Books") }
    onPageChanged: load()
    Component.onCompleted: { initializeMonths(); load() }

    PageTitle {
        id: head
        y: 4 * Tokens.u
        title: qsTr("Calendar")
        backLabel: qsTr("Back to home")
        onBackClicked: root.goHome()
    }
    MouseArea {
        id: filterBtn
        property bool navigationFocusable: true
        Accessible.name: qsTr("Filters")
        property int parityRail: 1
        property int parityIndex: 0
        function navigationActivate() { root.openFilters() }
        anchors { right: parent.right; rightMargin: Tokens.pad; top: parent.top; topMargin: 14 * Tokens.u }
        width: 44 * Tokens.u; height: width
        onClicked: navigationActivate()
        Rectangle { anchors.fill: parent; radius: 14 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: filterBtn.pressed ? 0.5 : 1 }
        Image { anchors.centerIn: parent; width: 18 * Tokens.u; height: width; sourceSize: Qt.size(64, 64); source: NavIcons.url("filter", Tokens.inkSoft) }
    }
    // The web's calendar-feed (subscription) button.
    MouseArea {
        id: bellBtn
        property bool navigationFocusable: true
        Accessible.name: qsTr("Calendar link")
        property int parityRail: 1
        property int parityIndex: 1
        function navigationActivate() { pageStack.push(Qt.resolvedUrl("CalendarLinkPage.qml")) }
        anchors { right: filterBtn.left; rightMargin: 8 * Tokens.u; top: parent.top; topMargin: 14 * Tokens.u }
        width: 44 * Tokens.u; height: width
        onClicked: navigationActivate()
        Rectangle { anchors.fill: parent; radius: 14 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: bellBtn.pressed ? 0.5 : 1 }
        Image { anchors.centerIn: parent; width: 18 * Tokens.u; height: width; sourceSize: Qt.size(64, 64); source: NavIcons.url("bell", Tokens.inkSoft) }
    }
    Row {
        id: nav
        anchors { top: head.bottom; topMargin: (root.mode === "agenda" ? -2 : 15.5) * Tokens.u; right: parent.right; rightMargin: Tokens.pad }
        spacing: 8 * Tokens.u
        PillButton { id: rangePill; objectName: "calendar-range"; text: root.range.label; outlineOnly: true; textInk: Tokens.dark ? "#cdc1c6" : "#443a40"; parityRail: 0; parityIndex: 0; navigationActivate: function() { root.openPeriodPicker() }; labelFamily: Tokens.fam(720); fontSize: 11.52 * Tokens.u; implicitHeight: 44 * Tokens.u; implicitWidth: (root.mode === "week" ? 96.89 : root.mode === "month" ? 91.78 : 114.38) * Tokens.u; onClicked: root.openPeriodPicker() }
        PillButton { text: "←"; Accessible.name: qsTr("Previous"); outlineOnly: true; textInk: Tokens.dark ? "#cdc1c6" : "#443a40"; parityRail: 0; parityIndex: 1; navigationActivate: function() { root.page-- }; labelFamily: Tokens.fam(720) + ",Liberation Sans"; fontSize: Tokens.fs(11.52); implicitHeight: 44 * Tokens.u; implicitWidth: 44 * Tokens.u; onClicked: root.page-- }
        PillButton { text: qsTr("Today"); outlineOnly: true; textInk: Tokens.dark ? "#cdc1c6" : "#443a40"; parityRail: 0; parityIndex: 2; navigationInitialFocus: true; navigationActivate: function() { root.resetToday() }; labelFamily: Tokens.fam(720); fontSize: 11.52 * Tokens.u; implicitHeight: 44 * Tokens.u; implicitWidth: 74.22 * Tokens.u; onClicked: root.resetToday() }
        PillButton { text: "→"; Accessible.name: qsTr("Next"); outlineOnly: true; textInk: Tokens.dark ? "#cdc1c6" : "#443a40"; parityRail: 0; parityIndex: 3; navigationActivate: function() { root.page++ }; labelFamily: Tokens.fam(720) + ",Liberation Sans"; fontSize: Tokens.fs(11.52); implicitHeight: 44 * Tokens.u; implicitWidth: 44 * Tokens.u; onClicked: root.page++ }
    }
    // Month: wide cells (a chip for the first title, the day number and "+N more"), scrolled sideways, as on the web phone.
    SilicaFlickable {
        id: month
        visible: root.mode === "month"
        anchors { top: nav.bottom; topMargin: 9.3 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: Tokens.pad; rightMargin: Tokens.pad }
        clip: true
        readonly property real cellW: 102.84 * Tokens.u
        readonly property real cellH: 83.64 * Tokens.u
        readonly property string todayIso: Calendar.todayIso()
        contentWidth: 7 * cellW
        contentHeight: 34 * Tokens.u + root.weekRows.length * cellH + 120 * Tokens.u
        flickableDirection: Flickable.AutoFlickDirection
        Row {
            Repeater {
                model: [qsTr("MON"), qsTr("TUE"), qsTr("WED"), qsTr("THU"), qsTr("FRI"), qsTr("SAT"), qsTr("SUN")]
                PLabel { renderType: Text.NativeRendering; topPadding: 20.8; width: month.cellW; height: 34 * Tokens.u; horizontalAlignment: Text.AlignHCenter; text: modelData; color: Tokens.inkSoft; font.family: Tokens.family; font.letterSpacing: 1.25 * Tokens.u; font.pixelSize: Tokens.fsFit(12) }
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
                            Accessible.name: String(modelData.day)
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
                            MouseArea {   // the web's event chip inside the day cell
                                visible: cell.es.length > 0
                                x: 5.8 * Tokens.u; y: 1.8 * Tokens.u; width: 91.25 * Tokens.u; height: 34.05 * Tokens.u
                                Accessible.name: cell.es.length ? cell.es[0].title + ", " + root.pill(cell.es[0]) + ", " + Qt.formatDate(new Date(modelData.date + "T00:00:00"), "dddd d MMMM") : ""
                                onClicked: cell.navigationActivate()
                                Rectangle { anchors.fill: parent; radius: 4 * Tokens.u; color: cell.past ? (Tokens.dark ? "#241f23" : "#efeeed") : Tokens.bg }   // the chip's own plate
                                Rectangle {
                                    x: 5.59 * Tokens.u; y: 12.62 * Tokens.u
                                    width: 8.8 * Tokens.u; height: width; radius: width / 2
                                    color: cell.es.length === 0 ? "transparent"
                                         : cell.es[0].has_file ? (Tokens.dark ? "#8ac5a5" : "#224c3a")
                                         : root.tone(cell.es[0]) === "missing" ? (Tokens.dark ? "#f1a4a8" : "#722f34") : String(Tokens.brandPink)
                                }
                                FitText { x: 21.58 * Tokens.u; y: 6.4 * Tokens.u + 2.2; width: month.cellW - 37.8 * Tokens.u; elide: Text.ElideRight; text: cell.es.length ? cell.es[0].title : ""; color: Tokens.ink; font.family: Tokens.family400; font.pixelSize: Tokens.fs(12.48); font.letterSpacing: -0.15 }
                            }
                            PLabel { renderType: Text.NativeRendering; x: 8.8 * Tokens.u; y: 49.1 * Tokens.u + 2.5; text: modelData.day; color: modelData.month === root.range.month ? Tokens.ink : Tokens.inkSoft; font.family: Tokens.fam(640); font.pixelSize: Tokens.fs(12.8) }
                            PLabel { renderType: Text.NativeRendering; visible: cell.es.length > 1; x: 43 * Tokens.u; y: 49.5 * Tokens.u; text: qsTr("+%1 more").arg(cell.es.length - 1); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: Tokens.fs(12.5) }
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
                        spacing: 9.8 * Tokens.u
                    PLabel { renderType: Text.NativeRendering;
                        text: Calendar.dayHeading(day.date)
                        color: day.date === Calendar.todayIso() ? (Tokens.dark ? "#dfdcdd" : Tokens.inkSoft) : Tokens.ink
                        anchors.verticalCenter: parent.verticalCenter; anchors.verticalCenterOffset: -1 * Tokens.u
                        font.family: Tokens.fam(640); font.letterSpacing: 0.1
                        font.pixelSize: Tokens.fs(14.4)
                    }
                    Rectangle {
                        id: todayChip
                                                visible: day.date === Calendar.todayIso()
                        anchors.verticalCenter: parent.verticalCenter
                        width: todayLbl.width + 20 * Tokens.u; height: 22 * Tokens.u; radius: height / 2
                        color: "transparent"; border.width: 1; border.color: Tokens.dark ? "#dfdcdd" : "#4d4248"
                        PLabel { renderType: Text.NativeRendering; id: todayLbl; anchors.centerIn: parent; anchors.verticalCenterOffset: dayCol.wk ? 0 : -1.2; text: qsTr("TODAY"); color: Tokens.dark ? "#dfdcdd" : Tokens.inkSoft; font.family: Tokens.fam(640); font.letterSpacing: 1.6; font.pixelSize: Tokens.fsFit(11.2) }
                    }
                    }
                    Repeater {
                        model: day.entries
                        MouseArea {
                            id: card
                            property bool navigationFocusable: true
                            property int parityRail: 0
                            property int parityIndex: index
                            Accessible.name: [modelData.title, subLbl.text, timeLbl.text, relLbl.text, kindLbl.text, badge.text].filter(function (x) { return !!x }).join(" ")
                            function navigationActivate() { root.openEntry(modelData) }
                            x: dayCol.wk ? 0 : Tokens.pad
                            width: dayCol.cw - (dayCol.wk ? 0 : 2 * Tokens.pad)   // static-seed refs: the agenda card ends at the page padding
                            height: Math.max(75.7 * Tokens.u, info.height + 17.25 * Tokens.u) + (dayCol.wk ? 4.1 : 2.84)   // refs: week cards run one pixel taller, agenda cards two   // web: the 60 px poster plus the padding is the floor
                            onClicked: navigationActivate()
                            // Left border: we have it (playable, green) or not, never which library; the card sits over it so it curves with the corners.
                            Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: modelData.has_file ? (Tokens.dark ? "#8ac5a5" : "#224c3a") : Tokens.inkMuted; opacity: (card.pressed ? 0.6 : 1) * (dayCol.wk && modelData.has_file ? 0.32 : 1) }   // week refs: an available card's accent is a third strong, a missing one is full
                            Rectangle { x: 4 * Tokens.u; width: parent.width - 4 * Tokens.u; height: parent.height; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1 * Tokens.u; border.color: dayCol.wk ? (Tokens.dark ? "#363136" : "#e3dfdf") : (Tokens.dark ? "#4d494c" : "#c7c2c1"); opacity: card.pressed ? 0.6 : 1 }
                            Artwork {
                                id: poster
                                roundImage: true
                                x: Math.round(15.7 * Tokens.u)   // whole pixels, as web snaps image rects
                                y: Math.round((parent.height - height) / 2)
                                width: 40 * Tokens.u; height: 60 * Tokens.u; radius: 6 * Tokens.u
                                work: null
                                emptyColor: Tokens.surfaceSoft
                                // Match the web's 40 by 60 sized poster with a true rounded crop.
                                override: modelData.poster_url && !/^https?:\/\/(127\.0\.0\.1|localhost)[:\/]/.test(modelData.poster_url) ? String(modelData.poster_url).replace(/^(https:\/\/image\.tmdb\.org\/t\/p\/)original\//, "$1w185/")
                                         : modelData.work_id ? Api.artworkOf(modelData.work_id, "poster") : ""
                            }
                            Column {
                                id: info
                                anchors { left: poster.right; leftMargin: 14.7 * Tokens.u; right: parent.right; rightMargin: 12 * Tokens.u; verticalCenter: parent.verticalCenter }
                                spacing: 4.4 * Tokens.u
                                FitText { bottomPadding: subLbl.visible ? 0 : 2.2; width: parent.width; text: modelData.title; elide: dayCol.wk ? Text.ElideNone : Text.ElideRight; wrapMode: dayCol.wk ? Text.WordWrap : Text.NoWrap; color: Tokens.ink; font.family: Tokens.fam(640); font.letterSpacing: -0.2; font.pixelSize: Tokens.fs(16) }
                                FitText { 
                                    width: parent.width
                                    id: subLbl; visible: text !== ""; topPadding: dayCol.wk ? -0.4 : -3; bottomPadding: dayCol.wk ? 0.4 : 3
                                    text: modelData.group_count ? qsTr("%1 episodes").arg(modelData.group_count) + " · " + modelData.group_codes : [Calendar.episodeCode(modelData), modelData.subtitle].filter(function (x) { return !!x }).join(" · ")
                                    elide: dayCol.wk ? Text.ElideNone : Text.ElideRight; wrapMode: dayCol.wk ? Text.WordWrap : Text.NoWrap; color: Tokens.dark ? "#cdc1c6" : "#443a40"; font.family: Tokens.family400; font.letterSpacing: -0.22; font.pixelSize: Tokens.fs(16)
                                }
                                Item {
                                  width: parent.width; height: metaRow.height - 2.5 * Tokens.u
                                Row {
                                    id: metaRow
                                    y: -2.5 * Tokens.u
                                    spacing: 12 * Tokens.u
                                    PLabel { renderType: Text.NativeRendering; id: timeLbl; text: root.timeOf(modelData) !== "" ? root.timeOf(modelData) : qsTr("All day"); color: Tokens.inkSoft; font.family: Tokens.family400; font.letterSpacing: 0.2; font.pixelSize: Tokens.fs(12.8) }
                                    PLabel { renderType: Text.NativeRendering; id: relLbl; text: modelData.release_type === "air" ? qsTr("Airs") : modelData.release_type === "cinema" ? qsTr("In cinemas") : modelData.release_type === "digital" ? qsTr("Digital release") : modelData.release_type === "physical" ? qsTr("Physical release") : qsTr("Release"); color: Tokens.inkSoft; font.family: Tokens.family400; font.letterSpacing: 0.2; font.pixelSize: Tokens.fs(12.8) }
                                    PLabel { renderType: Text.NativeRendering; id: kindLbl; text: modelData.media_kind === "episode" ? qsTr("Episodes") : modelData.media_kind === "movie" ? qsTr("Movies") : modelData.media_kind === "album" ? qsTr("Albums") : qsTr("Books"); color: Tokens.inkSoft; font.family: Tokens.family400; font.letterSpacing: modelData.media_kind === "episode" ? 0 : -0.25; font.pixelSize: Tokens.fs(12.8) }
                                    Rectangle {
                                        id: badgeChip
                                                                                width: badge.width + 22 * Tokens.u; height: 21.8 * Tokens.u; radius: height / 2
                                        color: modelData.has_file ? (Tokens.dark ? "#2b302e" : "#dde2de") : root.tone(modelData) === "neutral" ? Qt.rgba(Tokens.inkSoft.r, Tokens.inkSoft.g, Tokens.inkSoft.b, 0.14) : root.tone(modelData) === "missing" ? (Tokens.dark ? "#392c2f" : "#e8dedd") : (Tokens.dark ? "#341c23" : "#f5dee2"); border.width: 1; border.color: modelData.has_file ? (Tokens.dark ? "#648975" : "#6c887c") : root.tone(modelData) === "neutral" ? Qt.rgba(Tokens.inkSoft.r, Tokens.inkSoft.g, Tokens.inkSoft.b, 0.6) : root.tone(modelData) === "missing" ? (Tokens.dark ? "#996a6e" : "#aa8285") : Tokens.brandPink
                                        PLabel { renderType: Text.NativeRendering; id: badge; anchors.centerIn: parent; anchors.horizontalCenterOffset: 1.2 * Tokens.u; text: root.pill(modelData); color: Tokens.ink; font.family: Tokens.fam(760); font.pixelSize: Tokens.fs(10.24) }
                                    }
                                }
                                }
                            }
                        }
                    }
                }
    }
    // The web scrolls the week strip so today's column starts at the page padding.
    Timer { id: todayScroll; interval: 100; onTriggered: {
        var today = Calendar.todayIso()
        for (var i = 0; i < root.groups.length; ++i) if (root.groups[i].date === today) {
            weekFlick.contentX = Math.min(i * 340 * Tokens.u, Math.max(0, weekFlick.contentWidth - weekFlick.width)); return }
        weekFlick.contentX = 0 } }
    // Week: one column per day side by side, scrolled sideways, as the web lays it out.
    SilicaFlickable {
        id: weekFlick
        visible: root.mode === "week"
        anchors { top: nav.bottom; topMargin: 3 * Tokens.u; left: parent.left; right: parent.right; rightMargin: Tokens.pad; bottom: parent.bottom; bottomMargin: 116 * Tokens.u }   // web clips the day columns at the page padding and above the bar
        contentWidth: weekRow.width + Tokens.pad
        contentHeight: height + 1   // never scrolls vertically; the extra pixel keeps the end fade over the clipped day columns, as on web
        flickableDirection: Flickable.HorizontalFlick
        clip: true
        EdgeFade { visible: root.mode === "week"; target: weekFlick; startSize: 0 }
        EdgeFade { visible: root.mode === "week"; target: weekFlick; horizontal: true }
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
    EdgeFade { visible: root.mode === "week"; target: weekFlick; horizontal: true }
    // Web dark agenda: a faint ghost-art wash. Measured on the refs: a flat tint (39,34,39) over the first ~600 px that fades out by ~720,
    // plus a brighter left edge (about +15 at x=0) easing out over ~70 px down to ~340 px.
    Rectangle {
        z: -1; visible: Tokens.dark && root.mode === "agenda"
        anchors.fill: parent   // the web's wash fills the page; its tint is gone by 360 px (0.527 of 682.5)
        gradient: Gradient {
            GradientStop { position: 0; color: "#272227" }
            GradientStop { position: 0.4375; color: "#272227" }
            GradientStop { position: 0.527; color: Tokens.bg }
            GradientStop { position: 1; color: Tokens.bg }
        }
    }
    // Web agenda: the first release's key art, grey and dimmed, behind the list (a 405.6 px wide picture, 7.5 px up).
    HeroArt {
        z: -1
        visible: root.mode === "agenda" && root.groups.length > 0 && root.groups[0].entries.length > 0
        work: root.groups.length > 0 && root.groups[0].entries.length > 0 && root.groups[0].entries[0].work_id ? { id: root.groups[0].entries[0].work_id, images: [] } : null
        overrideSrc: root.groups.length > 0 && root.groups[0].entries.length > 0 && root.groups[0].entries[0].work_id ? Api.artworkOf(root.groups[0].entries[0].work_id, "backdrop") : ""
        boxH: 124 * Tokens.u; imgH: 375 * Tokens.u; fadeFrom: 0.3; fadeTo: 1; lightLift: 0.93
    }
    LinearGradient {
        z: -1; visible: Tokens.dark && root.mode === "agenda"
        width: 40 * Tokens.u; height: 170 * Tokens.u
        start: Qt.point(0, 0); end: Qt.point(width, 0)
        gradient: Gradient {
            GradientStop { position: 0; color: "#12ffffff" }
            GradientStop { position: 1; color: "#00ffffff" }
        }
    }
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
        EdgeFade { visible: root.mode === "agenda"; target: flick }
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
            PLabel { renderType: Text.NativeRendering; width: parent.width / 2; height: parent.height; text: qsTr("Month"); horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.inkSoft; font.family: Tokens.family610; font.pixelSize: Tokens.fs(13) }
            PLabel { renderType: Text.NativeRendering; width: parent.width / 2; height: parent.height; text: qsTr("Year"); horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.inkSoft; font.family: Tokens.family610; font.pixelSize: Tokens.fs(13) }
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
                Accessible.name: model.name
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
                PLabel { renderType: Text.NativeRendering; anchors.fill: parent; text: model.name; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: Tokens.fs(14) }
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
                Accessible.name: String(model.year)
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
                PLabel { renderType: Text.NativeRendering; anchors.fill: parent; text: String(model.year); horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: Tokens.fs(14) }
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
