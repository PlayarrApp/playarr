import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"
import "../components/NavIcons.js" as NavIcons

// Agenda: 30-day pages of releases grouped by day (web's agenda view).
Item {
    id: root
    signal opened(var work)
    signal goHome()
    property string mode: Api.setting("cal.mode", "agenda")   // month | week | agenda
    property int page: 0
    property var range: Calendar.rangeFor(mode, 0)
    property var weekRows: []
    property var groups: []
    property bool busy: false
    property bool failed: false
    property int generation: 0

    function load() {
        var gen = ++generation
        busy = true
        failed = false
        range = Calendar.rangeFor(mode, page)
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
        var d = new Date(iso + "T00:00:00"), t = new Date(Calendar.rangeFor("week", 0).start + "T00:00:00")
        var dow = (d.getDay() + 6) % 7
        var mon = new Date(d.getTime() - dow * 86400000)
        mode = "week"
        page = Math.round((mon.getTime() - t.getTime()) / (7 * 86400000))
        Api.setSetting("cal.mode", "week")
        load()
    }
    function setMode(m) { mode = m; page = 0; load() }
    function openEntry(e) {
        if (!e.work_id) return
        root.opened({ id: e.work_id, title: e.title, kind: e.media_kind === "episode" ? "series" : e.media_kind === "album" ? "artist" : e.media_kind,
                      images: [], genres: [], release_date: e.date })
    }
    onPageChanged: load()
    Component.onCompleted: load()

    PageTitle {
        id: head
        y: 4 * Tokens.u
        title: qsTr("Calendar")
        onBackClicked: root.goHome()
    }
    MouseArea {
        id: filterBtn
        anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: head.verticalCenter }
        width: 36 * Tokens.u; height: width
        onClicked: {
            var p = pageStack.push(Qt.resolvedUrl("FiltersPage.qml"), { calendar: true })
            p.applied.connect(function () { root.setMode(Api.setting("cal.mode", "agenda")) })
        }
        Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: "transparent"; border.width: 1; border.color: Tokens.line; opacity: filterBtn.pressed ? 0.5 : 1 }
        Image { anchors.centerIn: parent; width: 20 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); source: NavIcons.url("filter", Tokens.ink) }
    }
    Row {
        id: nav
        anchors { top: head.bottom; topMargin: 6 * Tokens.u; right: parent.right; rightMargin: Tokens.pad }
        spacing: 8 * Tokens.u
        PillButton { text: root.range.label; fontSize: 9.5 * Tokens.u; implicitHeight: 34 * Tokens.u; implicitWidth: 100 * Tokens.u }
        PillButton { text: "←"; width: 44 * Tokens.u; implicitWidth: 44 * Tokens.u; onClicked: root.page-- }
        PillButton { text: qsTr("Today"); fontSize: 9.5 * Tokens.u; implicitHeight: 34 * Tokens.u; implicitWidth: 66 * Tokens.u; onClicked: root.page = 0 }
        PillButton { text: "→"; width: 44 * Tokens.u; implicitWidth: 44 * Tokens.u; onClicked: root.page++ }
    }
    Item {
        id: month
        visible: root.mode === "month"
        anchors { top: nav.bottom; topMargin: 10 * Tokens.u; left: parent.left; right: parent.right; rightMargin: Tokens.pad; leftMargin: Tokens.pad }
        height: 22 * Tokens.u + root.weekRows.length * cellH
        readonly property real cellW: width / 7
        readonly property real cellH: 118 * Tokens.u
        Row {
            Repeater {
                model: [qsTr("MON"), qsTr("TUE"), qsTr("WED"), qsTr("THU"), qsTr("FRI"), qsTr("SAT"), qsTr("SUN")]
                Label { width: month.cellW; horizontalAlignment: Text.AlignHCenter; text: modelData; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u }
            }
        }
        Column {
            y: 22 * Tokens.u
            Repeater {
                model: root.weekRows
                Row {
                    Repeater {
                        model: modelData
                        MouseArea {
                            width: month.cellW; height: month.cellH
                            property var es: root.entriesOn(modelData.date)
                            onClicked: root.openDay(modelData.date)
                            Rectangle { anchors.fill: parent; color: "transparent"; border.width: 1; border.color: Tokens.line }
                            Column {
                                anchors { fill: parent; margins: 3 * Tokens.u }
                                spacing: 1
                                Label { text: modelData.day; color: modelData.month === root.range.month ? Tokens.ink : Tokens.inkMuted; font.family: Tokens.family; font.weight: modelData.date === Qt.formatDate(new Date(), "yyyy-MM-dd") ? Font.Bold : Font.Normal; font.pixelSize: 12 * Tokens.u }
                                Repeater {
                                    model: Math.min(3, es.length)
                                    Row {
                                        spacing: 2 * Tokens.u
                                        Rectangle { y: 4 * Tokens.u; width: 5 * Tokens.u; height: width; radius: width / 2; color: es[index].has_file ? Tokens.success : Tokens.brandPink }
                                        Label { width: month.cellW - 18 * Tokens.u; text: es[index].title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                                    }
                                }
                                Label { visible: es.length > 3; text: qsTr("+%1 more").arg(es.length - 3); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                            }
                        }
                    }
                }
            }
        }
    }
    SilicaFlickable {
        id: flick
        visible: root.mode !== "month"
        anchors { top: nav.bottom; topMargin: 12 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        contentHeight: col.height + 120 * Tokens.u
        clip: true
        Column {
            id: col
            width: parent.width
            spacing: 10 * Tokens.u
            Repeater {
                model: root.groups
                Column {
                    width: col.width
                    spacing: 8 * Tokens.u
                    Row {
                        x: Tokens.pad
                        spacing: 8 * Tokens.u
                    Label {
                        text: Calendar.dayHeading(modelData.date)
                        color: Tokens.ink
                        font.family: Tokens.family
                        font.weight: Font.DemiBold
                        font.pixelSize: 12.5 * Tokens.u
                    }
                    Rectangle {
                        visible: modelData.date === Qt.formatDate(new Date(), "yyyy-MM-dd")
                        anchors.verticalCenter: parent.verticalCenter
                        width: todayLbl.width + 14 * Tokens.u; height: 18 * Tokens.u; radius: height / 2
                        color: "transparent"; border.width: 1; border.color: Tokens.brandPink
                        Label { id: todayLbl; anchors.centerIn: parent; text: qsTr("TODAY"); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 7.5 * Tokens.u }
                    }
                    }
                    Repeater {
                        model: modelData.entries
                        MouseArea {
                            id: card
                            x: Tokens.pad
                            width: col.width - 2 * Tokens.pad
                            height: Math.max(70 * Tokens.u, info.height + 18 * Tokens.u)
                            onClicked: root.openEntry(modelData)
                            Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: card.pressed ? 0.6 : 1 }
                            // Left border: we have it (playable) or not, never which library.
                            Rectangle { width: 5 * Tokens.u; height: parent.height - 16 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; radius: 2
                                        color: modelData.has_file ? Tokens.accent : Tokens.inkMuted }
                            Rectangle {
                                id: poster
                                x: 14 * Tokens.u
                                anchors.verticalCenter: parent.verticalCenter
                                width: 34 * Tokens.u; height: 50 * Tokens.u; radius: 4 * Tokens.u; clip: true
                                color: Tokens.surfaceSoft
                                Image {
                                    anchors.fill: parent
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                    sourceSize.width: 120
                                    source: modelData.work_id ? Api.artworkOf(modelData.work_id, "poster") : ""
                                }
                            }
                            Column {
                                id: info
                                anchors { left: poster.right; leftMargin: 14 * Tokens.u; right: parent.right; rightMargin: 12 * Tokens.u; verticalCenter: parent.verticalCenter }
                                spacing: 3 * Tokens.u
                                Label { width: parent.width; text: modelData.title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.weight: Font.DemiBold; font.pixelSize: 12.5 * Tokens.u }
                                Label {
                                    width: parent.width
                                    visible: text !== ""
                                    text: [Calendar.episodeCode(modelData), modelData.subtitle].filter(function (x) { return !!x }).join(" · ")
                                    elide: Text.ElideRight; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u
                                }
                                Row {
                                    spacing: 10 * Tokens.u
                                    Label { text: modelData.release_at ? Qt.formatTime(new Date(modelData.release_at), "hh:mm") : qsTr("All day"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                                    Label { text: modelData.release_type === "air" ? qsTr("Airs") : modelData.release_type === "cinema" ? qsTr("Cinema") : modelData.release_type === "digital" ? qsTr("Digital") : modelData.release_type === "physical" ? qsTr("Physical") : qsTr("Release"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                                    Label { text: modelData.media_kind === "episode" ? qsTr("Episodes") : modelData.media_kind === "movie" ? qsTr("Movies") : modelData.media_kind === "album" ? qsTr("Albums") : qsTr("Books"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                                    Rectangle {
                                        width: badge.width + 16 * Tokens.u; height: badge.height + 6 * Tokens.u; radius: height / 2
                                        color: "transparent"; border.width: 1; border.color: modelData.has_file ? Tokens.accent : Tokens.brandPink
                                        Label { id: badge; anchors.centerIn: parent; text: modelData.has_file ? qsTr("Available") : (modelData.monitored === false ? qsTr("Not tracked") : qsTr("Upcoming")); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 8.5 * Tokens.u }
                                    }
                                }
                            }
                        }
                    }
                }
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
}
