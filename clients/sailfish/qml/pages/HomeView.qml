import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Home: "Start watching" (resume) followed by the server-curated rails.
SilicaFlickable {
    id: root
    signal opened(var work)
    property var rails: []
    property bool busy: true
    property bool failed: false
    contentHeight: column.height + 120 * Tokens.u

    function load() {
        busy = true
        failed = false
        Api.request("GET", "/api/v1/home/rails", null, function (status, data) {
            busy = false
            if (status !== 200 || !data) { failed = true; return }
            var list = []
            for (var i = 0; i < data.rails.length; ++i)
                list.push({ title: data.rails[i].title, items: data.rails[i].items })
            rails = list
            loadResume()
        })
    }

    // Continue watching: part-watched progress entries resolved to their titles.
    function loadResume() {
        Api.request("GET", "/api/v1/playback/progress", null, function (status, data) {
            if (status !== 200 || !data) return
            var entries = data.filter(function (p) { return p.state === "part_watched" })
            entries.sort(function (a, b) { return (b.updated_at || "").localeCompare(a.updated_at || "") })
            var seen = {}, ids = []
            for (var i = 0; i < entries.length && ids.length < 10; ++i)
                if (!seen[entries[i].work_id]) { seen[entries[i].work_id] = true; ids.push(entries[i].work_id) }
            var works = [], left = ids.length
            if (left === 0) return
            ids.forEach(function (id, idx) {
                Api.request("GET", "/api/v1/catalog/" + id, null, function (st, detail) {
                    works[idx] = (st === 200 && detail) ? detail.work : null
                    if (--left === 0) {
                        var items = works.filter(function (w) { return w })
                        if (items.length > 0)
                            rails = [{ title: qsTr("Start watching"), items: items }].concat(rails)
                    }
                })
            })
        })
    }

    Component.onCompleted: load()
    PullDownMenu { MenuItem { text: qsTr("Refresh"); onClicked: root.load() } }

    Column {
        id: column
        width: parent.width
        spacing: 30 * Tokens.u
        Item { width: 1; height: 36 * Tokens.u }
        Repeater {
            model: root.rails
            Rail {
                title: modelData.title
                items: modelData.items
                onOpened: root.opened(work)
            }
        }
    }
    ViewPlaceholder {
        enabled: root.failed
        text: qsTr("Could not load Home")
        hintText: qsTr("Pull down to retry")
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
    VerticalScrollDecorator {}
}
