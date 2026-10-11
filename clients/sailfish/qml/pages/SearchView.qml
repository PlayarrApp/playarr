import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

Item {
    id: root
    property var works: []
    property bool busy: false
    property string pending: ""
    signal opened(var work)

    Timer {
        id: debounce
        interval: 350
        onTriggered: root.run(field.text)
    }
    function run(q) {
        q = q.trim()
        if (q.length < 2) { works = []; busy = false; return }
        busy = true
        pending = q
        Api.request("GET", "/api/v1/catalog/search?limit=25&q=" + encodeURIComponent(q), null, function (status, data) {
            if (q !== pending) return
            busy = false
            works = (status === 200 && data) ? data.items : []
        })
    }

    SearchField {
        id: field
        y: 16 * Tokens.u
        width: parent.width
        placeholderText: qsTr("Search")
        color: Tokens.ink
        EnterKey.iconSource: "image://theme/icon-m-enter-close"
        EnterKey.onClicked: focus = false
        onTextChanged: debounce.restart()
    }
    WorkGrid {
        anchors { top: field.bottom; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: root.works
        done: true
        bottomMargin: 100 * Tokens.u
        onOpened: root.opened(work)
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
}
