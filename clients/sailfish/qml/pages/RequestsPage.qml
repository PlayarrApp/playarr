import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// The viewer's title requests and their progress.
PlayarrPage {
    id: page
    property var requests: []
    property bool busy: true
    property bool failed: false

    function statusText(s) {
        return s === "pending" ? qsTr("Pending") : s === "approved" ? qsTr("Approved") : s === "declined" ? qsTr("Declined")
             : s === "available" ? qsTr("Available") : s === "failed" ? qsTr("Failed") : s
    }
    Component.onCompleted: Api.request("GET", "/api/v1/requests", null, function (status, data) {
        busy = false
        if (status !== 200 || !data) { failed = true; return }
        requests = data
    })

    PageTitle {
        id: head
        y: 12 * Tokens.u
        title: qsTr("Requests")
        onBackClicked: pageStack.pop()
    }
    SilicaListView {
        id: list
        anchors { top: head.bottom; left: parent.left; right: parent.right; bottom: parent.bottom }
        model: page.requests
        spacing: 10 * Tokens.u
        clip: true
        delegate: Item {
            x: Tokens.pad
            width: list.width - 2 * Tokens.pad
            height: 76 * Tokens.u
            Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line }
            Column {
                anchors { left: parent.left; leftMargin: 16 * Tokens.u; right: badge.left; rightMargin: 8 * Tokens.u; verticalCenter: parent.verticalCenter }
                Label { renderType: Text.NativeRendering; width: parent.width; text: modelData.title + (modelData.year ? " (" + modelData.year + ")" : ""); elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 16 * Tokens.u }
                Label { renderType: Text.NativeRendering; width: parent.width; text: modelData.status_note || (modelData.kind === "series" ? qsTr("Series") : qsTr("Movie")); elide: Text.ElideRight; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
            }
            Rectangle {
                id: badge
                anchors { right: parent.right; rightMargin: 12 * Tokens.u; verticalCenter: parent.verticalCenter }
                width: bl.width + 16 * Tokens.u; height: bl.height + 6 * Tokens.u; radius: height / 2
                color: "transparent"; border.width: 1
                border.color: modelData.status === "declined" || modelData.status === "failed" ? Tokens.danger : modelData.status === "available" ? Tokens.accent : Tokens.brandPink
                Label { renderType: Text.NativeRendering; id: bl; anchors.centerIn: parent; text: page.statusText(modelData.status); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 12 * Tokens.u }
            }
        }
        EdgeFade { target: list }
        VerticalScrollDecorator {}
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: page.busy }
    ViewPlaceholder {
        enabled: !page.busy && page.requests.length === 0
        text: page.failed ? qsTr("Could not load requests") : qsTr("No requests yet")
        hintText: page.failed ? "" : qsTr("Request a title that is not in the library and its progress shows up here.")
    }
}
