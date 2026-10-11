import QtQuick 2.6
import "."

// Web's scroll-edge fade: a gradient to the page background on each side where content continues off-screen.
// Declare it inside the Flickable/ListView (`target`) or next to it: it re-parents itself beside the target so it
// does not scroll with the content. Not for use inside a Column/Row. It never takes input.
Item {
    id: root
    property Flickable target
    property bool horizontal: false
    property real size: 28 * Tokens.u
    parent: target ? target.parent : null
    x: target ? target.x : 0
    y: target ? target.y : 0
    width: target ? target.width : 0
    height: target ? target.height : 0
    z: 10
    enabled: false

    readonly property bool more1: target ? (horizontal ? !target.atXBeginning : !target.atYBeginning) : false
    readonly property bool more2: target ? (horizontal ? !target.atXEnd : !target.atYEnd) : false

    // QtQuick 2.6 gradients only run top to bottom, so the horizontal fades are rotated vertical ones.
    Rectangle {
        width: root.horizontal ? root.height : root.width
        height: root.size
        rotation: root.horizontal ? -90 : 0
        x: root.horizontal ? root.size / 2 - width / 2 : 0
        y: root.horizontal ? root.height / 2 - root.size / 2 : 0
        opacity: root.more1 ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 150 } }
        gradient: Gradient {
            GradientStop { position: 0; color: Tokens.bg }
            GradientStop { position: 1; color: Qt.rgba(Tokens.bg.r, Tokens.bg.g, Tokens.bg.b, 0) }
        }
    }
    Rectangle {
        width: root.horizontal ? root.height : root.width
        height: root.size
        rotation: root.horizontal ? 90 : 0
        x: root.horizontal ? root.width - root.size / 2 - width / 2 : 0
        y: root.horizontal ? root.height / 2 - root.size / 2 : root.height - root.size
        opacity: root.more2 ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 150 } }
        gradient: Gradient {
            GradientStop { position: 0; color: root.horizontal ? Tokens.bg : Qt.rgba(Tokens.bg.r, Tokens.bg.g, Tokens.bg.b, 0) }
            GradientStop { position: 1; color: root.horizontal ? Qt.rgba(Tokens.bg.r, Tokens.bg.g, Tokens.bg.b, 0) : Tokens.bg }
        }
    }
}
