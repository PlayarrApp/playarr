import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Home/library card: landscape artwork with title and "Kind · Year" caption underneath, as on web mobile.
MouseArea {
    id: root
    property var work
    property real cardWidth: 173 * Tokens.u
    signal opened(var work)
    signal held(var work)
    width: cardWidth
    height: art.height + caption.height + 8 * Tokens.u
    onClicked: opened(work)
    onPressAndHold: held(work)

    function kindLabel(k) {
        return k === "movie" ? qsTr("Movie") : k === "series" ? qsTr("Series") : k === "artist" ? qsTr("Artist") : k === "author" ? qsTr("Author") : ""
    }

    Artwork {
        id: art
        work: root.work
        width: parent.width
        height: Math.round(width * 9 / 16)
        opacity: root.pressed ? 0.7 : 1
    }
    Column {
        id: caption
        anchors { top: art.bottom; topMargin: 8 * Tokens.u; left: parent.left; right: parent.right; leftMargin: 4 * Tokens.u }
        spacing: 2 * Tokens.u
        Label {
            width: parent.width
            text: work ? work.title : ""
            elide: Text.ElideRight
            color: Tokens.ink
            font.family: Tokens.family
            font.pixelSize: 13 * Tokens.u
        }
        Label {
            width: parent.width
            text: work ? kindLabel(work.kind) + (work.release_date ? " · " + work.release_date.substr(0, 4) : "") : ""
            elide: Text.ElideRight
            color: Tokens.inkMuted
            font.family: Tokens.family
            font.pixelSize: 11 * Tokens.u
        }
    }
}
