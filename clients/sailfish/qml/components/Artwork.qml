import QtQuick 2.6
import QtGraphicalEffects 1.0

// Rounded artwork with the placeholder gradient + title the web shows when a title has no picture.
Item {
    id: root
    property var work
    property var kinds: ["backdrop", "thumb", "poster"]
    property real radius: Tokens.radius
    readonly property string src: work ? Api.artwork(work.id, work.images || [], kinds) : ""

    function hue(s) {
        var h = 0
        for (var i = 0; i < s.length; ++i) h = (h * 31 + s.charCodeAt(i)) % 360
        return h / 360
    }

    Item {
        id: art
        anchors.fill: parent
        visible: false
        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0; color: Qt.hsla(hue(work ? work.title : ""), 0.45, Tokens.dark ? 0.32 : 0.62, 1) }
                GradientStop { position: 1; color: Qt.hsla(hue(work ? work.title : ""), 0.5, Tokens.dark ? 0.08 : 0.3, 1) }
            }
            Text {
                visible: img.status !== Image.Ready
                anchors { left: parent.left; right: parent.right; bottom: parent.bottom; margins: 8 * Tokens.u }
                text: work ? work.title.toUpperCase() : ""
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                maximumLineCount: 2
                elide: Text.ElideRight
                color: "#ffffff"
                font.family: Tokens.family
                font.weight: Font.Bold
                font.pixelSize: 20 * Tokens.u
            }
        }
        Image {
            id: img
            anchors.fill: parent
            source: root.src
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            sourceSize.width: root.width * 2
        }
    }
    Rectangle { id: mask; anchors.fill: parent; radius: root.radius; visible: false }
    OpacityMask { anchors.fill: parent; source: art; maskSource: mask }
}
