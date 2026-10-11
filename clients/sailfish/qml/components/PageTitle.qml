import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Web mobile page header: round back button and the page title.
Item {
    property alias title: label.text
    property bool back: true
    signal backClicked()
    width: parent ? parent.width : 0
    height: 72 * Tokens.u

    MouseArea {
        id: btn
        visible: parent.back
        x: Tokens.pad
        anchors.verticalCenter: parent.verticalCenter
        width: 44 * Tokens.u; height: width
        onClicked: parent.backClicked()
        Rectangle { anchors.fill: parent; radius: width / 2; color: "transparent"; border.width: 1; border.color: Tokens.lineStrong; opacity: btn.pressed ? 0.5 : 1 }
        Label { anchors.centerIn: parent; text: "←"; color: Tokens.ink; font.pixelSize: 18 * Tokens.u }
    }
    Label {
        id: label
        anchors { left: parent.back ? btn.right : parent.left; leftMargin: parent.back ? 12 * Tokens.u : Tokens.pad; right: parent.right; verticalCenter: parent.verticalCenter }
        elide: Text.ElideRight
        color: Tokens.ink
        font.family: Tokens.family
        font.pixelSize: 30 * Tokens.u
    }
}
