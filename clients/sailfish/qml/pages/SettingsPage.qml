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
                text: qsTr("SUBTITLES")
                color: Tokens.brandPinkSoft
                font.family: Tokens.family
                font.weight: Font.Bold
                font.letterSpacing: 2 * Tokens.u
                font.pixelSize: 12 * Tokens.u
            }
            Row {
                id: subMode
                x: Tokens.pad
                spacing: 10 * Tokens.u
                property string value: Api.setting("subtitleMode", "off")
                Repeater {
                    model: [ { id: "off", label: qsTr("Off") }, { id: "forced", label: qsTr("Forced") }, { id: "always", label: qsTr("Always") } ]
                    PillButton {
                        text: modelData.label
                        primary: subMode.value === modelData.id
                        onClicked: { Api.setSetting("subtitleMode", modelData.id); subMode.value = modelData.id }
                    }
                }
            }
            Flickable {
                width: parent.width
                height: 44 * Tokens.u
                contentWidth: langs.width + 2 * Tokens.pad
                clip: true
                Row {
                    id: langs
                    x: Tokens.pad
                    spacing: 10 * Tokens.u
                    property string value: Api.setting("subtitleLanguage", "en")
                    Repeater {
                        model: [ { id: "en", label: "English" }, { id: "th", label: "\u0E44\u0E17\u0E22" }, { id: "ja", label: "\u65E5\u672C\u8A9E" },
                                 { id: "de", label: "Deutsch" }, { id: "fr", label: "Fran\u00E7ais" }, { id: "es", label: "Espa\u00F1ol" } ]
                        PillButton {
                            text: modelData.label
                            primary: langs.value === modelData.id
                            onClicked: { Api.setSetting("subtitleLanguage", modelData.id); langs.value = modelData.id }
                        }
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
                text: qsTr("Requests")
                onClicked: pageStack.push(Qt.resolvedUrl("RequestsPage.qml"))
            }
            PillButton {
                x: Tokens.pad
                text: qsTr("Sign out")
                onClicked: remorse.execute(qsTr("Signing out"), function () { Api.signOut() })
            }
        }
        VerticalScrollDecorator {}
        EdgeFade { target: parent }
    }
    RemorsePopup { id: remorse }
}
