import QtQuick 2.6
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0
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
    property real keepY: 0
    property string targetLetter: ""
    // The grid lays out lazily: scroll once it has sized itself for the new rows.
    property int scrollTries: 0
    Timer { id: scrollTimer; interval: 200; onTriggered: {
        grid.positionViewAtIndex(root.firstAtOrAfter(root.targetLetter), GridView.Beginning); keepY = grid.contentY
        if (++root.scrollTries < 3) restart(); else root.scrollTries = 0 } }
    Timer { id: restoreY; interval: 0; onTriggered: if (root.jumping === "") grid.contentY = root.keepY }
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
            keepY = grid.contentY
            works = orderWorks(merged)
            if (keepY > 0) restoreY.restart()   // a new page resets the grid; stay where the reader is
            total = data.total !== null && data.total !== undefined ? data.total : (data.items.length < 200 ? works.length : -1)
        })
    }
    // Web's client-side order: natural title order (digits compare as numbers) or date added.
    function orderWorks(list) { return Library.order(list, Api.setting("lib.sort", "title"), Api.setting("lib.order", "asc")) }
    // Web dark library pages sit on a faint key-art wash that measures as a flat tint (about 39,34,39) from x=180 px to the
    // right edge, easing from the plain page colour on the left (web captures, music/series/movies, y 5 to 1200).
    LinearGradient {
        visible: Tokens.dark
        anchors.fill: parent; start: Qt.point(0, 0); end: Qt.point(width, 0)
        gradient: Gradient {
            GradientStop { position: 0; color: "#1b181b" }
            GradientStop { position: 0.03; color: "#1f1c1f" }
            GradientStop { position: 0.23; color: "#262126" }
            GradientStop { position: 0.4; color: "#272227" }
            GradientStop { position: 1; color: "#272227" }
        }
    }
    MouseArea {
        id: filterBtn
        anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: heading.verticalCenter }
        width: 43.7 * Tokens.u; height: width
        onClicked: {
            var p = pageStack.push(Qt.resolvedUrl("FiltersPage.qml"))
            p.applied.connect(function () { root.viewMode = Api.setting("lib.view", "screen"); root.reload() })
        }
        Rectangle { anchors.fill: parent; radius: 11 * Tokens.u; color: Tokens.dark ? "transparent" : Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: filterBtn.pressed ? 0.5 : 1 }
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
        visible: false   // web phone hides the header subtitle (#1299); the label keeps the grid's anchor
        text: (root.kind === "artist" ? qsTr("%1 artists") : qsTr("%1 titles")).arg(Number(root.total).toLocaleString(Qt.locale(), "f", 0)).toUpperCase()
        color: Tokens.brandInk
        font.family: Tokens.family820
        font.letterSpacing: 1 * Tokens.u
        font.pixelSize: 10.2 * Tokens.u
    }
    WorkGrid {
        id: grid
        anchors { top: count.bottom; topMargin: -24 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: root.works
        mode: root.viewMode
        restRing: true
        busy: root.busy
        done: root.total >= 0 && root.works.length >= root.total
        topMargin: 27 * Tokens.u   // 24 px of ring and glow room above the first row (the grid starts 24 px higher), then the 3 px gap
        bottomMargin: 100 * Tokens.u
        onOpened: root.opened(work)
        onHeld: root.held(work)
        onLoadMore: root.more()
    }
    // Alphabet rail (web #860): jump to the first title at or after a letter; loads further pages until one is found.
    readonly property bool railOn: Api.setting("lib.sort", "title") === "title" && (kind === "movie" || kind === "series" || kind === "artist")
    property string activeLetter: "#"
    property string jumping: ""
    readonly property var alphabet: ["#", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z"]
    function letterOf(w) { var c = String((w.sort_title && w.sort_title.length) ? w.sort_title : w.title).trim().charAt(0).toUpperCase(); return /^[A-Z]$/.test(c) ? c : "#" }
    function firstAtOrAfter(letter) {
        var order = Api.setting("lib.order", "asc") === "desc" ? alphabet.slice().reverse() : alphabet, target = order.indexOf(letter)
        for (var i = 0; i < works.length; ++i)
            if (order.indexOf(letterOf(works[i])) >= target) return i
        return -1
    }
    function jumpTo(letter) {
        if (firstAtOrAfter(letter) >= 0) { jumping = ""; targetLetter = letter; scrollTries = 0; scrollTimer.restart(); return }
        if (total < 0 || works.length < total) { jumping = letter; more() } else jumping = ""
    }
    onWorksChanged: {
        if (jumping !== "") jumpTo(jumping)
        else if (works.length > 0 && grid.contentY <= 0) activeLetter = letterOf(works[0])   // web highlights the first title's letter at rest
    }
    Connections {
        target: grid
        onContentYChanged: {
            var i = grid.indexAt(10, grid.contentY + 10)
            if (i >= 0 && i < root.works.length) root.activeLetter = root.letterOf(root.works[i])
        }
    }
    Column {
        visible: root.railOn
        anchors { right: parent.right; rightMargin: 13 * Tokens.u; top: parent.top; topMargin: 87.5 * Tokens.u }
        Repeater {
            model: root.alphabet
            MouseArea {
                width: 26 * Tokens.u; height: 19 * Tokens.u
                onClicked: root.jumpTo(modelData)
                Item {   // web focus ring on the first letter: crimson ring, page-coloured gap, clipped 1u above the rail
                    visible: modelData === "#" && root.activeLetter === modelData
                    x: -4 * Tokens.u; y: -1 * Tokens.u; width: parent.width + 8 * Tokens.u; height: parent.height + 7 * Tokens.u; clip: true
                    Rectangle { x: (parent.width - width) / 2; y: (19 * Tokens.u - height) / 2 + 1 * Tokens.u; width: 29.5 * Tokens.u; height: width; radius: width / 2; color: Tokens.brandPink }
                    Rectangle { x: (parent.width - width) / 2; y: (19 * Tokens.u - height) / 2 + 1 * Tokens.u; width: 24.5 * Tokens.u; height: width; radius: width / 2; color: Tokens.bg }
                }
                Rectangle { anchors.centerIn: parent; width: 22 * Tokens.u; height: width; radius: width / 2; visible: root.activeLetter === modelData
                            color: Tokens.dark ? "#d4d1d4" : Qt.rgba(0.22, 0.15, 0.13, 0.78) }   // web: ink at 78%
                Label { anchors.centerIn: parent; text: root.jumping === modelData ? "\u00B7" : modelData; font.family: Tokens.family610; font.pixelSize: 8.96 * Tokens.u
                        color: root.activeLetter === modelData ? (Tokens.dark ? "#1b181b" : "#ffffff") : Tokens.inkSoft }
            }
        }
    }
    ViewPlaceholder {
        enabled: !root.busy && root.total === 0
        text: qsTr("Nothing here yet")
    }
}
