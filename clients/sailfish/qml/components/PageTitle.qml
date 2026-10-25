import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Web mobile page header: round back button and the page title.
Item {
    property alias title: label.text
    property bool back: true
    property string backLabel: qsTr("Back to Home")
    property string backRole: "link"
    property bool restRing: false   // web focuses the back button at rest on Settings
    property bool navigationActive: !!(pageStack.currentPage && pageStack.currentPage.navigation && pageStack.currentPage.navigation.keyboardNavigationActive)
    signal backClicked()
    width: parent ? parent.width : 0
    height: 66 * Tokens.u

    MouseArea {
        id: btn
        objectName: "parity-page-back"
        property bool navigationFocusable: true
        function navigationActivate() { parent.backClicked() }
        visible: parent.back
        property string a11yName: parent.backLabel
        property string parityRole: parent.backRole
        property real focusRadius: width / 2
        x: Tokens.pad
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: 1 * Tokens.u
        width: 44 * Tokens.u; height: width
        onClicked: parent.backClicked()
        // web .tv-page-back: surface-strong at 70 %, a 1 px border of line-strong at 66 %
        Rectangle {
            anchors.fill: parent; radius: width / 2; opacity: btn.pressed ? 0.5 : 1
            color: Qt.rgba(Tokens.surfaceStrong.r, Tokens.surfaceStrong.g, Tokens.surfaceStrong.b, 0.7)
            border.width: 1; border.color: Qt.rgba(Tokens.lineStrong.r, Tokens.lineStrong.g, Tokens.lineStrong.b, Tokens.lineStrong.a * 0.66)
        }
        Rectangle { visible: btn.parent.navigationActive ? btn.activeFocus : btn.parent.restRing; anchors { fill: parent; margins: -4.75 * Tokens.u } radius: width / 2; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.primary }
        PLabel { renderType: Text.NativeRendering   // the web's arrow is a system-font glyph (Nunito has none)
            anchors.centerIn: parent
            text: "\u2190"; color: Tokens.dark ? "#cdc1c6" : "#443a40"
            anchors.verticalCenterOffset: -2.2 * Tokens.u
            font.family: "Liberation Sans"; font.weight: Font.Bold; font.pixelSize: Tokens.fs(12.8)
        }
    }
    PLabel { renderType: Text.NativeRendering;
        id: label
        anchors { left: parent.back ? btn.right : parent.left; leftMargin: parent.back ? 10 * Tokens.u : Tokens.pad; right: parent.right; verticalCenter: parent.verticalCenter }
        elide: Text.ElideRight
        color: Tokens.ink
        property string parityRole: "heading"
        font.family: Tokens.family580
        font.pixelSize: Tokens.fs(21.6)
        font.letterSpacing: -1.05 * Tokens.u
    }
}
