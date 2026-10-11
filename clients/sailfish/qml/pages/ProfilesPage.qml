import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// "Who's watching?": the profiles signed in on this device, add-another and sign out.
PlayarrPage {
    id: page
    Column {
        anchors { left: parent.left; right: parent.right; top: parent.top; topMargin: 56 * Tokens.u }
        spacing: 24 * Tokens.u
        Column {
            x: Tokens.pad
            spacing: 4 * Tokens.u
            Label {
                text: qsTr("PROFILES")
                color: Tokens.brandPinkSoft
                font.family: Tokens.family
                font.weight: Font.Bold
                font.letterSpacing: 2 * Tokens.u
                font.pixelSize: 12 * Tokens.u
            }
            Label {
                text: qsTr("Who’s watching?")
                color: Tokens.ink
                font.family: Tokens.family
                font.pixelSize: 38 * Tokens.u
            }
        }
        Flow {
            x: Tokens.pad
            width: parent.width - 2 * Tokens.pad
            spacing: 16 * Tokens.u
            Repeater {
                model: Api.profiles
                MouseArea {
                    width: (parent.width - 16 * Tokens.u) / 2
                    height: width + 56 * Tokens.u
                    onClicked: {
                        Api.selectProfile(modelData.userId)
                        pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"))
                    }
                    onPressAndHold: remorse.execute(qsTr("Removing profile"), function () { Api.removeProfile(modelData.userId) })
                    Avatar {
                        id: av
                        width: parent.width * 0.8
                        anchors.horizontalCenter: parent.horizontalCenter
                        source: modelData.avatar
                        Rectangle {
                            anchors.fill: parent; radius: width / 2; color: "transparent"
                            border.width: modelData.active ? 3 : 0
                            border.color: Tokens.brandPink
                        }
                    }
                    Label {
                        anchors { top: av.bottom; topMargin: 8 * Tokens.u; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter
                        text: modelData.name
                        elide: Text.ElideRight
                        color: Tokens.ink
                        font.family: Tokens.family
                        font.pixelSize: 18 * Tokens.u
                    }
                    Label {
                        anchors { bottom: parent.bottom; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter
                        text: modelData.active ? qsTr("WATCHING NOW") : ""
                        color: Tokens.inkMuted
                        font.family: Tokens.family
                        font.pixelSize: 11 * Tokens.u
                    }
                }
            }
            MouseArea {
                width: (parent.width - 16 * Tokens.u) / 2
                height: width + 56 * Tokens.u
                onClicked: pageStack.push(Qt.resolvedUrl("LinkPage.qml"), { adding: true })
                Rectangle {
                    id: plus
                    width: parent.width * 0.8
                    height: width
                    anchors.horizontalCenter: parent.horizontalCenter
                    radius: width / 2
                    color: Tokens.surfaceSoft
                    Label { anchors.centerIn: parent; text: "+"; color: Tokens.ink; font.pixelSize: 56 * Tokens.u }
                }
                Label {
                    anchors { top: plus.bottom; topMargin: 8 * Tokens.u; left: parent.left; right: parent.right }
                    horizontalAlignment: Text.AlignHCenter
                    text: qsTr("Sign in")
                    color: Tokens.inkSoft
                    font.family: Tokens.family
                    font.pixelSize: 18 * Tokens.u
                }
            }
        }
        Row {
            x: Tokens.pad
            spacing: 12 * Tokens.u
            PillButton { text: qsTr("Settings"); onClicked: pageStack.push(Qt.resolvedUrl("SettingsPage.qml")) }
            PillButton { text: qsTr("Sign out"); onClicked: remorse.execute(qsTr("Signing out"), function () { Api.signOut() }) }
            PillButton { visible: Api.signedIn; text: qsTr("Continue"); primary: true
                onClicked: pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml")) }
        }
    }
    RemorsePopup { id: remorse }
}
