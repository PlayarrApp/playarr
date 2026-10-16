import QtQuick 2.6
import "."
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0

// Web's rounded action button; `primary` is the filled "Play" style.
MouseArea {
    id: root
    property bool navigationFocusable: true
    property bool navigationInitialFocus: false
    property bool navigationActive: !!(pageStack.currentPage && pageStack.currentPage.navigation && pageStack.currentPage.navigation.keyboardNavigationActive)
    property int parityRail: -1
    property int parityIndex: -1
    property var navigationActivate: null
    property alias text: label.text
    property bool primary: false
    property color fill: "transparent"   // a solid fill other than the primary one (transparent = the standard look)
    property color fillInk: Tokens.ink
    property bool outlineOnly: false
    property real fontSize: 15 * Tokens.u
    // Web detail buttons: a small accent icon, a gap, then the label, centred and sized to their content.
    property string icon: ""
    property real iconSize: fontSize
    property string labelFamily: Tokens.family
    property bool restRing: false   // web draws the focus ring on the first focusable control at rest (calendar Today)
    property bool lift: false   // web detail actions: box-shadow 0 14px 38px rgba(56,38,33,.12)
    property bool natural: icon !== ""
    readonly property real naturalWidth: Math.ceil(iconLbl.implicitWidth + 9 * Tokens.u + tm.implicitWidth) + 32 * Tokens.u
    implicitHeight: 40 * Tokens.u
    implicitWidth: natural ? naturalWidth : label.implicitWidth + 40 * Tokens.u
    RectangularGlow {
        visible: root.lift
        y: 14 * Tokens.u; width: parent.width; height: parent.height
        glowRadius: 19 * Tokens.u; spread: 0.05; cornerRadius: height / 2 + glowRadius   // blur 38 px is a 19 px radius
        color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.12)
    }
    Rectangle {
        anchors.fill: parent
        radius: height / 2
        color: root.outlineOnly ? Tokens.surface : root.fill.a > 0 ? root.fill : root.primary ? Tokens.primary : Tokens.surfaceStrong
        border.width: root.primary || (root.fill.a > 0 && !root.outlineOnly) ? 0 : 1
        border.color: root.outlineOnly ? Qt.rgba(Tokens.lineStrong.r, Tokens.lineStrong.g, Tokens.lineStrong.b, Tokens.lineStrong.a * 0.66) : Tokens.line
        opacity: root.pressed ? 0.7 : 1
    }
    Rectangle {
        visible: root.navigationActive ? root.activeFocus : root.restRing
        anchors { fill: parent; margins: -4 * Tokens.u }
        radius: height / 2; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.primary
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
            color: root.fill.a > 0 ? root.fillInk : root.primary ? Tokens.primaryInk : Tokens.brandInk
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
            color: root.fill.a > 0 ? root.fillInk : root.primary ? Tokens.primaryInk : Tokens.ink
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
        color: root.fill.a > 0 ? root.fillInk : root.primary ? Tokens.primaryInk : Tokens.ink
    }
}
