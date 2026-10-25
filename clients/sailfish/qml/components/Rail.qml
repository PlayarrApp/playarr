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
    property bool firstInk: false   // web: the first card of the first rail holds the default focus, its caption is pure black (white in dark)
    property int parityRail: -1
    signal opened(var work)
    signal held(var work)
    width: parent ? parent.width : 0
    spacing: Math.round(19.5 * Tokens.u)
    visible: items.length > 0
    // Static-seed web refs (2026-10-19): two cards and a peek, (viewport - 16 gutter - 16 gutter - 12 gap) / 2 = 170 px at 384.
    readonly property real cardW: Math.round((width - Tokens.px(16 + 16 + 12)) / 2)

    PLabel { renderType: Text.NativeRendering;
        x: Tokens.pad
        text: root.title
        color: Tokens.ink
        property string parityRole: "heading"
        font.family: Tokens.family580
        font.pixelSize: Tokens.fs(16); font.letterSpacing: -0.6 * Tokens.u; height: 21.33 * Tokens.u
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
                firstInk: root.firstInk && index === 0
                onOpened: root.opened(work)
                onHeld: root.held(work)
            }
        }
        EdgeFade { target: list; horizontal: true }
    }
}
