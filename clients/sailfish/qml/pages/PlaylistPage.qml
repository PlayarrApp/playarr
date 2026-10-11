import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

PlayarrPage {
    id: page
    property var playlist
    property var works: []
    property bool busy: true
    Component.onCompleted: Api.request("GET", "/api/v1/playlists/" + playlist.id + "/items", null, function (status, items) {
        if (status !== 200 || !items || items.length === 0) { busy = false; return }
        var out = [], left = items.length
        items.forEach(function (it, i) {
            Api.request("GET", "/api/v1/catalog/" + it.work_id, null, function (st, d) {
                out[i] = (st === 200 && d) ? d.work : null
                if (--left === 0) { works = out.filter(function (w) { return w }); busy = false }
            })
        })
    })
    PageTitle { id: head; y: 4 * Tokens.u; title: page.playlist.name; onBackClicked: pageStack.pop() }
    WorkGrid {
        anchors { top: head.bottom; topMargin: 8 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: page.works
        done: true
        onOpened: pageStack.push(Qt.resolvedUrl("DetailPage.qml"), { work: work })
        onHeld: pageStack.push(Qt.resolvedUrl("ActionsPage.qml"), { work: work })
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: page.busy }
    ViewPlaceholder { enabled: !page.busy && page.works.length === 0; text: qsTr("This playlist is empty") }
}
