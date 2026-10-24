import QtQuick 2.6
import "."
import "NavIcons.js" as NavIcons

// A round player control as the web draws it: a 44 px plate with a 20 px line icon (css px, scaled by Tokens.u).
MouseArea {
    id: root
    property string icon: ""            // NavIcons.js name; "" = a plate without a picture
    property string label
    property color plate: "#000000"
    property real iconCss: 20
    property bool dimmed: false         // a control with nothing to act on, drawn at 28 %
    property int radiusCss: 50          // the export's border-radius: 50 (a circle) or 999 (a pill)
    property bool navigationFocusable: true
    property int parityRail: 0
    property int parityIndex: -1
    property bool navigationInitialFocus: false
    property var navigationActivate: null
    property bool layoutSkip: true
    property var layoutEls: [ { role: "button", text: label, dx: 0, dy: 0, w: 44, h: 44, radius: radiusCss, bg: String(plate) } ]
    width: 44 * Tokens.u; height: width
    opacity: dimmed ? 0.28 : 1
    Rectangle { property bool layoutNoEmit: true; anchors.fill: parent; radius: width / 2; color: root.plate; border.width: 0 }
    Image {
        visible: root.icon !== ""
        anchors.centerIn: parent
        width: root.iconCss * Tokens.u; height: width; sourceSize: Qt.size(96, 96)
        source: root.icon !== "" ? NavIcons.url(root.icon, "#ffffff") : ""
    }
}
