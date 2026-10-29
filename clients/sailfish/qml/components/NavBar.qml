import QtQuick 2.6
import "."
import "NavIcons.js" as NavIcons
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0

// Web mobile's floating pill navigation: profile avatar, then downloads, search, home, series, movies, music, playlists.
Rectangle {
    id: root
    property string section: "home"
    signal selected(string target)
    signal profileClicked()
    readonly property var tabs: ["downloads", "search", "home", "series", "movies", "music", "playlists"]
    height: 58 * Tokens.u
    radius: 20 * Tokens.u
    color: Qt.rgba(Tokens.surfaceStrong.r, Tokens.surfaceStrong.g, Tokens.surfaceStrong.b, 0.88)
    border.width: 0

    RectangularGlow {   // web: box-shadow 0 14px 40px rgba(31, 14, 20, .2)
        x: 0; y: 14 * Tokens.u; width: parent.width; height: parent.height
        z: -2; glowRadius: 20 * Tokens.u; spread: 0; cornerRadius: root.radius + glowRadius
        color: Qt.rgba(31 / 255, 14 / 255, 20 / 255, Tokens.dark ? 0.2 : 0.2)
    }
    Row {
        x: 5 * Tokens.u   // web: 44 x 46 links on a 46 px pitch, the row starts a little in and runs past the bar's right edge
        y: 6 * Tokens.u; height: 46 * Tokens.u; width: 8 * 46 * Tokens.u
        spacing: 2 * Tokens.u
        MouseArea {
            objectName: "parity-nav-profile"
            property bool navigationFocusable: true
            property int parityRail: 0
            property int parityIndex: 0
            function navigationActivate() { root.profileClicked() }
            width: 44 * Tokens.u
            height: 46 * Tokens.u
            property string a11yName: qsTr("Signed in as %1. Open profiles.").arg(Api.profileName)
            property string parityRole: "link"
            onClicked: root.profileClicked()
            Rectangle { anchors.fill: parent; radius: 14 * Tokens.u; color: root.color }
            Avatar { plateColor: root.color; anchors.centerIn: parent; anchors.verticalCenterOffset: -4 * Tokens.u; width: 21 * Tokens.u;   // web seats the avatar higher than the icons
                     source: Api.profileAvatar }
        }
        Repeater {
            model: root.tabs
            MouseArea {
                objectName: "parity-nav-" + modelData
                property bool navigationFocusable: true
                property int parityRail: 0
                property int parityIndex: index + 1
                function navigationActivate() { root.selected(modelData) }
                width: 44 * Tokens.u
                height: 46 * Tokens.u
                property string parityRole: "link"
                property string a11yName: modelData === "downloads" ? qsTr("Downloads") : modelData === "search" ? qsTr("Search") : modelData === "home" ? qsTr("Home") : modelData === "series" ? qsTr("Series") : modelData === "movies" ? qsTr("Movies") : modelData === "music" ? qsTr("Music") : qsTr("Playlists")
                onClicked: root.selected(modelData)
                Rectangle {   // the link's own plate: the bar's colour at rest, the ink when selected
                    anchors.fill: parent
                    radius: 14 * Tokens.u
                    color: root.section === modelData ? Tokens.primary : root.color
                }
                Image {
                    anchors.centerIn: parent
                    width: 21 * Tokens.u; height: width
                    sourceSize: Qt.size(48, 48)
                    smooth: true
                    // the idle icons of the dark bar are the ink at 72 % over the bar, drawn as one colour
                    source: NavIcons.url(modelData, root.section === modelData ? Tokens.primaryInk : (Tokens.dark ? Qt.rgba(Tokens.ink.r * 0.72 + Tokens.surfaceStrong.r * 0.28, Tokens.ink.g * 0.72 + Tokens.surfaceStrong.g * 0.28, Tokens.ink.b * 0.72 + Tokens.surfaceStrong.b * 0.28, 1) : Tokens.inkSoft))
                }
            }
        }
    }
}
