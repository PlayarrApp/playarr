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

    property string mode: "screen"          // screen (landscape cards), cover (posters), list (rows)
    readonly property real gap: 14 * Tokens.u
    readonly property int columns: mode === "cover" ? 3 : mode === "list" ? 1 : 2
    cellWidth: width / columns
    readonly property real cardW: cellWidth - Tokens.pad - gap / 2
    cellHeight: mode === "list" ? 76 * Tokens.u
              : mode === "cover" ? cardW * 3 / 2 + 62 * Tokens.u
              : cardW * 9 / 16 + 70 * Tokens.u
    model: works
    clip: true
    delegate: Item {
        width: root.cellWidth
        height: root.cellHeight
        Loader {
            x: root.columns === 1 ? 0 : (index % root.columns === 0 ? Tokens.pad : root.gap / 2)
            sourceComponent: root.mode === "list" ? rowComp : cardComp
        }
        Component {
            id: cardComp
            WorkCard {
                work: modelData
                poster: root.mode === "cover"
                cardWidth: root.cardW
                onOpened: root.opened(work)
                onHeld: root.held(work)
            }
        }
        Component {
            id: rowComp
            WorkRow {
                work: modelData
                width: root.cellWidth
                onOpened: root.opened(work)
                onHeld: root.held(work)
            }
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
