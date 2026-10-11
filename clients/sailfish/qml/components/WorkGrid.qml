import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Two-column grid of WorkCards with end-of-list paging (`loadMore` fires near the bottom).
SilicaGridView {
    id: root
    property var works: []
    property bool busy: false
    property bool done: false
    signal opened(var work)
    signal held(var work)
    signal loadMore()

    readonly property real gap: 14 * Tokens.u
    cellWidth: width / 2
    cellHeight: (cellWidth - Tokens.pad - gap / 2) * 9 / 16 + 70 * Tokens.u
    model: works
    clip: true
    delegate: Item {
        width: root.cellWidth
        height: root.cellHeight
        WorkCard {
            x: index % 2 === 0 ? Tokens.pad : root.gap / 2
            work: modelData
            cardWidth: root.cellWidth - Tokens.pad - root.gap / 2
            onOpened: root.opened(work)
            onHeld: root.held(work)
        }
    }
    onContentYChanged: if (!busy && !done && contentY + height > contentHeight - height) loadMore()
    BusyIndicator {
        anchors.horizontalCenter: parent.horizontalCenter
        y: parent.height - height - Theme.paddingLarge * 3
        size: BusyIndicatorSize.Medium
        running: root.busy
    }
    EdgeFade { target: root }
    VerticalScrollDecorator {}
}
