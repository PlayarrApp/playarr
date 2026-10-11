import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// The viewer's playlists (and system playlists); tap one to see its titles.
Item {
    id: root
    signal opened(var work)
    signal goHome()
    property var playlists: []
    property bool busy: true
    property bool failed: false
    Component.onCompleted: Api.request("GET", "/api/v1/playlists", null, function (status, data) {
        busy = false
        if (status !== 200 || !data) { failed = true; return }
        playlists = data
    })

    PageTitle {
        id: head
        y: 4 * Tokens.u
        title: qsTr("Playlists")
        onBackClicked: root.goHome()
    }
    SilicaListView {
        id: list
        anchors { top: head.bottom; topMargin: 8 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        model: root.playlists
        spacing: 10 * Tokens.u
        clip: true
        bottomMargin: 100 * Tokens.u
        delegate: MouseArea {
            x: Tokens.pad
            width: list.width - 2 * Tokens.pad
            height: 64 * Tokens.u
            onClicked: pageStack.push(Qt.resolvedUrl("PlaylistPage.qml"), { playlist: modelData })
            Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line }
            Column {
                anchors { left: parent.left; leftMargin: 16 * Tokens.u; right: parent.right; rightMargin: 12 * Tokens.u; verticalCenter: parent.verticalCenter }
                Label { width: parent.width; text: modelData.name; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 16 * Tokens.u }
                Label { text: modelData.is_system ? qsTr("Shared playlist") : qsTr("Your playlist"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 12 * Tokens.u }
            }
        }
        EdgeFade { target: list }
        VerticalScrollDecorator {}
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
    ViewPlaceholder {
        enabled: !root.busy && root.playlists.length === 0
        text: root.failed ? qsTr("Could not load playlists") : qsTr("No playlists yet")
        hintText: root.failed ? "" : qsTr("Add titles from their Actions menu.")
    }
}
