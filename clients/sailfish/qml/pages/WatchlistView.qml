import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// The viewer's watchlist (shared across devices). Tap opens a title in the library; press and hold removes.
Item {
    id: root
    signal opened(var work)
    signal goHome()
    property var works: []
    property bool busy: true
    property bool failed: false

    function load() {
        busy = true
        failed = false
        Api.request("GET", "/api/v1/watchlist", null, function (status, data) {
            busy = false
            if (status !== 200 || !data) { failed = true; return }
            works = data.items.map(function (e) {
                var t = e.title
                return { id: t.work_id || t.title_key, titleKey: t.title_key, inLibrary: !!t.work_id, kind: t.kind, title: t.title,
                         release_date: t.year ? String(t.year) : "", images: t.work_id ? [{ kind: "poster" }, { kind: "backdrop" }] : [], genres: [] }
            })
        })
    }
    function remove(w) {
        Api.request("DELETE", "/api/v1/watchlist/" + encodeURIComponent(w.titleKey), null, function () { load() })
    }
    Component.onCompleted: load()

    PageTitle {
        id: head
        y: 4 * Tokens.u
        title: qsTr("Watchlist")
        onBackClicked: root.goHome()
    }
    RemorsePopup { id: remorse }
    WorkGrid {
        anchors { top: head.bottom; topMargin: 6 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: root.works
        done: true
        bottomMargin: 100 * Tokens.u
        onOpened: if (work.inLibrary) root.opened(work)
        onHeld: remorse.execute(qsTr("Removing from watchlist"), function () { root.remove(work) })
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
    ViewPlaceholder {
        enabled: !root.busy && root.works.length === 0
        text: root.failed ? qsTr("Could not load your watchlist") : qsTr("Your watchlist is empty")
        hintText: root.failed ? "" : qsTr("Add titles from search or a title page to keep them here on every device.")
    }
}
