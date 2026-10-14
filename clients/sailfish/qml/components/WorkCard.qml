import QtQuick 2.6
import "."
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0

// Home/library card: landscape artwork with title and "Kind · Year" caption underneath, as on web mobile.
MouseArea {
    id: root
    property var work
    property real cardWidth: Tokens.px(189) - Tokens.px(16)
    property bool poster: false
    property bool compact: false        // library grids: title only
    property bool showUnwatched: true
    property bool ring: false           // web focuses the first library card at rest and draws its ring
    readonly property var prog: work ? Progress.byWork[work.id] : undefined
    signal opened(var work)
    signal held(var work)
    width: cardWidth
    height: art.height + caption.height + (compact ? 12 : 8) * Tokens.u
    onClicked: opened(work)
    onPressAndHold: held(work)

    function kindLabel(k) {
        return k === "movie" ? qsTr("Movie") : k === "series" ? qsTr("Series") : k === "artist" ? qsTr("Artist") : k === "author" ? qsTr("Author") : ""
    }

    RectangularGlow {   // web: 0 10px 20px rgba(56,38,33,.14)
        visible: !Tokens.dark
        y: 10 * Tokens.u; width: art.width; height: art.height
        glowRadius: 10 * Tokens.u; spread: 0.1; cornerRadius: Tokens.radius + glowRadius
        color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.14)
    }
    RectangularGlow {   // web: 0 3px 8px rgba(56,38,33,.10)
        visible: !Tokens.dark
        y: 3 * Tokens.u; width: art.width; height: art.height
        glowRadius: 8 * Tokens.u; spread: 0.1; cornerRadius: Tokens.radius + glowRadius
        color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.1)
    }
    RectangularGlow {
        visible: Tokens.dark
        y: 3 * Tokens.u; width: art.width; height: art.height
        glowRadius: 8 * Tokens.u; spread: 0.1; cornerRadius: Tokens.radius + glowRadius
        color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.1)
    }
    RectangularGlow {
        visible: Tokens.dark
        y: 10 * Tokens.u; width: art.width; height: art.height
        glowRadius: 10 * Tokens.u; spread: 0.1; cornerRadius: Tokens.radius + glowRadius
        color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.14)
    }
    Artwork {
        id: art
        work: root.work
        override: work && work.deckFile ? Api.url("/api/v1/media/" + work.deckFile + "/thumbnail") : ""
        width: parent.width
        kinds: root.poster ? ["poster", "backdrop"] : ["backdrop", "thumb", "poster"]
        height: Math.round(width * (root.poster ? 3 / 2 : 9 / 16) + (root.poster ? 0 : 0.2))
        opacity: root.pressed ? 0.7 : 1
    }
    Rectangle {
        visible: root.ring
        anchors { fill: art; margins: -3 * Tokens.u }
        radius: Tokens.radius + 3 * Tokens.u; color: "transparent"
        border.width: 3 * Tokens.u; border.color: Tokens.brandInk
    }
    // Watch state: a progress bar for part-watched, a ringed dot for unseen (web WatchStateOverlay).
    Rectangle {
        visible: !!root.prog && root.prog.state === "part_watched" && root.prog.duration_ms > 0
        anchors { left: art.left; bottom: art.bottom; leftMargin: 0 }
        height: 3 * Tokens.u
        width: visible ? art.width * Math.min(1, root.prog.position_ms / root.prog.duration_ms) : 0
        color: Tokens.brandPink
    }
    UnseenDot {
        visible: root.showUnwatched && (!root.prog || root.prog.state === "unseen")
        anchors { top: art.top; right: art.right; topMargin: 7 * Tokens.u; rightMargin: 7 * Tokens.u }
    }
    Column {
        id: caption
        anchors { top: art.bottom; topMargin: (compact ? 11 : 11.7) * Tokens.u; left: parent.left; right: parent.right; leftMargin: 1.7 * Tokens.u }
        spacing: 3 * Tokens.u
        Label {
            width: parent.width
            text: work ? (work.deckTitle || work.title) : ""
            elide: Text.ElideRight
            color: Tokens.ink
            font.family: Tokens.family610   // web --card-title-weight: 610
            font.letterSpacing: -0.015 * 8.9 * Tokens.u
            font.pixelSize: 8.9 * Tokens.u
        }
        Label {
            visible: !root.compact
            width: parent.width
            text: work && work.deckSub ? work.deckSub : work ? kindLabel(work.kind) + (work.release_date ? " · " + work.release_date.substr(0, 4) : "") : ""
            elide: Text.ElideRight
            color: Tokens.inkMuted
            font.family: Tokens.family
            font.pixelSize: 6.9 * Tokens.u
        }
    }
}
