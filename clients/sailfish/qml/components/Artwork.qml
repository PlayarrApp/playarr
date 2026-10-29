import QtQuick 2.6
import "."
import QtGraphicalEffects 1.0

// Rounded artwork with the placeholder gradient + title the web shows when a title has no picture.
Item {
    id: root
    property var work
    property var kinds: ["backdrop", "thumb", "poster"]
    property real radius: Tokens.radius
    property bool hero: false
    property var prog: null           // watch progress drawn along the foot (WorkCard)
    property bool roundImage: false   // the web puts the corner radius on the picture itself (posters), not on a container around it
    property string override: ""     // a specific picture (an episode's frame) instead of the work art
    property color emptyColor: "transparent" // optional flat fill while a view has no artwork
    readonly property string src: override !== "" ? override : (work ? Api.artwork(work.id, work.images || [], kinds, hero) : "")

    function hue(s) {
        var h = 0
        for (var i = 0; i < s.length; ++i) h = (h * 31 + s.charCodeAt(i)) % 360
        return h / 360
    }

    // The web's art container. It clips what it holds to its rounded corners (a masked layer), so the picture itself is a plain rectangle in it;
    // a poster (roundImage) is rounded on the picture instead.
    Rectangle {
        id: holder
        anchors.fill: parent; radius: root.roundImage ? 0 : root.radius; color: root.roundImage ? "transparent" : Tokens.surfaceSoft
        layer.enabled: !root.roundImage
        layer.effect: OpacityMask { maskSource: holderMask }
        Rectangle { id: holderMask; anchors.fill: parent; radius: root.radius; visible: false }
        Rectangle { anchors.fill: parent; radius: root.radius; color: Tokens.surfaceSoft; visible: root.roundImage }   // the picture's placeholder plate, drawn under it
        Rectangle {   // the placeholder gradient while there is no picture
            anchors.fill: parent
            visible: img.status !== Image.Ready
            radius: root.roundImage ? root.radius : 0
            gradient: Gradient {
                GradientStop { position: 0; color: Qt.hsla(hue(work ? work.title : ""), 0.45, Tokens.dark ? 0.32 : 0.62, 1) }
                GradientStop { position: 1; color: Qt.hsla(hue(work ? work.title : ""), 0.5, Tokens.dark ? 0.08 : 0.3, 1) }
            }
        }
        FitText {
            visible: img.status !== Image.Ready
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 8 * Tokens.u }
            text: work ? work.title : ""
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            maximumLineCount: 2
            elide: Text.ElideRight
            color: "#ffffff"
            font.family: Tokens.family
            font.weight: Font.Bold
            font.capitalization: Font.AllUppercase
            font.pixelSize: Tokens.fs(20)
        }
        Rectangle {
            anchors.fill: parent
            color: root.emptyColor
            visible: root.emptyColor.a > 0 && img.status !== Image.Ready
        }
        Image {
            id: img
            anchors.fill: parent
            source: root.src
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            // Same source size as the web asks for, scaled by the GPU with mipmaps like the browser does.
            smooth: true
            mipmap: true
            layer.enabled: root.roundImage
            layer.effect: OpacityMask { maskSource: Rectangle { width: img.width; height: img.height; radius: root.radius } }
        }
        Rectangle {   // watch progress: the track and the watched part, along the foot of the picture
            visible: !!root.prog && root.prog.state === "part_watched" && root.prog.duration_ms > 0
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
            height: 3 * Tokens.u
            Accessible.role: Accessible.Graphic
            color: Tokens.dark ? "#5a5559" : "#e5e3e4"
        }
        Rectangle {
            visible: !!root.prog && root.prog.state === "part_watched" && root.prog.duration_ms > 0
            anchors { left: parent.left; bottom: parent.bottom }
            height: 3 * Tokens.u
            width: visible ? parent.width * Math.max(0, Math.min(1, root.prog.position_ms / root.prog.duration_ms)) : 0
            color: Tokens.brandPink
        }
    }
}
