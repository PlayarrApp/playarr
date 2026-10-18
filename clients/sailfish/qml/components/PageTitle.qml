import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Web mobile page header: round back button and the page title.
Item {
    property alias title: label.text
    property bool back: true
    property bool filled: false   // detail pages: web fills the round button instead of outlining it
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
        Rectangle { anchors.fill: parent; radius: width / 2; color: parent.parent.filled ? Tokens.surfaceSoft : "transparent"; border.width: parent.parent.filled ? 0 : 1; border.color: Tokens.lineStrong; opacity: btn.pressed ? 0.5 : 1 }
        Rectangle { visible: btn.parent.navigationActive ? btn.activeFocus : btn.parent.restRing; anchors { fill: parent; margins: -4.75 * Tokens.u } radius: width / 2; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.primary }
        Label { renderType: Text.NativeRendering; anchors.centerIn: parent; text: "←"; color: Tokens.ink; font.pixelSize: 13 * Tokens.u }
    }
    Label { renderType: Text.NativeRendering;
        id: label
        anchors { left: parent.back ? btn.right : parent.left; leftMargin: parent.back ? 10 * Tokens.u : Tokens.pad; right: parent.right; verticalCenter: parent.verticalCenter }
        elide: Text.ElideRight
        color: Tokens.ink
        font.family: Tokens.family580
        font.pixelSize: 19.6 * Tokens.u
    }
}
