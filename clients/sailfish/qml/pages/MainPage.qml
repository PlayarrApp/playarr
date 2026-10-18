import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"
import "../components/Library.js" as Library

// Signed-in shell: section views above the floating nav pill.
PlayarrPage {
    id: page
    objectName: "main"
    property string section: "home"

    Component.onCompleted: Progress.refresh()
    onStatusChanged: if (status === PageStatus.Active) Progress.refresh()
    // First title of a library in the web's order (smoke scripts and the suite driver use it).
    function firstWork(kind, cb) {
        Api.request("GET", "/api/v1/catalog?kind=" + kind + "&available_only=true&limit=200&sort=title&order=asc", null, function (st, d) {
            if (st === 200 && d && d.items.length) cb(Library.order(d.items, "title", "asc")[0])
        })
    }
    function openFirst(kind) { firstWork(kind, open) }
    function loaderItem() { return loader.item }   // for the PLAYARR_STEPS smoke scripts
    function actionsFirst(kind) { firstWork(kind, actions) }
    // The web opens its actions panel on the first card of Home; the suite driver does the same.
    function actionsHome() { var h = loader.item; if (h && h.rails && h.rails.length && h.rails[0].items.length) actions(h.rails[0].items[0]) }
    function actions(work) { pageStack.push(Qt.resolvedUrl("ActionsPage.qml"), { work: work }) }
    function open(work) { pageStack.push(Qt.resolvedUrl("DetailPage.qml"), { work: work }) }

    Loader {
        id: loader
        anchors { top: parent.top; left: parent.left; right: parent.right; bottom: parent.bottom }
        source: page.section === "home" ? "HomeView.qml"
              : page.section === "search" ? "SearchView.qml"
              : page.section === "calendar" ? "CalendarView.qml"
              : page.section === "watchlist" ? "WatchlistView.qml"
              : page.section === "downloads" ? "DownloadsView.qml"
              : page.section === "playlists" ? "PlaylistsView.qml"
              : page.section === "settings" ? "SettingsView.qml"
              : "LibraryView.qml"
        onLoaded: {
            item.opened.connect(page.open)
            if (item.held) item.held.connect(page.actions)
            if (item.goHome) item.goHome.connect(function () { page.section = "home" })
            if (item.goTo) item.goTo.connect(function (s) { page.section = s })
            if (item.kind !== undefined) item.kind = page.section === "movies" ? "movie" : page.section === "series" ? "series" : "artist"
            if (item.title !== undefined) item.title = page.section === "movies" ? qsTr("Movies") : page.section === "series" ? qsTr("Series") : qsTr("Music")
            if (item.reload) item.reload()
            page.navigation.resetForContent()
        }
    }
    // Same item for movies/series/music: reload when the kind changes.
    onSectionChanged: {
        if (loader.item && loader.item.kind !== undefined) {
            loader.item.kind = section === "movies" ? "movie" : section === "series" ? "series" : "artist"
            loader.item.title = section === "movies" ? qsTr("Movies") : section === "series" ? qsTr("Series") : qsTr("Music")
            loader.item.reload()
            page.navigation.resetForContent()
        } else {
            page.navigation.moved = false
            page.navigation.focusRequested = false
        }
    }

    NavBar {
        blurSource: loader
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: 10 * Tokens.u; rightMargin: 10 * Tokens.u; bottomMargin: 7 * Tokens.u }
        section: page.section
        onSelected: page.section = target
        onProfileClicked: pageStack.push(Qt.resolvedUrl("ProfilesPage.qml"))
    }
}
