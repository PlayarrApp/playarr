import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Download tickets on the server and the offline copies kept on this device.
Item {
    id: root
    signal opened(var work)
    signal goHome()
    property var tickets: []
    property bool busy: true
    property bool failed: false

    function localFor(id) {
        var l = Downloads.items
        for (var i = 0; i < l.length; ++i) if (l[i].ticketId === id) return l[i]
        return null
    }
    function titleOf(t) {
        var l = localFor(t.id)
        return (l && l.title) || Api.setting("dltitle-" + t.id, "") || qsTr("Download %1").arg(t.id.substr(0, 8))
    }
    function mb(n) { return n > 0 ? (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB" : "" }
    function statusText(t) {
        var l = localFor(t.id)
        if (l && l.state === "done") return qsTr("On this device") + " · " + mb(l.size)
        if (l && l.state === "downloading") return qsTr("Downloading %1 / %2").arg(mb(l.received)).arg(mb(l.size))
        if (l && l.state === "paused") return qsTr("Paused") + " · " + mb(l.received) + " / " + mb(l.size)
        return t.status === "ready" ? qsTr("Ready") + " · " + mb(t.size_bytes)
             : t.status === "failed" ? qsTr("Failed") : t.status === "expired" ? qsTr("Expired") : t.status === "canceled" ? qsTr("Canceled") : qsTr("Preparing")
    }
    function load() {
        Api.request("GET", "/api/v1/downloads", null, function (status, data) {
            busy = false
            if (status !== 200 || !data) { failed = true; return }
            failed = false
            tickets = data
        })
    }
    function removeTicket(t) {
        Downloads.remove(t.id)
        Api.request("DELETE", "/api/v1/downloads/" + t.id, null, function () { load() })
    }
    Component.onCompleted: load()
    Timer { interval: 5000; repeat: true; running: true; onTriggered: root.load() }

    PageTitle {
        id: head
        y: 12 * Tokens.u
        title: qsTr("Downloads")
        onBackClicked: root.goHome()
    }
    SilicaListView {
        id: list
        anchors { top: head.bottom; topMargin: 6 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        model: root.tickets
        spacing: 10 * Tokens.u
        clip: true
        bottomMargin: 100 * Tokens.u
        delegate: Item {
            id: row
            property var local: root.localFor(modelData.id)
            property bool done: !!local && local.state === "done"
            x: Tokens.pad
            width: list.width - 2 * Tokens.pad
            height: 96 * Tokens.u
            Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line }
            Rectangle {   // progress of the local copy
                visible: !!row.local && row.local.state !== "done" && row.local.size > 0
                x: 14 * Tokens.u; anchors.bottom: parent.bottom; anchors.bottomMargin: 8 * Tokens.u; height: 3 * Tokens.u; radius: 2
                width: visible ? (parent.width - 28 * Tokens.u) * Math.min(1, row.local.received / row.local.size) : 0
                color: Tokens.brandPink
            }
            Column {
                anchors { left: parent.left; leftMargin: 16 * Tokens.u; right: actions.left; rightMargin: 8 * Tokens.u; verticalCenter: parent.verticalCenter }
                Label { width: parent.width; text: root.titleOf(modelData); elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 16 * Tokens.u }
                Label { width: parent.width; text: root.statusText(modelData); elide: Text.ElideRight; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
            }
            Row {
                id: actions
                anchors { right: parent.right; rightMargin: 10 * Tokens.u; verticalCenter: parent.verticalCenter }
                spacing: 6 * Tokens.u
                PillButton {
                    visible: row.done || (modelData.status === "ready" && (!row.local || row.local.state === "paused" || row.local.state === "failed"))
                    primary: true
                    text: row.done ? qsTr("Play") : qsTr("Save")
                    implicitWidth: 72 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: {
                        if (row.done)
                            pageStack.push(Qt.resolvedUrl("PlayerPage.qml"), { localPath: row.local.path, title: root.titleOf(modelData) })
                        else
                            Downloads.fetch(modelData.id, root.titleOf(modelData), modelData.container, modelData.size_bytes || 0)
                    }
                }
                PillButton {
                    visible: !!row.local && row.local.state === "downloading"
                    text: qsTr("Pause")
                    implicitWidth: 72 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: Downloads.pause(modelData.id)
                }
                PillButton {
                    text: "✕"
                    implicitWidth: 40 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: remorse.execute(qsTr("Deleting download"), function () { root.removeTicket(modelData) })
                }
            }
        }
        EdgeFade { target: list }
        VerticalScrollDecorator {}
    }
    RemorsePopup { id: remorse }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
    ViewPlaceholder {
        enabled: !root.busy && root.tickets.length === 0
        text: root.failed ? qsTr("Could not load downloads") : qsTr("No downloads yet")
        hintText: root.failed ? "" : qsTr("Download a title from its page to watch it offline.")
    }
}
