import QtQuick 2.6
import Sailfish.Silica 1.0

// Web mobile's floating pill navigation: profile avatar, then the section tabs.
Rectangle {
    id: root
    property string section: "home"
    signal selected(string target)
    signal profileClicked()
    readonly property var tabs: [
        { id: "search", icon: "icon-m-search" },
        { id: "home", icon: "icon-m-home" },
        { id: "movies", icon: "icon-m-video" },
        { id: "series", icon: "icon-m-media-albums" },
        { id: "music", icon: "icon-m-music" }
    ]
    height: 58 * Tokens.u
    radius: height / 2
    color: Tokens.surfaceStrong
    border.width: 1
    border.color: Tokens.line

    Row {
        anchors.fill: parent
        anchors.margins: 6 * Tokens.u
        MouseArea {
            width: (root.width - 12 * Tokens.u) / (root.tabs.length + 1)
            height: parent.height
            onClicked: root.profileClicked()
            Avatar { anchors.centerIn: parent; width: 36 * Tokens.u; source: Api.profileAvatar }
        }
        Repeater {
            model: root.tabs
            MouseArea {
                width: (root.width - 12 * Tokens.u) / (root.tabs.length + 1)
                height: parent.height
                onClicked: root.selected(modelData.id)
                Rectangle {
                    anchors.fill: parent
                    radius: height / 2
                    color: Tokens.primary
                    visible: root.section === modelData.id
                }
                Icon {
                    anchors.centerIn: parent
                    source: "image://theme/" + modelData.icon
                    color: root.section === modelData.id ? Tokens.onPrimary : Tokens.ink
                    sourceSize: Qt.size(32 * Tokens.u, 32 * Tokens.u)
                }
            }
        }
    }
}
