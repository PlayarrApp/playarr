import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"
import "../components/Library.js" as Library
import "../components/NavIcons.js" as NavIcons

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
        var q = "/api/v1/catalog?kind=" + kind + "&available_only=true&limit=200&offset=" + works.length
              + "&sort=" + Api.setting("lib.sort", "title") + "&order=" + Api.setting("lib.order", "asc")
        var al = Api.setting("lib.audio", ""), sl = Api.setting("lib.subs", "")
        if (al) q += "&audio_lang=" + al
        if (sl) q += "&subtitle_lang=" + sl
        Api.request("GET", q, null,
                    function (status, data) {
            if (gen !== generation) return
            busy = false
            if (status !== 200 || !data) { total = works.length; return }
            var seen = {}, merged = []
            works.concat(data.items).forEach(function (w) { if (!seen[w.id]) { seen[w.id] = true; merged.push(w) } })
            works = orderWorks(merged)
            total = data.total !== null && data.total !== undefined ? data.total : (data.items.length < 200 ? works.length : -1)
        })
    }
    // Web's client-side order: natural title order (digits compare as numbers) or date added.
    function orderWorks(list) { return Library.order(list, Api.setting("lib.sort", "title"), Api.setting("lib.order", "asc")) }
    MouseArea {
        id: filterBtn
        anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: heading.verticalCenter }
        width: 43.7 * Tokens.u; height: width
        onClicked: {
            var p = pageStack.push(Qt.resolvedUrl("FiltersPage.qml"))
            p.applied.connect(function () { root.viewMode = Api.setting("lib.view", "screen"); root.reload() })
        }
        Rectangle { anchors.fill: parent; radius: 11 * Tokens.u; color: "transparent"; border.width: 1; border.color: Tokens.line; opacity: filterBtn.pressed ? 0.5 : 1 }
        Image { anchors.centerIn: parent; width: 15 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); opacity: 0.8; source: NavIcons.url("filter", Tokens.ink) }
    }
    PageTitle {
        id: heading
        y: 4 * Tokens.u
        title: root.title
        onBackClicked: root.goHome()
    }
    Label {
        id: count
        anchors { top: heading.bottom; topMargin: -4 * Tokens.u; left: parent.left; leftMargin: 70 * Tokens.u }
        visible: root.total > 0
        text: (root.kind === "artist" ? qsTr("%1 artists") : qsTr("%1 titles")).arg(Number(root.total).toLocaleString(Qt.locale(), "f", 0)).toUpperCase()
        color: Tokens.brandPinkSoft
        font.family: Tokens.family820
        font.letterSpacing: 1 * Tokens.u
        font.pixelSize: 10.2 * Tokens.u
    }
    WorkGrid {
        id: grid
        anchors { top: count.bottom; topMargin: 3 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: root.works
        mode: root.viewMode
        busy: root.busy
        done: root.total >= 0 && root.works.length >= root.total
        bottomMargin: 100 * Tokens.u
        onOpened: root.opened(work)
        onHeld: root.held(work)
        onLoadMore: root.more()
    }
    // Alphabet rail (web #860): jump to the first title at or after a letter; loads further pages until one is found.
    readonly property bool railOn: Api.setting("lib.sort", "title") === "title" && (kind === "movie" || kind === "series")
    property string activeLetter: "#"
    property string jumping: ""
    readonly property var alphabet: ["#", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]
    function letterOf(w) { var c = String((w.sort_title && w.sort_title.length) ? w.sort_title : w.title).trim().charAt(0).toUpperCase(); return /^[A-Z]$/.test(c) ? c : "#" }
    function jumpTo(letter) {
        var desc = Api.setting("lib.order", "asc") === "desc"
        var order = desc ? alphabet.slice().reverse() : alphabet, target = order.indexOf(letter)
        for (var i = 0; i < works.length; ++i) {
            if (order.indexOf(letterOf(works[i])) >= target) { jumping = ""; grid.positionViewAtIndex(i, GridView.Beginning); return }
        }
        if (total < 0 || works.length < total) { jumping = letter; more() } else jumping = ""
    }
    onWorksChanged: if (jumping !== "") jumpTo(jumping)
    Connections {
        target: grid
        onContentYChanged: {
            var i = grid.indexAt(10, grid.contentY + 10)
            if (i >= 0 && i < root.works.length) root.activeLetter = root.letterOf(root.works[i])
        }
    }
    Column {
        visible: root.railOn
        anchors { right: parent.right; rightMargin: -4.9 * Tokens.u; top: parent.top; topMargin: 87 * Tokens.u }
        Repeater {
            model: root.alphabet
            MouseArea {
                width: 26 * Tokens.u; height: 19 * Tokens.u
                onClicked: root.jumpTo(modelData)
                Rectangle { anchors.centerIn: parent; width: 15.5 * Tokens.u; height: width; radius: width / 2; visible: root.activeLetter === modelData
                            color: Tokens.dark ? "#d4d1d4" : Tokens.ink }
                Label { anchors.centerIn: parent; text: root.jumping === modelData ? "\u00B7" : modelData; font.family: Tokens.family610; font.pixelSize: 8.6 * Tokens.u
                        color: root.activeLetter === modelData ? (Tokens.dark ? "#1b181b" : "#ffffff") : Tokens.inkSoft }
            }
        }
    }
    ViewPlaceholder {
        enabled: !root.busy && root.total === 0
        text: qsTr("Nothing here yet")
    }
}
