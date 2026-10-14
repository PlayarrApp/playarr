import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// A titled horizontal rail of WorkCards.
Column {
    id: root
    property string title
    property var items: []
    property bool showUnwatched: true
    signal opened(var work)
    signal held(var work)
    width: parent ? parent.width : 0
    spacing: Math.round(19.5 * Tokens.u)
    visible: items.length > 0

    Label {
        x: Tokens.pad
        text: root.title
        color: Tokens.ink
        font.family: Tokens.family580
        font.pixelSize: 15.2 * Tokens.u
    }
    Item {
        width: parent.width
        height: Math.round(173 * Tokens.u * 9 / 16 + 50 * Tokens.u)
        ListView {
            id: list
            anchors.fill: parent
            orientation: ListView.Horizontal
            spacing: Tokens.px(12)
            leftMargin: Tokens.pad
            rightMargin: Tokens.pad
            clip: true
            model: root.items
            delegate: WorkCard {
                work: modelData
                showUnwatched: root.showUnwatched
                onOpened: root.opened(work)
                onHeld: root.held(work)
            }
        }
        EdgeFade { target: list; horizontal: true }
    }
}
