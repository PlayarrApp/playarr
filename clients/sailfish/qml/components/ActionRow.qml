import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Title-actions row: coloured glyph and label on a soft card.
MouseArea {
    id: root
    property bool navigationFocusable: true
    property bool navigationInitialFocus: false
    property bool navigationActive: !!(pageStack.currentPage && pageStack.currentPage.navigation && pageStack.currentPage.navigation.keyboardNavigationActive)
    property var navigationActivate: null
    property int parityIndex: -1
    property string glyph
    property alias text: label.text
    property bool primary: false
    width: parent ? parent.width - 2 * Tokens.pad : 0
    x: Tokens.pad
    height: 68.5 * Tokens.u
    Rectangle {
        anchors.fill: parent
        radius: 14 * Tokens.u
        color: Tokens.dark ? Tokens.surfaceStrong : Tokens.surfaceSoft
        opacity: root.pressed ? 0.6 : 1
    }
    Rectangle {   // web default focus: the first row holds the 2 px ring, 3 css px off the row (ink in light, white in dark)
        visible: root.navigationActive ? root.activeFocus : root.primary
        anchors { fill: parent; margins: -4 * Tokens.u }
        radius: 14 * Tokens.u + 4 * Tokens.u; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.dark ? "#ffffff" : Tokens.ink
    }
    Label { id: g; x: 18 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; text: root.glyph; color: Tokens.brandPink; font.pixelSize: 20 * Tokens.u; width: 28 * Tokens.u }
    Label { id: label; anchors { left: g.right; leftMargin: 14 * Tokens.u; right: parent.right; verticalCenter: parent.verticalCenter }
            elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 16.5 * Tokens.u }
}
