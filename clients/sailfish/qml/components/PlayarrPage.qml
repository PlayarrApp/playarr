import QtQuick 2.6
import Sailfish.Silica 1.0

// Page with the web background colour so both web themes hold regardless of the ambience.
Page {
    allowedOrientations: Orientation.Portrait
    Rectangle {
        anchors.fill: parent
        z: -1
        color: Tokens.bg
    }
}
