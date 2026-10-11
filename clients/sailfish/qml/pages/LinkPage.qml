import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// QR / device-code sign-in through the hosted link; the pairing delivers the server address, nothing is typed.
PlayarrPage {
    id: page
    objectName: "link"
    property bool adding: false

    Component.onCompleted: Api.startLink()
    Component.onDestruction: Api.cancelLink()
    Connections {
        target: Api
        onLinkFinished: pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"))
    }

    Column {
        anchors { left: parent.left; right: parent.right; top: parent.top; topMargin: 56 * Tokens.u }
        spacing: 18 * Tokens.u

        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            text: page.adding ? qsTr("Add a profile") : qsTr("Sign in")
            color: Tokens.ink
            font.family: Tokens.family
            font.pixelSize: 34 * Tokens.u
        }
        Label {
            width: parent.width - 2 * Tokens.pad
            anchors.horizontalCenter: parent.horizontalCenter
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.Wrap
            text: qsTr("Scan the code with your phone, or open the link on any device and enter the code.")
            color: Tokens.inkSoft
            font.family: Tokens.family
            font.pixelSize: 15 * Tokens.u
        }
        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 250 * Tokens.u
            height: width
            color: "#ffffff"
            radius: 12 * Tokens.u
            Image {
                anchors.fill: parent
                anchors.margins: 8 * Tokens.u
                source: Api.linkQr
                fillMode: Image.PreserveAspectFit
                smooth: false
                cache: false
            }
            BusyIndicator {
                anchors.centerIn: parent
                size: BusyIndicatorSize.Large
                running: Api.linkQr === "" || Api.linkState === "requesting"
            }
        }
        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            text: Api.linkCode
            color: Tokens.ink
            font.family: "monospace"
            font.letterSpacing: 6 * Tokens.u
            font.pixelSize: 36 * Tokens.u
        }
        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            text: "playarr.app/link"
            color: Tokens.inkMuted
            font.family: Tokens.family
            font.pixelSize: 15 * Tokens.u
        }
        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: Api.linkState === "approved"
            text: qsTr("Approved, signing in...")
            color: Tokens.inkSoft
            font.family: Tokens.family
        }
        Label {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: Api.linkState === "denied"
            text: qsTr("The request was declined.")
            color: Tokens.danger
            font.family: Tokens.family
        }
        PillButton {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: Api.linkState === "denied"
            text: qsTr("Try again")
            primary: true
            onClicked: Api.startLink()
        }
    }
}
