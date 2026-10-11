import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Web's rounded action button; `primary` is the filled "Play" style.
MouseArea {
    id: root
    property alias text: label.text
    property bool primary: false
    property real fontSize: 15 * Tokens.u
    // Web detail buttons: a small accent icon, a gap, then the label, centred and sized to their content.
    property string icon: ""
    property real iconSize: fontSize
    property string labelFamily: Tokens.family
    property bool natural: icon !== ""
    readonly property real naturalWidth: Math.ceil(iconLbl.implicitWidth + 9 * Tokens.u + tm.implicitWidth) + 32 * Tokens.u
    implicitHeight: 40 * Tokens.u
    implicitWidth: natural ? naturalWidth : label.implicitWidth + 40 * Tokens.u
    Rectangle {
        anchors.fill: parent
        radius: height / 2
        color: root.primary ? Tokens.primary : Tokens.surfaceStrong
        border.width: root.primary ? 0 : 1
        border.color: Tokens.line
        opacity: root.pressed ? 0.7 : 1
    }
    Label { id: tm; visible: false; text: label.text; font.family: root.labelFamily; font.pixelSize: root.fontSize; }
    Row {
        id: content
        visible: root.icon !== ""
        anchors.centerIn: parent
        spacing: 9 * Tokens.u
        Label {
            id: iconLbl
            anchors.verticalCenter: parent.verticalCenter
            text: root.icon
            color: root.primary ? Tokens.primaryInk : Tokens.brandPinkSoft
            font.pixelSize: root.iconSize
        }
        Label {
            id: label2
            anchors.verticalCenter: parent.verticalCenter
            width: Math.min(Math.ceil(tm.implicitWidth) + 1, root.width - 32 * Tokens.u - iconLbl.implicitWidth - 9 * Tokens.u)
            text: label.text
            wrapMode: Text.Wrap
            maximumLineCount: 2
            font.family: root.labelFamily
            font.pixelSize: root.fontSize
            color: root.primary ? Tokens.primaryInk : Tokens.ink
        }
    }
    Label {
        id: label
        visible: root.icon === ""
        anchors.centerIn: parent
        font.family: root.labelFamily
        font.pixelSize: root.fontSize
        width: parent.width - 16 * Tokens.u
        wrapMode: Text.Wrap
        maximumLineCount: 2
        horizontalAlignment: Text.AlignHCenter
        font.weight: Font.DemiBold
        color: root.primary ? Tokens.primaryInk : Tokens.ink
    }
}
