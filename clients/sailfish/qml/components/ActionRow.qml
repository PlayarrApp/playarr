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
    Rectangle {   // key focus: the 2 px ring, 3 css px off the row (ink in light, white in dark); the static touch refs show none at rest
        visible: root.navigationActive && root.activeFocus
        anchors { fill: parent; margins: -4 * Tokens.u }
        radius: 14 * Tokens.u + 4 * Tokens.u; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.dark ? "#ffffff" : Tokens.ink
    }
    // Glyphs are centred in a 28 px box (web icon slot); the plus is drawn larger and the ring smaller than the font's own sizes, as the refs measure.
    Label { renderType: Text.NativeRendering; id: g; x: 16.5 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; horizontalAlignment: Text.AlignHCenter; text: root.glyph; color: Tokens.brandPink; font.family: Tokens.family; font.weight: Font.DemiBold; font.pixelSize: (root.glyph === "+" ? 29 : root.glyph === "\u25CB" ? 11 : 20) * Tokens.u; width: 28 * Tokens.u }
    Label { renderType: Text.NativeRendering; id: label; anchors { left: parent.left; leftMargin: 64 * Tokens.u; right: parent.right; verticalCenter: parent.verticalCenter }
            elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: Tokens.fs(16.5) }
}
