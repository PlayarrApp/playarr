import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

PlayarrPage {
    SilicaFlickable {
        anchors.fill: parent
        contentHeight: col.height + Theme.paddingLarge
        Column {
            id: col
            width: parent.width
            spacing: 20 * Tokens.u
            Item { width: 1; height: 28 * Tokens.u }
            Label {
                x: Tokens.pad
                text: qsTr("Settings")
                color: Tokens.ink
                font.family: Tokens.family
                font.pixelSize: 30 * Tokens.u
            }
            Label {
                x: Tokens.pad
                text: qsTr("APPEARANCE")
                color: Tokens.brandPinkSoft
                font.family: Tokens.family
                font.weight: Font.Bold
                font.letterSpacing: 2 * Tokens.u
                font.pixelSize: 12 * Tokens.u
            }
            Row {
                x: Tokens.pad
                spacing: 10 * Tokens.u
                Repeater {
                    model: [ { id: "system", label: qsTr("Auto") }, { id: "dark", label: qsTr("Dark") }, { id: "light", label: qsTr("Light") } ]
                    PillButton {
                        text: modelData.label
                        primary: Api.themeMode === modelData.id
                        onClicked: Api.themeMode = modelData.id
                    }
                }
            }
            Label {
                x: Tokens.pad
                text: qsTr("ACCOUNT")
                color: Tokens.brandPinkSoft
                font.family: Tokens.family
                font.weight: Font.Bold
                font.letterSpacing: 2 * Tokens.u
                font.pixelSize: 12 * Tokens.u
            }
            Label {
                x: Tokens.pad
                width: parent.width - 2 * Tokens.pad
                text: Api.profileName
                color: Tokens.ink
                font.family: Tokens.family
                font.pixelSize: 18 * Tokens.u
            }
            Label {
                x: Tokens.pad
                width: parent.width - 2 * Tokens.pad
                text: Api.serverUrl
                elide: Text.ElideMiddle
                color: Tokens.inkMuted
                font.family: Tokens.family
                font.pixelSize: 13 * Tokens.u
            }
            PillButton {
                x: Tokens.pad
                text: qsTr("Sign out")
                onClicked: remorse.execute(qsTr("Signing out"), function () { Api.signOut() })
            }
        }
        VerticalScrollDecorator {}
    }
    RemorsePopup { id: remorse }
}
