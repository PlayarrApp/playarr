import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// One preferences section: appearance, avatar, language, player defaults, server, profile lock.
PlayarrPage {
    id: page
    objectName: "settings-subpage"
    property string section
    readonly property var titles: ({ appearance: qsTr("Appearance"), avatar: qsTr("Profile avatar"), language: qsTr("Language"),
                                     player: qsTr("Player"), server: qsTr("Server connection"), lock: qsTr("Profile lock") })
    readonly property var presets: ["astronaut", "cat", "dinosaur", "robot", "pirate", "alien"]

    function pickAvatar(id) {
        Api.request("PUT", "/api/v1/users/me/profile-avatar", { kind: "preset", value: id }, function (st) {
            if (st === 200 || st === 204) Api.refreshProfile()
        })
    }

    PageTitle { id: head; y: 4 * Tokens.u; title: page.titles[page.section] || ""; onBackClicked: pageStack.pop() }
    SilicaFlickable {
        id: flick
        anchors { top: head.bottom; left: parent.left; right: parent.right; bottom: parent.bottom }
        contentHeight: col.height + 40 * Tokens.u
        clip: true
        Column {
            id: col
            width: parent.width
            spacing: 14 * Tokens.u
            // appearance
            Label { x: Tokens.pad; visible: page.section === "appearance"; text: qsTr("THEME"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            Row {
                x: Tokens.pad; spacing: 8 * Tokens.u; visible: page.section === "appearance"
                Repeater {
                    model: [ { id: "system", label: qsTr("Auto") }, { id: "dark", label: qsTr("Dark") }, { id: "light", label: qsTr("Light") } ]
                    PillButton { text: modelData.label; primary: Api.themeMode === modelData.id; onClicked: Api.themeMode = modelData.id }
                }
            }
            // avatar
            Flow {
                x: Tokens.pad; width: parent.width - 2 * Tokens.pad; spacing: 14 * Tokens.u; visible: page.section === "avatar"
                Repeater {
                    model: page.presets
                    MouseArea {
                        property bool navigationFocusable: true
                        property string parityLabel: qsTr("Avatar %1").arg(index + 1)
                        property int parityRail: 0
                        property int parityIndex: index
                        width: 84 * Tokens.u; height: width
                        onClicked: page.pickAvatar(modelData)
                        function navigationActivate() { page.pickAvatar(modelData) }
                        Avatar { anchors.fill: parent; width: parent.width; source: Api.avatarSource(modelData) }
                    }
                }
            }
            // language
            Label { x: Tokens.pad; width: parent.width - 2 * Tokens.pad; visible: page.section === "language"; wrapMode: Text.Wrap
                    text: qsTr("Playarr follows this device's language."); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
            // player
            Label { x: Tokens.pad; visible: page.section === "player"; text: qsTr("SUBTITLES"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            Row {
                id: subMode
                x: Tokens.pad; spacing: 8 * Tokens.u; visible: page.section === "player"
                property string value: Api.setting("subtitleMode", "off")
                Repeater {
                    model: [ { id: "off", label: qsTr("Off") }, { id: "forced", label: qsTr("Forced") }, { id: "always", label: qsTr("Always") } ]
                    PillButton { text: modelData.label; primary: subMode.value === modelData.id
                                 onClicked: { Api.setSetting("subtitleMode", modelData.id); subMode.value = modelData.id } }
                }
            }
            ChipRow {
                id: langs
                visible: page.section === "player"
                property string value2: Api.setting("subtitleLanguage", "en")
                value: value2
                options: [ { id: "en", label: "English" }, { id: "th", label: "ไทย" }, { id: "ja", label: "日本語" },
                           { id: "de", label: "Deutsch" }, { id: "fr", label: "Français" }, { id: "es", label: "Español" } ]
                onPicked: { Api.setSetting("subtitleLanguage", id); value2 = id }
            }
            // advanced player settings
            Label { x: Tokens.pad; visible: page.section === "player"; text: qsTr("ADVANCED"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            Repeater {
                model: page.section === "player" ? [ { key: "forceDirectVideo", label: qsTr("Force direct video") }, { key: "forceDirectAudio", label: qsTr("Force direct audio") } ] : []
                Row {
                    id: forceRow
                    x: Tokens.pad
                    spacing: 10 * Tokens.u
                    property bool on: Api.setting(modelData.key, false) === true || Api.setting(modelData.key, false) === "true"
                    Label { width: 150 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; text: modelData.label; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 12 * Tokens.u }
                    PillButton { text: qsTr("Off"); primary: !forceRow.on; implicitWidth: 64 * Tokens.u; onClicked: { Api.setSetting(modelData.key, false); forceRow.on = false } }
                    PillButton { text: qsTr("On"); primary: forceRow.on; implicitWidth: 64 * Tokens.u; onClicked: { Api.setSetting(modelData.key, true); forceRow.on = true } }
                }
            }
            // server
            Column {
                x: Tokens.pad; width: parent.width - 2 * Tokens.pad; spacing: 8 * Tokens.u; visible: page.section === "server"
                Label { text: Api.profileName; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 16 * Tokens.u }
                Label { width: parent.width; text: Api.serverUrl; elide: Text.ElideMiddle; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u }
                PillButton { text: qsTr("Sign out"); onClicked: remorse.execute(qsTr("Signing out"), function () { Api.signOut() }) }
            }
            // lock
            Label { x: Tokens.pad; width: parent.width - 2 * Tokens.pad; visible: page.section === "lock"; wrapMode: Text.Wrap
                    text: qsTr("The profile PIN is set from the Playarr web app or a phone; this device asks for it when switching to a locked profile."); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
        }
        VerticalScrollDecorator {}
    }
    RemorsePopup { id: remorse }
}
