import QtQuick 2.6
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0
import "../components"

// "Who's watching?": the profiles signed in on this device, add-another, settings and sign out.
PlayarrPage {
    id: page
    // The web profiles page sits on the darker shell colour with a faint brand glow behind the profiles.
    background: Component { Rectangle { color: Tokens.dark ? "#141214" : "#f5f3f2" } }
    RadialGradient {
        x: parent.width / 2 - width / 2; y: 0.48 * parent.height - height / 2
        width: 2 * 271 / 1.969 * Tokens.u; height: width
        gradient: Gradient {
            GradientStop { position: 0.0; color: Qt.rgba(0xcf / 255, 0x31 / 255, 0x57 / 255, 0.13) }
            GradientStop { position: 1.0; color: "transparent" }
        }
    }
    function openSettings() {
        var mp = pageStack.find(function (p) { return p.objectName === "main" })
        if (mp) { mp.section = "settings"; pageStack.pop(mp) }
        else pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"), { section: "settings" })
    }
    Image {
        x: 30 * Tokens.u; y: 14 * Tokens.u
        width: 36 * Tokens.u; height: width
        source: "file:///usr/share/icons/hicolor/86x86/apps/harbour-playarr.png"
        smooth: true
    }
    // Theme and language selects, as on web (the language has no setting on this device, so it only reads "Auto").
    Repeater {
        model: 2
        MouseArea {
            x: (index === 0 ? 144.2 : 264.1) * Tokens.u
            y: 14.2 * Tokens.u
            width: 111.7 * Tokens.u; height: 47.2 * Tokens.u
            onClicked: if (index === 0) Api.themeMode = Api.themeMode === "system" ? "dark" : Api.themeMode === "dark" ? "light" : "system"
            Rectangle { anchors.fill: parent; color: Tokens.dark ? "#161416" : "#f4f2f1"; border.width: 1; border.color: Tokens.lineStrong }
            Row {
                anchors.centerIn: parent
                spacing: 9 * Tokens.u
                Label { anchors.verticalCenter: parent.verticalCenter; text: index === 0 ? "\u2600" : "\u25CC"; color: Tokens.inkSoft; font.pixelSize: 11 * Tokens.u }
                Label { anchors.verticalCenter: parent.verticalCenter; text: index === 0 ? (Api.themeMode === "system" ? qsTr("Auto") : Api.themeMode === "dark" ? qsTr("Dark") : qsTr("Light")) : qsTr("Auto"); color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 11.5 * Tokens.u }
                Label { anchors.verticalCenter: parent.verticalCenter; text: "\u2304"; color: Tokens.inkSoft; font.pixelSize: 11 * Tokens.u }
            }
        }
    }
    Label {
        x: 0; width: parent.width; y: 70 * Tokens.u
        horizontalAlignment: Text.AlignHCenter
        text: qsTr("PROFILES")
        color: Tokens.dark ? Tokens.brandPinkSoft : "#8c2344"
        font.family: Tokens.family820; font.letterSpacing: 1.5 * Tokens.u; font.pixelSize: 7.4 * Tokens.u
    }
    Label {
        x: 0; width: parent.width; y: 82 * Tokens.u
        horizontalAlignment: Text.AlignHCenter
        text: qsTr("Who’s watching?")
        color: Tokens.ink
        font.family: Tokens.family580; font.letterSpacing: -2 * Tokens.u; font.pixelSize: 42.4 * Tokens.u
    }
    Row {
        x: 17.3 * Tokens.u; y: 164 * Tokens.u
        spacing: 11.9 * Tokens.u
        Repeater {
            model: Api.profiles
            MouseArea {
                width: 177 * Tokens.u; height: 232 * Tokens.u
                onClicked: {
                    if (modelData.pinLocked && !modelData.active) { pageStack.push(Qt.resolvedUrl("PinPage.qml"), { profile: modelData }); return }
                    Api.selectProfile(modelData.userId)
                    pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"))
                }
                onPressAndHold: remorse.execute(qsTr("Removing profile"), function () { Api.removeProfile(modelData.userId) })
                Avatar {
                    id: av
                    y: 4 * Tokens.u; anchors.horizontalCenter: parent.horizontalCenter
                    width: 168.6 * Tokens.u
                    source: modelData.avatar
                    // The active ring sits outside the plate, as on web.
                    Rectangle { anchors.fill: parent; anchors.margins: -4 * Tokens.u; radius: width / 2; color: "transparent"; border.width: modelData.active ? 4 * Tokens.u : 0; border.color: Tokens.dark ? Qt.rgba(0.81, 0.19, 0.34, 0.4) : Tokens.brandInk }   // alpha in the colour: item opacity drew a pink square behind the plate
                }
                Label { anchors { top: av.bottom; topMargin: 5.8 * Tokens.u; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter; text: modelData.name; elide: Text.ElideRight; color: Tokens.ink
                        font.family: Tokens.family610; font.pixelSize: 14 * Tokens.u }
                Label { anchors { top: av.bottom; topMargin: 34.2 * Tokens.u; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter; text: modelData.active ? qsTr("WATCHING NOW") : ""; color: Tokens.inkSoft
                        font.family: Tokens.family; font.letterSpacing: 1 * Tokens.u; font.pixelSize: 6.4 * Tokens.u }
            }
        }
        MouseArea {
            width: 155.4 * Tokens.u; height: 232 * Tokens.u
            onClicked: pageStack.push(Qt.resolvedUrl("LinkPage.qml"), { adding: true })
            Rectangle {
                id: plus
                width: parent.width; height: width; radius: width / 2
                y: 17.8 * Tokens.u
                gradient: Gradient {
                    GradientStop { position: 0; color: Tokens.dark ? "#6a2c42" : "#eec4cd" }
                    GradientStop { position: 1; color: Tokens.dark ? "#962a4e" : "#b84b6b" }
                }
                border.width: 1; border.color: Qt.rgba(1, 1, 1, Tokens.dark ? 0.2 : 0.4)
                Label { anchors.centerIn: parent; text: "+"; color: Tokens.dark ? Qt.rgba(1, 1, 1, 0.7) : Qt.rgba(0.2, 0.15, 0.15, 0.8); font.pixelSize: 40 * Tokens.u }
            }
            Label { anchors { top: plus.bottom; topMargin: 9.8 * Tokens.u; left: parent.left; right: parent.right }
                    horizontalAlignment: Text.AlignHCenter; text: qsTr("Sign in"); color: Tokens.inkSoft
                    font.family: Tokens.family610; font.pixelSize: 14 * Tokens.u }
            Label { anchors { top: plus.bottom; topMargin: 37.1 * Tokens.u; left: parent.left; right: parent.right }
                    horizontalAlignment: Text.AlignHCenter; text: qsTr("ADD ANOTHER PROFILE"); color: Tokens.inkSoft
                    font.family: Tokens.family; font.letterSpacing: 1 * Tokens.u; font.pixelSize: 6.4 * Tokens.u }
        }
    }
    Row {
        x: 35.5 * Tokens.u; y: 405.3 * Tokens.u
        spacing: 8.8 * Tokens.u
        MouseArea {
            width: 43.7 * Tokens.u; height: width
            onClicked: page.openSettings()
            Rectangle { anchors.fill: parent; radius: width / 2; color: Tokens.dark ? "#1a181a" : "#fdfcfc"; border.width: 1; border.color: Tokens.lineStrong }
            Label { anchors.centerIn: parent; text: "\u2699"; color: Tokens.brandPink; font.pixelSize: 20 * Tokens.u }
        }
        PillButton {
            icon: "\u21E5"; iconSize: 12 * Tokens.u; labelFamily: Tokens.family610
            text: qsTr("Sign out")
            fontSize: 8.8 * Tokens.u
            implicitHeight: 43.7 * Tokens.u
            onClicked: remorse.execute(qsTr("Signing out"), function () { Api.signOut() })
        }
    }
    RemorsePopup { id: remorse }
}
