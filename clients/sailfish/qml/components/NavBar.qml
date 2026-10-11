import QtQuick 2.6
import "."
import "NavIcons.js" as NavIcons
import Sailfish.Silica 1.0

// Web mobile's floating pill navigation: profile avatar, then downloads, search, home, series, movies, music, playlists.
Rectangle {
    id: root
    property string section: "home"
    signal selected(string target)
    signal profileClicked()
    readonly property var tabs: ["downloads", "search", "home", "series", "movies", "music", "playlists"]
    height: 53.5 * Tokens.u
    radius: 20 * Tokens.u
    color: Qt.rgba(Tokens.surfaceStrong.r, Tokens.surfaceStrong.g, Tokens.surfaceStrong.b, 0.86)
    border.width: 1
    border.color: Tokens.line

    Row {
        anchors.fill: parent
        anchors.margins: 6 * Tokens.u
        MouseArea {
            width: parent.width / (root.tabs.length + 1)
            height: parent.height
            onClicked: root.profileClicked()
            Avatar { anchors.centerIn: parent; width: 21 * Tokens.u; source: Api.profileAvatar }
        }
        Repeater {
            model: root.tabs
            MouseArea {
                width: parent.width / (root.tabs.length + 1)
                height: parent.height
                onClicked: root.selected(modelData)
                Rectangle {
                    anchors.centerIn: parent
                    width: 43.7 * Tokens.u; height: 45.7 * Tokens.u
                    radius: 12 * Tokens.u
                    color: Tokens.primary
                    visible: root.section === modelData
                }
                Image {
                    anchors.centerIn: parent
                    width: 18.4 * Tokens.u; height: width
                    sourceSize: Qt.size(48, 48)
                    smooth: true
                    opacity: root.section === modelData ? 1 : 0.72
                    source: NavIcons.url(modelData, root.section === modelData ? Tokens.onPrimary : Tokens.ink)
                }
            }
        }
    }
}
