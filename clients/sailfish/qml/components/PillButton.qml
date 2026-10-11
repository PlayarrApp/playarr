import QtQuick 2.6
import Sailfish.Silica 1.0

// Web's rounded action button; `primary` is the filled "Play" style.
MouseArea {
    id: root
    property alias text: label.text
    property bool primary: false
    implicitHeight: 40 * Tokens.u
    implicitWidth: label.implicitWidth + 40 * Tokens.u
    Rectangle {
        anchors.fill: parent
        radius: height / 2
        color: root.primary ? Tokens.primary : Tokens.surfaceStrong
        border.width: root.primary ? 0 : 1
        border.color: Tokens.line
        opacity: root.pressed ? 0.7 : 1
    }
    Label {
        id: label
        anchors.centerIn: parent
        font.family: Tokens.family
        font.pixelSize: 15 * Tokens.u
        font.weight: Font.DemiBold
        color: root.primary ? Tokens.onPrimary : Tokens.ink
    }
}
