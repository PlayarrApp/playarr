import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Library "List" view row: small artwork, title and "Kind · Year".
MouseArea {
    id: root
    property var work
    property bool navigationFocusable: true
    property bool navigationInitialFocus: false
    property int parityRail: -1
    property int parityIndex: -1
    signal opened(var work)
    signal held(var work)
    height: 76 * Tokens.u
    onClicked: opened(work)
    onPressAndHold: held(work)
    function navigationActivate() { opened(work) }
    function navigationLongPress() { held(work) }
    Artwork {
        id: art
        work: root.work
        x: Tokens.pad
        anchors.verticalCenter: parent.verticalCenter
        width: 96 * Tokens.u
        height: 54 * Tokens.u
        radius: 8 * Tokens.u
        opacity: root.pressed ? 0.7 : 1
    }
    Column {
        anchors { left: art.right; leftMargin: 14 * Tokens.u; right: parent.right; rightMargin: Tokens.pad; verticalCenter: parent.verticalCenter }
        Label { renderType: Text.NativeRendering; width: parent.width; text: work ? work.title : ""; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 16 * Tokens.u }
        Label { renderType: Text.NativeRendering;
            width: parent.width
            text: work ? (work.kind === "movie" ? qsTr("Movie") : work.kind === "series" ? qsTr("Series") : qsTr("Artist")) + (work.release_date ? " \u00B7 " + work.release_date.substr(0, 4) : "") : ""
            elide: Text.ElideRight; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u
        }
    }
}
