import QtQuick 2.6
import "."

// Web's scroll-edge fade: a gradient to the page background on each side where content continues off-screen.
// Declare it inside the Flickable/ListView (`target`) or next to it: it re-parents itself beside the target so it
// does not scroll with the content. Not for use inside a Column/Row. It never takes input.
Item {
    id: root
    property Flickable target
    property bool horizontal: false
    property real size: 38 * Tokens.u        // web --page-edge-fade-size on the phone
    property real startSize: horizontal ? 16 * Tokens.u : size   // rails keep a clear left gutter of the page padding
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
    // Web masks the scroller with a smoothstep ramp (page-layout.css): the end side only dims the content to 30 %
    // at the edge, so the overlay alpha runs 0, 0.109, 0.35, 0.59, 0.7; a rail's start side is a clear 16 px ramp.
    readonly property var endAlpha: [0, 0.109, 0.35, 0.591, 0.7]     // from the inner edge outwards
    readonly property var startAlpha: [1, 0.844, 0.5, 0.156, 0]      // from the outer edge inwards
    function bgA(a) { return Qt.rgba(Tokens.bg.r, Tokens.bg.g, Tokens.bg.b, a) }
    Rectangle {
        width: root.horizontal ? root.height : root.width
        height: root.horizontal ? root.startSize : root.size
        rotation: root.horizontal ? -90 : 0
        x: root.horizontal ? root.startSize / 2 - width / 2 : 0
        y: root.horizontal ? root.height / 2 - root.startSize / 2 : 0
        opacity: root.more1 ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 150 } }
        gradient: Gradient {
            GradientStop { position: 0; color: Tokens.bg }
            GradientStop { position: 1; color: Qt.rgba(Tokens.bg.r, Tokens.bg.g, Tokens.bg.b, 0) }
        }
        visible: !root.horizontal
    }
    Rectangle {   // horizontal start side
        visible: root.horizontal
        width: root.height
        height: root.startSize
        rotation: -90
        x: root.startSize / 2 - width / 2
        y: root.height / 2 - root.startSize / 2
        opacity: root.more1 ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 150 } }
        gradient: Gradient {
            GradientStop { position: 0; color: root.bgA(root.startAlpha[0]) }
            GradientStop { position: 0.25; color: root.bgA(root.startAlpha[1]) }
            GradientStop { position: 0.5; color: root.bgA(root.startAlpha[2]) }
            GradientStop { position: 0.75; color: root.bgA(root.startAlpha[3]) }
            GradientStop { position: 1; color: root.bgA(root.startAlpha[4]) }
        }
    }
    Rectangle {   // end side: vertical runs inner to edge, the rotated horizontal one edge to inner
        width: root.horizontal ? root.height : root.width
        height: root.size
        rotation: root.horizontal ? 90 : 0
        x: root.horizontal ? root.width - root.size / 2 - width / 2 : 0
        y: root.horizontal ? root.height / 2 - root.size / 2 : root.height - root.size
        opacity: root.more2 ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 150 } }
        gradient: Gradient {
            GradientStop { position: 0; color: root.bgA(root.endAlpha[root.horizontal ? 4 : 0]) }
            GradientStop { position: 0.25; color: root.bgA(root.endAlpha[root.horizontal ? 3 : 1]) }
            GradientStop { position: 0.5; color: root.bgA(root.endAlpha[2]) }
            GradientStop { position: 0.75; color: root.bgA(root.endAlpha[root.horizontal ? 1 : 3]) }
            GradientStop { position: 1; color: root.bgA(root.endAlpha[root.horizontal ? 0 : 4]) }
        }
    }
}
