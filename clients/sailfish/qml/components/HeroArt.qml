import QtQuick 2.6
import QtGraphicalEffects 1.0
import "."

// Web phone key art: the title's picture in the top 55% of a 58%-height box, grey and dimmed, faded into the page.
Item {
    id: root
    property var work
    property var kinds: ["backdrop", "poster"]
    property real boxH: 396 * Tokens.u
    property real imgFrac: 0.55       // share of the box the picture fills
    property real fadeFrom: 0.26      // where the page colour starts to cover it
    property real fadeTo: 0.54
    width: parent ? parent.width : 0
    height: boxH
    clip: true

    Item {
        width: parent.width
        height: root.imgFrac * root.boxH
        clip: true
        opacity: Tokens.dark ? 0.72 : 0.42
        layer.enabled: true
        Image {
            id: im
            width: parent.width
            height: implicitWidth > 0 ? width * implicitHeight / implicitWidth : 0
            y: -Math.max(0, height - parent.height) * 0.22   // object-position: center 22%
            source: work ? Api.artwork(work.id, work.images || [], root.kinds, true) : ""
            asynchronous: true
            smooth: true
            mipmap: true
            layer.enabled: true
            layer.effect: Desaturate { desaturation: 1.0 }
        }
        Rectangle { anchors.fill: parent; color: "black"; opacity: Tokens.dark ? 0.4 : 0 }   // brightness(.6)
        Rectangle {   // the web masks the picture out over its right 28%
            anchors.centerIn: parent
            width: parent.height; height: parent.width; rotation: -90
            gradient: Gradient {
                GradientStop { position: 0.0; color: "transparent" }
                GradientStop { position: 0.72; color: "transparent" }
                GradientStop { position: 1.0; color: Tokens.bg }
            }
        }
    }
    Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.0; color: "transparent" }
            GradientStop { position: root.fadeFrom; color: "transparent" }
            GradientStop { position: root.fadeTo; color: Tokens.bg }
            GradientStop { position: 1.0; color: Tokens.bg }
        }
    }
    Rectangle {
        anchors.centerIn: parent
        width: parent.height; height: parent.width; rotation: -90   // Qt 5.6 gradients only run top to bottom
        gradient: Gradient {
            GradientStop { position: 0.0; color: Qt.rgba(Tokens.bg.r, Tokens.bg.g, Tokens.bg.b, 0.54) }
            GradientStop { position: 1.0; color: "transparent" }
        }
    }
}
