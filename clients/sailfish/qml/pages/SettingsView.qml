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
        { id: "appearance", title: qsTr("Appearance"), hint: qsTr("Choose this device's theme and home screen artwork") },
        { id: "avatar", title: qsTr("Profile avatar"), hint: qsTr("Choose how your profile appears on this device.") },
        { id: "language", title: qsTr("Language"), hint: qsTr("Follow this device or keep a language fixed.") },
        { id: "player", title: qsTr("Player"), hint: qsTr("Choose how Playarr should start quality, subtitles and audio") },
        { id: "server", title: qsTr("Server connection"), hint: qsTr("Combine libraries from multiple servers in one Playarr") },
        { id: "lock", title: qsTr("Profile lock"), hint: qsTr("Require a four-digit PIN before switching profiles.") },
        { id: "calendar", title: qsTr("Calendar"), hint: qsTr("Upcoming releases from your libraries") },
        { id: "watchlist", title: qsTr("Watchlist"), hint: qsTr("Titles you want to watch, on every device") },
        { id: "requests", title: qsTr("Requests"), hint: qsTr("Titles you asked for and their progress") }
    ]
    function open(id) {
        if (id === "calendar" || id === "watchlist") goTo(id)
        else if (id === "requests") pageStack.push(Qt.resolvedUrl("RequestsPage.qml"))
        else pageStack.push(Qt.resolvedUrl("SettingsSubPage.qml"), { section: id })
    }

    PageTitle { id: head; y: 4 * Tokens.u; restRing: true; title: qsTr("Preferences"); onBackClicked: page.goHome() }
    SilicaListView {
        id: list
        anchors { top: head.bottom; topMargin: 14 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        model: page.rows
        clip: true
        bottomMargin: 100 * Tokens.u
        delegate: MouseArea {
            property bool navigationFocusable: true
            property string parityLabel: modelData.title
            property bool navigationInitialFocus: index === 0
            property int parityRail: 0
            property int parityIndex: index
            width: list.width
            height: 87 * Tokens.u
            onClicked: page.open(modelData.id)
            function navigationActivate() { page.open(modelData.id) }
            Rectangle { anchors { fill: parent; leftMargin: Tokens.pad; rightMargin: Tokens.pad } color: Tokens.dark ? (index === 0 ? "#312a30" : Tokens.surfaceStrong) : Tokens.surfaceSoft; opacity: index === 0 ? 1 : (parent.pressed ? 0.5 : 0) }
            Label { x: 27.5 * Tokens.u; y: 18 * Tokens.u; text: (index + 1 < 10 ? "0" : "") + (index + 1); color: Tokens.inkMuted; font.family: Tokens.family820; font.pixelSize: 8 * Tokens.u; renderType: Text.NativeRendering }
            Column {
                anchors { left: parent.left; leftMargin: 71 * Tokens.u; right: arrow.left; rightMargin: 12 * Tokens.u; verticalCenter: parent.verticalCenter }
                spacing: 4 * Tokens.u
                Label { width: parent.width; text: modelData.title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family400; font.pixelSize: 16.5 * Tokens.u; renderType: Text.NativeRendering }
                Label { width: parent.width; text: modelData.hint; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 9.5 * Tokens.u; renderType: Text.NativeRendering }
            }
            // The web's "→" is a thin system-font glyph (Nunito has none): 25 px shaft, small head; the active row's arrow is ink and 10 px further right.
            Canvas {
                id: arrow
                width: 13 * Tokens.u; height: 7 * Tokens.u
                anchors { right: parent.right; rightMargin: (31.5 - (index === 0 ? 5 : 0)) * Tokens.u; verticalCenter: parent.verticalCenter; verticalCenterOffset: 2.8 * Tokens.u }
                property color ink: index === 0 ? Tokens.ink : Tokens.inkMuted
                onInkChanged: requestPaint()
                onPaint: {
                    var c = getContext("2d"), k = Tokens.u / 2; c.clearRect(0, 0, width, height); c.scale(k, k)
                    c.strokeStyle = ink; c.lineWidth = 2; c.lineCap = "round"; c.lineJoin = "round"
                    c.beginPath(); c.moveTo(1, 7); c.lineTo(24, 7); c.moveTo(19, 2.5); c.lineTo(24.5, 7); c.lineTo(19, 11.5); c.stroke()
                }
            }
        }
        EdgeFade { target: list }
        VerticalScrollDecorator {}
    }
}
