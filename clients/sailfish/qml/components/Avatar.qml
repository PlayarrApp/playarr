import QtQuick 2.6
import "."

// Round avatar plate (preset art from clients/shared/profile-avatars, or the account's custom picture).
Item {
    property alias source: img.source
    width: 44 * Tokens.u
    height: width
    Rectangle { anchors.fill: parent; radius: width / 2; color: Tokens.surfaceSoft }
    Image {
        id: img
        anchors.fill: parent
        sourceSize: Qt.size(width * 2, height * 2)
        smooth: true
        asynchronous: true
    }
}
