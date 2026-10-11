import QtQuick 2.6
import Sailfish.Silica 1.0

// A titled horizontal rail of WorkCards.
Column {
    id: root
    property string title
    property var items: []
    signal opened(var work)
    width: parent ? parent.width : 0
    spacing: 14 * Tokens.u
    visible: items.length > 0

    Label {
        x: Tokens.pad
        text: root.title
        color: Tokens.ink
        font.family: Tokens.family
        font.pixelSize: 22 * Tokens.u
    }
    ListView {
        width: parent.width
        height: 173 * Tokens.u * 9 / 16 + 50 * Tokens.u
        orientation: ListView.Horizontal
        spacing: 14 * Tokens.u
        leftMargin: Tokens.pad
        rightMargin: Tokens.pad
        clip: true
        model: root.items
        delegate: WorkCard {
            work: modelData
            onOpened: root.opened(work)
        }
    }
}
