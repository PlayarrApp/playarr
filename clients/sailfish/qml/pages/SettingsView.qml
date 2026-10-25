import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Preferences: the web's numbered settings list; each row opens its section.
Item {
    id: page
    objectName: "settings"
    signal goTo(string section)
    signal goHome()
    signal opened(var work)
    readonly property var rows: [
        { id: "appearance", title: qsTr("Appearance"), hint: qsTr("Choose this device's theme and home screen artwork.") },
        { id: "avatar", title: qsTr("Profile avatar"), hint: qsTr("Choose how your profile appears on this device.") },
        { id: "language", title: qsTr("Language"), hint: qsTr("Follow this device or keep a language fixed.") },
        { id: "player", title: qsTr("Player"), hint: qsTr("Choose how Playarr should start quality, subtitles and audio.") },
        { id: "server", title: qsTr("Server connection"), hint: qsTr("Combine libraries from multiple servers in one Playarr interface.") },
        { id: "lock", title: qsTr("Profile lock"), hint: qsTr("Require a four-digit PIN before switching profiles.") },
        { id: "calendar", title: qsTr("Calendar"), hint: qsTr("Upcoming releases from your libraries.") },
        { id: "watchlist", title: qsTr("Watchlist"), hint: qsTr("Titles you want to watch, on every device.") },
        { id: "requests", title: qsTr("Requests"), hint: qsTr("Titles you asked for and their progress.") }
    ]
    function open(id) {
        if (id === "calendar" || id === "watchlist") goTo(id)
        else if (id === "requests") pageStack.push(Qt.resolvedUrl("RequestsPage.qml"))
        else pageStack.push(Qt.resolvedUrl("SettingsSubPage.qml"), { section: id })
    }

    PageTitle { id: head; y: 4 * Tokens.u; backLabel: qsTr("Settings"); backRole: "button"; title: qsTr("Preferences"); onBackClicked: page.goHome() }
    SilicaListView {
        id: list
        anchors { top: head.bottom; topMargin: 14 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        model: page.rows
        clip: true
        bottomMargin: 100 * Tokens.u
        delegate: Item {
            width: list.width
            height: 88 * Tokens.u
            MouseArea {
                id: row
                x: Tokens.pad; width: parent.width - 2 * Tokens.pad; height: parent.height
                property bool navigationFocusable: true
                property string parityLabel: modelData.title
                property string a11yName: numLbl.text + " " + titleLbl.text + " " + hintLbl.text + " " + arrowLbl.text
                property string parityRole: "link"
                property bool navigationInitialFocus: index === 0
                property int parityRail: 0
                property int parityIndex: index
                onClicked: page.open(modelData.id)
                function navigationActivate() { page.open(modelData.id) }
                Rectangle { anchors.fill: parent; color: Tokens.dark ? (index === 0 ? "#312a30" : Tokens.surfaceStrong) : Tokens.surfaceSoft; opacity: index === 0 ? 1 : (row.pressed ? 0.5 : 0) }
                PLabel { id: numLbl; x: 12 * Tokens.u; y: 16 * Tokens.u; text: (index + 1 < 10 ? "0" : "") + (index + 1); color: Tokens.ink; font.family: Tokens.fam(760); font.pixelSize: Tokens.fs(8.8); renderType: Text.NativeRendering }
                Column {
                    x: 56 * Tokens.u; y: 22.92 * Tokens.u; width: arrowLbl.x - x - 12 * Tokens.u
                    spacing: 2.39 * Tokens.u
                    PLabel { id: titleLbl; width: parent.width; height: 22 * Tokens.u; text: modelData.title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.fam(480); font.letterSpacing: -1.35; font.pixelSize: Tokens.fs(16); renderType: Text.NativeRendering }
                    PLabel { id: hintLbl; width: parent.width; height: 15 * Tokens.u; text: modelData.hint; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family400; font.letterSpacing: 0.2; font.pixelSize: Tokens.fs(10.88); renderType: Text.NativeRendering }
                }
                // The web's arrow is a system-font glyph; the active row's is ink and 5 px further right.
                PLabel { id: arrowLbl; renderType: Text.NativeRendering
                    x: (index === 0 ? 330.2 : 325.2) * Tokens.u; y: 29.41 * Tokens.u
                    text: "\u2192"; color: index === 0 ? Tokens.ink : Tokens.inkSoft
                    font.family: "Liberation Sans"; font.weight: Font.Normal; font.pixelSize: Tokens.fs(20.8) }
            }
        }
        EdgeFade { target: list }
        VerticalScrollDecorator {}
    }
}
