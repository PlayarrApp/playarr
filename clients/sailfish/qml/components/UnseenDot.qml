import QtQuick 2.6
import "."

// Web's unseen marker (.tv-watch-unseen): a brand dot with a 2 px white border, a 1 px brand ring at 35% and a soft drop shadow.
Item {
    width: 9 * Tokens.u; height: width
    Rectangle {   // shadow: 0 2px 9px rgba(31, 14, 20, .45)
        y: 2 * Tokens.u; width: parent.width; height: width; radius: width / 2
        color: Qt.rgba(31 / 255, 14 / 255, 20 / 255, 0.18)
        layer.enabled: false
    }
    Rectangle {   // 0 0 0 1px brand at 35%
        anchors.centerIn: parent; width: parent.width + 2 * Tokens.u; height: width; radius: width / 2
        color: "transparent"; border.width: 1 * Tokens.u; border.color: Qt.rgba(Tokens.brandPink.r, Tokens.brandPink.g, Tokens.brandPink.b, 0.35)
    }
    Rectangle {
        anchors.fill: parent; radius: width / 2
        color: Tokens.brandPink; border.width: 2 * Tokens.u; border.color: Qt.rgba(1, 1, 1, 0.94)
    }
}
