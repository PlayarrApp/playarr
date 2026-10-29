import QtQuick 2.6
import QtGraphicalEffects 1.0
import "."

// Round avatar plate (preset art from clients/shared/profile-avatars, or the account's custom picture).
Item {
    id: root
    property alias source: img.source
    // Preset plates drawn as the web does: a 145deg gradient disc with a soft sheen, and the artwork alone as its own picture on top.
    // `artSource` is the artwork PNG (avatar-art/<id>.png); the plate colours come from presets.json.
    property string artSource: ""
    property color plateStart: "#000000"
    property color plateEnd: "#000000"
    readonly property bool drawn: artSource !== ""
    width: 44 * Tokens.u
    height: width
    property color plateColor: Tokens.surfaceSoft
    Rectangle {   // the plate, with the picture inside it
        visible: !root.drawn; anchors.fill: parent; radius: width / 2; color: root.plateColor
        Image {
            id: img
            anchors.fill: parent
            sourceSize: Qt.size(width * 2, height * 2)
            smooth: true
            asynchronous: true
        }
    }
    // Qt 5.6 gradients run top to bottom only: a rotated, longer rectangle gives the 145deg line, masked to the disc.
    Item {
        id: plateSource
        visible: false
        width: root.width; height: root.width
        Rectangle {
                        anchors.centerIn: parent
            width: root.width * 2; height: root.width * 1.3925; rotation: -35
            gradient: Gradient { GradientStop { position: 0; color: root.plateStart } GradientStop { position: 1; color: root.plateEnd } }
        }
        Canvas {   // the sheen: white at 28 % fading to nothing over 26.77 % of the plate
                anchors.fill: parent
            renderTarget: Canvas.Image
            onPaint: {
                var ctx = getContext("2d"), w = width
                ctx.clearRect(0, 0, w, w)
                var g = ctx.createRadialGradient(w * 0.34, w * 0.26, 0, w * 0.34, w * 0.26, w * 0.2677)
                g.addColorStop(0, "rgba(255,255,255,0.28)"); g.addColorStop(1, "rgba(255,255,255,0)")
                ctx.fillStyle = g; ctx.fillRect(0, 0, w, w)
            }
        }
    }
    Rectangle { id: plateMask; visible: false; width: root.width; height: width; radius: width / 2 }
    OpacityMask {
        visible: root.drawn
        width: root.width; height: root.width
        source: plateSource; maskSource: plateMask
        property string parityRole: "container"
        property var radiusSource: plateMask
    }
    Image {
        visible: root.drawn
        x: root.width * 0.07; y: root.width * 0.07; width: root.width * 0.86; height: width
        source: root.artSource
        sourceSize: Qt.size(width * 2, height * 2)
        smooth: true
        asynchronous: true
        property string parityRole: "image"
    }
}
