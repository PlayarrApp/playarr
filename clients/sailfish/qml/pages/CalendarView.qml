import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Agenda: 30-day pages of releases grouped by day (web's agenda view).
Item {
    id: root
    signal opened(var work)
    signal goHome()
    readonly property int days: 30
    property int page: 0
    property var groups: []
    property bool busy: false
    property bool failed: false
    property int generation: 0

    function load() {
        var gen = ++generation
        busy = true
        failed = false
        var start = Calendar.pageStart(page, days), end = Calendar.pageEnd(page, days)
        Api.request("GET", "/api/v1/calendar?start=" + start + "&end=" + end, null, function (status, data) {
            if (gen !== generation) return
            busy = false
            if (status !== 200 || !data) { failed = true; groups = []; return }
            groups = Calendar.groupByDate(data.entries)
        })
    }
    function rangeText() {
        var a = new Date(Calendar.pageStart(page, days) + "T00:00:00"), b = new Date(Calendar.pageEnd(page, days) + "T00:00:00")
        return Qt.formatDate(a, "d MMM") + " – " + Qt.formatDate(b, "d MMM")
    }
    function openEntry(e) {
        if (!e.work_id) return
        root.opened({ id: e.work_id, title: e.title, kind: e.media_kind === "episode" ? "series" : e.media_kind === "album" ? "artist" : e.media_kind,
                      images: [], genres: [], release_date: e.date })
    }
    onPageChanged: load()
    Component.onCompleted: load()

    PageTitle {
        id: head
        y: 12 * Tokens.u
        title: qsTr("Calendar")
        onBackClicked: root.goHome()
    }
    Row {
        id: nav
        anchors { top: head.bottom; topMargin: 6 * Tokens.u; right: parent.right; rightMargin: Tokens.pad }
        spacing: 8 * Tokens.u
        PillButton { text: root.rangeText() }
        PillButton { text: "←"; width: 44 * Tokens.u; implicitWidth: 44 * Tokens.u; onClicked: root.page-- }
        PillButton { text: qsTr("Today"); primary: root.page === 0; onClicked: root.page = 0 }
        PillButton { text: "→"; width: 44 * Tokens.u; implicitWidth: 44 * Tokens.u; onClicked: root.page++ }
    }
    SilicaFlickable {
        id: flick
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
                    Label {
                        x: Tokens.pad
                        text: Calendar.dayHeading(modelData.date)
                        color: Tokens.ink
                        font.family: Tokens.family
                        font.pixelSize: 20 * Tokens.u
                    }
                    Repeater {
                        model: modelData.entries
                        MouseArea {
                            id: card
                            x: Tokens.pad
                            width: col.width - 2 * Tokens.pad
                            height: Math.max(96 * Tokens.u, info.height + 24 * Tokens.u)
                            onClicked: root.openEntry(modelData)
                            Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: card.pressed ? 0.6 : 1 }
                            // Left border: we have it (playable) or not, never which library.
                            Rectangle { width: 5 * Tokens.u; height: parent.height - 16 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; radius: 2
                                        color: modelData.has_file ? Tokens.accent : Tokens.inkMuted }
                            Rectangle {
                                id: poster
                                x: 18 * Tokens.u
                                anchors.verticalCenter: parent.verticalCenter
                                width: 54 * Tokens.u; height: 80 * Tokens.u; radius: 6 * Tokens.u; clip: true
                                color: Tokens.surfaceSoft
                                Image {
                                    anchors.fill: parent
                                    fillMode: Image.PreserveAspectCrop
                                    asynchronous: true
                                    sourceSize.width: 120
                                    source: modelData.work_id ? Api.url("/api/v1/artwork/work/" + modelData.work_id + "/poster") : ""
                                }
                            }
                            Column {
                                id: info
                                anchors { left: poster.right; leftMargin: 14 * Tokens.u; right: parent.right; rightMargin: 12 * Tokens.u; verticalCenter: parent.verticalCenter }
                                spacing: 3 * Tokens.u
                                Label { width: parent.width; text: modelData.title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.weight: Font.DemiBold; font.pixelSize: 17 * Tokens.u }
                                Label {
                                    width: parent.width
                                    visible: text !== ""
                                    text: [Calendar.episodeCode(modelData), modelData.subtitle].filter(function (x) { return !!x }).join(" · ")
                                    elide: Text.ElideRight; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u
                                }
                                Row {
                                    spacing: 10 * Tokens.u
                                    Label { text: modelData.release_at ? Qt.formatTime(new Date(modelData.release_at), "hh:mm") : ""; visible: text !== ""; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
                                    Rectangle {
                                        width: badge.width + 16 * Tokens.u; height: badge.height + 6 * Tokens.u; radius: height / 2
                                        color: "transparent"; border.width: 1; border.color: modelData.has_file ? Tokens.accent : Tokens.brandPink
                                        Label { id: badge; anchors.centerIn: parent; text: modelData.has_file ? qsTr("Available") : qsTr("Upcoming"); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 12 * Tokens.u }
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
