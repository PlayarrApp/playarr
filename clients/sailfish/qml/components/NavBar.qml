import QtQuick 2.6
import "."
import "NavIcons.js" as NavIcons
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0

// Web mobile's floating pill navigation: profile avatar, then downloads, search, home, series, movies, music, playlists.
Rectangle {
    id: root
    property string section: "home"
    property Item blurSource: null   // the page content under the bar; the web blurs it behind the pill (backdrop-filter)
    signal selected(string target)
    signal profileClicked()
    readonly property var tabs: ["downloads", "search", "home", "series", "movies", "music", "playlists"]
    height: 57.9 * Tokens.u
    radius: 20 * Tokens.u
    color: Qt.rgba(Tokens.surfaceStrong.r, Tokens.surfaceStrong.g, Tokens.surfaceStrong.b, 0.88)
    border.width: 1
    border.color: Tokens.line

    RectangularGlow {   // web: box-shadow 0 14px 40px rgba(31, 14, 20, .2)
        anchors.fill: parent; anchors.topMargin: 14 * Tokens.u
        z: -2; glowRadius: 20 * Tokens.u; spread: 0; cornerRadius: root.radius + glowRadius
        color: Qt.rgba(31 / 255, 14 / 255, 20 / 255, Tokens.dark ? 0.2 : 0.2)
    }
    ShaderEffectSource {
        id: snap
        visible: false
        sourceItem: root.blurSource
        sourceRect: root.blurSource ? Qt.rect(root.blurSource.mapFromItem(root, 0, 0).x, root.blurSource.mapFromItem(root, 0, 0).y, root.width, root.height) : Qt.rect(0, 0, 0, 0)
    }
    FastBlur { id: blurred; visible: false; anchors.fill: parent; source: snap; radius: 48 * Tokens.u / 2 }
    Rectangle { id: pill; anchors.fill: parent; radius: root.radius; visible: false }
    OpacityMask { z: -1; anchors.fill: parent; source: blurred; maskSource: pill; visible: root.blurSource !== null }
    Row {
        x: 4.4 * Tokens.u   // web: 46.1 css px cells, the row starts a little in and runs past the bar's right edge
        y: 6 * Tokens.u; height: parent.height - 12 * Tokens.u; width: 8 * 46.1 * Tokens.u
        MouseArea {
            width: 46.1 * Tokens.u
            height: parent.height
            onClicked: root.profileClicked()
            Avatar { anchors.centerIn: parent; width: 21 * Tokens.u; source: Api.profileAvatar }
        }
        Repeater {
            model: root.tabs
            MouseArea {
                width: 46.1 * Tokens.u
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
                    opacity: root.section === modelData || !Tokens.dark ? 1 : 0.72
                    source: NavIcons.url(modelData, root.section === modelData ? Tokens.primaryInk : (Tokens.dark ? Tokens.ink : Tokens.inkSoft))
                }
            }
        }
    }
}
