import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Title-actions row: coloured glyph and label on a soft card.
MouseArea {
    id: root
    property string glyph
    property alias text: label.text
    property bool primary: false
    width: parent ? parent.width - 2 * Tokens.pad : 0
    x: Tokens.pad
    height: 64 * Tokens.u
    Rectangle {
        anchors.fill: parent
        radius: 10 * Tokens.u
        color: Tokens.surfaceStrong
        border.width: root.primary ? 2 : 0
        border.color: Tokens.ink
        opacity: root.pressed ? 0.6 : 1
    }
    Label { id: g; x: 18 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; text: root.glyph; color: Tokens.brandPink; font.pixelSize: 20 * Tokens.u; width: 28 * Tokens.u }
    Label { id: label; anchors { left: g.right; leftMargin: 14 * Tokens.u; right: parent.right; verticalCenter: parent.verticalCenter }
            elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 18 * Tokens.u }
}
