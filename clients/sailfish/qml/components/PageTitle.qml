import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Web mobile page header: round back button and the page title.
Item {
    property alias title: label.text
    property bool back: true
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
        x: Tokens.pad
        anchors.verticalCenter: parent.verticalCenter
        anchors.verticalCenterOffset: 1 * Tokens.u
        width: 43.7 * Tokens.u; height: width
        onClicked: parent.backClicked()
        // web .tv-page-back: surface-strong at 70 %, a 1 px border of line-strong at 66 %
        Rectangle {
            anchors.fill: parent; radius: width / 2; opacity: btn.pressed ? 0.5 : 1
            color: Qt.rgba(Tokens.surfaceStrong.r, Tokens.surfaceStrong.g, Tokens.surfaceStrong.b, 0.7)
            border.width: 1; border.color: Qt.rgba(Tokens.lineStrong.r, Tokens.lineStrong.g, Tokens.lineStrong.b, Tokens.lineStrong.a * 0.66)
        }
        Rectangle { visible: btn.parent.navigationActive ? btn.activeFocus : btn.parent.restRing; anchors { fill: parent; margins: -4.75 * Tokens.u } radius: width / 2; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.primary }
        Canvas {   // web: the thin system arrow, 14 x 6 px with a small head (Nunito has no arrow glyph)
            width: 16; height: 10   // device pixels
            anchors.centerIn: parent; anchors.verticalCenterOffset: 2
            property color ink: Tokens.inkSoft
            onInkChanged: requestPaint()
            onPaint: {
                var c = getContext("2d"); c.clearRect(0, 0, width, height)
                c.strokeStyle = ink; c.lineWidth = 1.1; c.lineCap = "round"; c.lineJoin = "round"
                c.beginPath(); c.moveTo(14.5, 5); c.lineTo(1.5, 5); c.moveTo(5, 2); c.lineTo(1.5, 5); c.lineTo(5, 8); c.stroke()
            }
        }
    }
    Label { renderType: Text.NativeRendering;
        id: label
        anchors { left: parent.back ? btn.right : parent.left; leftMargin: parent.back ? 10 * Tokens.u : Tokens.pad; right: parent.right; verticalCenter: parent.verticalCenter }
        elide: Text.ElideRight
        color: Tokens.ink
        font.family: Tokens.family610
        font.pixelSize: 19.6 * Tokens.u
        font.letterSpacing: -0.3
    }
}
