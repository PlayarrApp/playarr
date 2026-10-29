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
    // The plate: a 145deg gradient disc with a soft sheen (Qt 5.6 gradients run top to bottom only, so one Canvas draws both), clipped to the disc.
    Canvas {
        id: plate
        visible: root.drawn
        width: root.width; height: root.width
        renderTarget: Canvas.Image
        Accessible.role: Accessible.Pane
        layer.enabled: true
        layer.effect: OpacityMask { maskSource: Rectangle { width: plate.width; height: plate.height; radius: width / 2 } }
        property color start: root.plateStart
        property color end: root.plateEnd
        onStartChanged: requestPaint()
        onEndChanged: requestPaint()
        onWidthChanged: requestPaint()
        onPaint: {
            var ctx = getContext("2d"), w = width, c = w / 2
            ctx.clearRect(0, 0, w, w)
            // CSS 145deg: the gradient line runs through the centre at 145deg clockwise from up, as long as the box projects on it
            var dx = Math.sin(145 * Math.PI / 180), dy = -Math.cos(145 * Math.PI / 180), half = (Math.abs(w * dx) + Math.abs(w * dy)) / 2
            var lg = ctx.createLinearGradient(c - dx * half, c - dy * half, c + dx * half, c + dy * half)
            lg.addColorStop(0, start); lg.addColorStop(1, end)
            ctx.fillStyle = lg; ctx.fillRect(0, 0, w, w)
            // the sheen: white at 28 % fading to nothing over 26.77 % of the plate
            var g = ctx.createRadialGradient(w * 0.34, w * 0.26, 0, w * 0.34, w * 0.26, w * 0.2677)
            g.addColorStop(0, "rgba(255,255,255,0.28)"); g.addColorStop(1, "rgba(255,255,255,0)")
            ctx.fillStyle = g; ctx.fillRect(0, 0, w, w)
        }
    }
    Image {
        visible: root.drawn
        x: root.width * 0.07; y: root.width * 0.07; width: root.width * 0.86; height: width
        source: root.artSource
        sourceSize: Qt.size(width * 2, height * 2)
        smooth: true
        asynchronous: true
    }
}
