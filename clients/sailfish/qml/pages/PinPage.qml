import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// PIN prompt for a PIN-locked profile (POST /api/v1/auth/unlock); a wrong PIN and a rate limit read differently.
PlayarrPage {
    id: page
    property var profile            // { userId, name, avatar }
    property string pin: ""
    property string message: ""
    property bool busy: false
    readonly property int pinLength: 4

    function press(d) {
        if (busy || pin.length >= pinLength) return
        pin += d
        message = ""
        if (pin.length === pinLength) submit()
    }
    function submit() {
        busy = true
        Api.unlockProfile(profile.userId, pin, function (status, data) {
            busy = false
            if (status === 200) {
                pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"))
                return
            }
            pin = ""
            message = status === 429 ? qsTr("Too many attempts. Try again in %1 s.").arg(data && data.retryAfter ? data.retryAfter : 60)
                    : status === 401 ? qsTr("That PIN is not right.")
                    : qsTr("Could not check the PIN. Try again.")
        })
    }

    Column {
        anchors { left: parent.left; right: parent.right; top: parent.top; topMargin: 56 * Tokens.u }
        spacing: 18 * Tokens.u
        Avatar { anchors.horizontalCenter: parent.horizontalCenter; width: 96 * Tokens.u; source: page.profile.avatar }
        Label { renderType: Text.NativeRendering;
            anchors.horizontalCenter: parent.horizontalCenter
            text: page.profile.name
            color: Tokens.ink
            font.family: Tokens.family
            font.pixelSize: 24 * Tokens.u
        }
        Label { renderType: Text.NativeRendering;
            anchors.horizontalCenter: parent.horizontalCenter
            text: qsTr("Enter the profile PIN")
            color: Tokens.inkSoft
            font.family: Tokens.family
            font.pixelSize: 15 * Tokens.u
        }
        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 16 * Tokens.u
            Repeater {
                model: page.pinLength
                Rectangle {
                    width: 16 * Tokens.u; height: width; radius: width / 2
                    color: index < page.pin.length ? Tokens.ink : "transparent"
                    border.width: 2
                    border.color: Tokens.lineStrong
                }
            }
        }
        Label { renderType: Text.NativeRendering;
            anchors.horizontalCenter: parent.horizontalCenter
            height: 20 * Tokens.u
            text: page.message
            color: Tokens.danger
            font.family: Tokens.family
            font.pixelSize: 14 * Tokens.u
        }
        Grid {
            anchors.horizontalCenter: parent.horizontalCenter
            columns: 3
            spacing: 14 * Tokens.u
            Repeater {
                model: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]
                MouseArea {
                    width: 76 * Tokens.u; height: width
                    enabled: modelData !== "" && !page.busy
                    onClicked: modelData === "⌫" ? page.pin = page.pin.slice(0, -1) : page.press(modelData)
                    Rectangle {
                        anchors.fill: parent; radius: width / 2
                        visible: modelData !== ""
                        color: Tokens.surfaceStrong
                        border.width: 1; border.color: Tokens.line
                        opacity: parent.pressed ? 0.6 : 1
                    }
                    Label { renderType: Text.NativeRendering; anchors.centerIn: parent; text: modelData; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 28 * Tokens.u }
                }
            }
        }
    }
}
