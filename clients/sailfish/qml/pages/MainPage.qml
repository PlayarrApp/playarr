import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Signed-in shell: section views above the floating nav pill.
PlayarrPage {
    id: page
    property string section: "home"

    function open(work) { pageStack.push(Qt.resolvedUrl("DetailPage.qml"), { work: work }) }

    Loader {
        id: loader
        anchors { top: parent.top; left: parent.left; right: parent.right; bottom: parent.bottom }
        source: page.section === "home" ? "HomeView.qml"
              : page.section === "search" ? "SearchView.qml"
              : page.section === "calendar" ? "CalendarView.qml"
              : page.section === "watchlist" ? "WatchlistView.qml"
              : page.section === "downloads" ? "DownloadsView.qml"
              : "LibraryView.qml"
        onLoaded: {
            item.opened.connect(page.open)
            if (item.goHome) item.goHome.connect(function () { page.section = "home" })
            if (item.kind !== undefined) item.kind = page.section === "movies" ? "movie" : page.section === "series" ? "series" : "artist"
            if (item.title !== undefined) item.title = page.section === "movies" ? qsTr("Movies") : page.section === "series" ? qsTr("Series") : qsTr("Music")
        }
    }
    // Same item for movies/series/music: reload when the kind changes.
    onSectionChanged: if (loader.item && loader.item.kind !== undefined) {
        loader.item.kind = section === "movies" ? "movie" : section === "series" ? "series" : "artist"
        loader.item.title = section === "movies" ? qsTr("Movies") : section === "series" ? qsTr("Series") : qsTr("Music")
        loader.item.reload()
    }

    NavBar {
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: Tokens.pad }
        section: page.section
        onSelected: page.section = target
        onProfileClicked: pageStack.push(Qt.resolvedUrl("ProfilesPage.qml"))
    }
}
