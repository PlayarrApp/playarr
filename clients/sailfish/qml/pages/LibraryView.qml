import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Library grid for one kind with infinite scroll (pages of 50).
Item {
    id: root
    property string kind: "movie"
    property string title: ""
    property var works: []
    property int total: -1
    property bool busy: false
    property int generation: 0
    signal opened(var work)

    function reload() {
        generation++
        works = []
        total = -1
        busy = false
        more()
    }
    function more() {
        if (busy || (total >= 0 && works.length >= total)) return
        busy = true
        var gen = generation
        Api.request("GET", "/api/v1/catalog?kind=" + kind + "&available_only=true&limit=50&offset=" + works.length, null,
                    function (status, data) {
            if (gen !== generation) return
            busy = false
            if (status !== 200 || !data) { total = works.length; return }
            works = works.concat(data.items)
            total = data.total !== null && data.total !== undefined ? data.total : (data.items.length < 50 ? works.length : -1)
        })
    }
    Component.onCompleted: reload()

    Label {
        id: heading
        x: Tokens.pad
        y: 28 * Tokens.u
        text: root.title
        color: Tokens.ink
        font.family: Tokens.family
        font.pixelSize: 30 * Tokens.u
    }
    WorkGrid {
        anchors { top: heading.bottom; topMargin: 18 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: root.works
        busy: root.busy
        done: root.total >= 0 && root.works.length >= root.total
        bottomMargin: 100 * Tokens.u
        onOpened: root.opened(work)
        onLoadMore: root.more()
    }
    ViewPlaceholder {
        enabled: !root.busy && root.total === 0
        text: qsTr("Nothing here yet")
    }
}
