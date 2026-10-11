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
    signal goHome()
    signal held(var work)
    property string viewMode: Api.setting("lib.view", "screen")

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
        var q = "/api/v1/catalog?kind=" + kind + "&available_only=true&limit=50&offset=" + works.length
              + "&sort=" + Api.setting("lib.sort", "title") + "&order=" + Api.setting("lib.order", "asc")
        var al = Api.setting("lib.audio", ""), sl = Api.setting("lib.subs", "")
        if (al) q += "&audio_lang=" + al
        if (sl) q += "&subtitle_lang=" + sl
        Api.request("GET", q, null,
                    function (status, data) {
            if (gen !== generation) return
            busy = false
            if (status !== 200 || !data) { total = works.length; return }
            works = works.concat(data.items)
            total = data.total !== null && data.total !== undefined ? data.total : (data.items.length < 50 ? works.length : -1)
        })
    }
    Component.onCompleted: reload()

    MouseArea {
        id: filterBtn
        anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: heading.verticalCenter }
        width: 44 * Tokens.u; height: width
        onClicked: {
            var p = pageStack.push(Qt.resolvedUrl("FiltersPage.qml"))
            p.applied.connect(function () { root.viewMode = Api.setting("lib.view", "screen"); root.reload() })
        }
        Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: "transparent"; border.width: 1; border.color: Tokens.lineStrong; opacity: filterBtn.pressed ? 0.5 : 1 }
        Icon { anchors.centerIn: parent; source: "image://theme/icon-m-menu?" + Tokens.ink; sourceSize: Qt.size(24 * Tokens.u, 24 * Tokens.u) }
    }
    PageTitle {
        id: heading
        y: 12 * Tokens.u
        title: root.title
        onBackClicked: root.goHome()
    }
    WorkGrid {
        anchors { top: heading.bottom; topMargin: 6 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: root.works
        mode: root.viewMode
        busy: root.busy
        done: root.total >= 0 && root.works.length >= root.total
        bottomMargin: 100 * Tokens.u
        onOpened: root.opened(work)
        onHeld: root.held(work)
        onLoadMore: root.more()
    }
    ViewPlaceholder {
        enabled: !root.busy && root.total === 0
        text: qsTr("Nothing here yet")
    }
}
