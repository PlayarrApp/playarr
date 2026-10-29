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
    Accessible.name: glyph + " " + label.text
    width: parent ? parent.width - 40 * Tokens.u : 0
    x: 20 * Tokens.u
    height: 68 * Tokens.u
    Rectangle {
        anchors.fill: parent
        radius: 14 * Tokens.u
        color: Tokens.surfaceSoft
        opacity: root.pressed ? 0.6 : 1
    }
    Rectangle {   // key focus: the 2 px ring, 3 css px off the row (ink in light, white in dark); the static touch refs show none at rest
        visible: root.navigationActive && root.activeFocus
        anchors { fill: parent; margins: -4 * Tokens.u }
        radius: 14 * Tokens.u + 4 * Tokens.u; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.dark ? "#ffffff" : Tokens.ink
    }
    // The web icon slot: the glyph starts 18 css px in, at 19.52 px, in a system font (Nunito has none of these symbols).
    PLabel { renderType: Text.NativeRendering; id: g; x: 18 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; text: root.glyph === "+" ? "\uFF0B" : root.glyph; color: Tokens.brandPink; font.family: root.glyph === "\u25CB" ? Tokens.family400 + ",Liberation Sans" : Tokens.family400; font.pixelSize: Tokens.fs(19.52) }
    FitText { id: label; anchors { left: parent.left; leftMargin: 60 * Tokens.u; right: parent.right; verticalCenter: parent.verticalCenter }
            elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.fam(700); font.letterSpacing: -0.3; font.pixelSize: Tokens.fs(16) }
}
