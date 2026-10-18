import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// One selectable row of a sheet (check mark column + text).
MouseArea {
    property bool navigationFocusable: true
    property bool navigationInitialFocus: false
    property int parityRail: -1
    property int parityIndex: -1
    property var navigationActivate: null
    property string text
    property bool selected: false
    width: parent ? parent.width : 0
    height: 44 * Tokens.u
    Label {
        id: check
        width: 28 * Tokens.u
        anchors.verticalCenter: parent.verticalCenter
        text: parent.selected ? "✓" : ""
        color: Tokens.brandPinkSoft
        font.pixelSize: 16 * Tokens.u
    }
    Label {
        anchors { left: check.right; right: parent.right; verticalCenter: parent.verticalCenter }
        text: parent.text
        elide: Text.ElideRight
        color: Tokens.ink
        font.family: Tokens.family
        font.pixelSize: 16 * Tokens.u
    }
}
