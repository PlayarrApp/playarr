import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// A titled horizontal rail of WorkCards.
Column {
    id: root
    property string title
    property var items: []
    property bool showUnwatched: true
    property bool restRing: false
    property int parityRail: -1
    signal opened(var work)
    signal held(var work)
    width: parent ? parent.width : 0
    spacing: Math.round(19.5 * Tokens.u)
    visible: items.length > 0
    // The same card as the library grid (web #924): (viewport - 16 gutter - 52 rail pad - 12 gap) / 2.
    readonly property real cardW: Math.round((width - Tokens.px(16 + 52 + 12)) / 2)

    Label { renderType: Text.NativeRendering;
        x: Tokens.pad
        text: root.title
        color: Tokens.ink
        font.family: Tokens.family580
        font.pixelSize: 15.2 * Tokens.u
    }
    Item {
        width: parent.width
        height: Math.round(cardW * 9 / 16 + 0.2) + Math.round(51 * Tokens.u)
        ListView {
            id: list
            y: -24 * Tokens.u; width: parent.width; height: parent.height + 32 * Tokens.u   // room for the focus ring and its 20 px glow above the card, 8 px of shadow below, inside the clip
            orientation: ListView.Horizontal
            spacing: Tokens.px(12)
            leftMargin: Tokens.pad
            rightMargin: Tokens.pad
            clip: true
            model: root.items
            delegate: WorkCard {
                y: 24 * Tokens.u
                work: modelData
                cardWidth: root.cardW
                parityRail: root.parityRail
                parityIndex: index
                navigationActive: !!(pageStack.currentPage && pageStack.currentPage.navigation && pageStack.currentPage.navigation.keyboardNavigationActive)
                ring: activeFocus || (root.restRing && index === 0 && !(pageStack.currentPage && pageStack.currentPage.navigation && pageStack.currentPage.navigation.keyboardNavigationActive))
                showUnwatched: root.showUnwatched
                onOpened: root.opened(work)
                onHeld: root.held(work)
            }
        }
        EdgeFade { target: list; horizontal: true }
    }
}
