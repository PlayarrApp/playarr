import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// "Who's watching?": the profiles signed in on this device, add-another, settings and sign out.
PlayarrPage {
    id: page
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
    // Theme select (the web has theme and language selects here).
    MouseArea {
        anchors { right: parent.right; rightMargin: 12 * Tokens.u; top: parent.top; topMargin: 8 * Tokens.u }
        width: 112 * Tokens.u; height: 40 * Tokens.u
        onClicked: Api.themeMode = Api.themeMode === "system" ? "dark" : Api.themeMode === "dark" ? "light" : "system"
        Rectangle { anchors.fill: parent; color: Tokens.surface; border.width: 1; border.color: Tokens.lineStrong }
        Label { anchors.centerIn: parent; text: (Api.themeMode === "system" ? qsTr("Auto") : Api.themeMode === "dark" ? qsTr("Dark") : qsTr("Light")) + "  ⌄"; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u }
    }
    Label {
        x: 0; width: parent.width; y: 70 * Tokens.u
        horizontalAlignment: Text.AlignHCenter
        text: qsTr("PROFILES")
        color: Tokens.brandPinkSoft
        font.family: Tokens.family; font.weight: Font.Bold; font.letterSpacing: 1.5 * Tokens.u; font.pixelSize: 8 * Tokens.u
    }
    Label {
        x: Tokens.pad; width: parent.width - 2 * Tokens.pad; y: 82 * Tokens.u
        text: qsTr("Who’s watching?")
        color: Tokens.ink
        font.family: Tokens.family; font.weight: Font.Bold; font.letterSpacing: -2 * Tokens.u; font.pixelSize: 40 * Tokens.u
    }
    Row {
        x: 22 * Tokens.u; y: 170 * Tokens.u
        spacing: 12 * Tokens.u
        Repeater {
            model: Api.profiles
            MouseArea {
                width: 172 * Tokens.u; height: 232 * Tokens.u
                onClicked: {
                    if (modelData.pinLocked && !modelData.active) { pageStack.push(Qt.resolvedUrl("PinPage.qml"), { profile: modelData }); return }
                    Api.selectProfile(modelData.userId)
                    pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"))
                }
                onPressAndHold: remorse.execute(qsTr("Removing profile"), function () { Api.removeProfile(modelData.userId) })
                Avatar {
                    id: av
                    width: parent.width
                    source: modelData.avatar
                    Rectangle { anchors.fill: parent; radius: width / 2; color: "transparent"; border.width: modelData.active ? 4 * Tokens.u : 0; border.color: Tokens.brandPink; opacity: 0.6 }
                }
                Label { anchors { top: av.bottom; topMargin: 12 * Tokens.u; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter; text: modelData.name; elide: Text.ElideRight; color: Tokens.ink
                        font.family: Tokens.family; font.weight: Font.DemiBold; font.pixelSize: 13 * Tokens.u }
                Label { anchors { top: av.bottom; topMargin: 42 * Tokens.u; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter; text: modelData.active ? qsTr("WATCHING NOW") : ""; color: Tokens.inkMuted
                        font.family: Tokens.family; font.letterSpacing: 1 * Tokens.u; font.pixelSize: 7.5 * Tokens.u }
            }
        }
        MouseArea {
            width: 156 * Tokens.u; height: 232 * Tokens.u
            onClicked: pageStack.push(Qt.resolvedUrl("LinkPage.qml"), { adding: true })
            Rectangle {
                id: plus
                width: parent.width; height: width; radius: width / 2
                y: 8 * Tokens.u
                gradient: Gradient { GradientStop { position: 0; color: Qt.rgba(0.45, 0.17, 0.27, 1) } GradientStop { position: 1; color: Qt.rgba(0.62, 0.16, 0.30, 1) } }
                border.width: 1; border.color: Qt.rgba(1, 1, 1, 0.2)
                Label { anchors.centerIn: parent; text: "+"; color: Qt.rgba(1, 1, 1, 0.6); font.pixelSize: 40 * Tokens.u }
            }
            Label { anchors { top: plus.bottom; topMargin: 12 * Tokens.u; left: parent.left; right: parent.right }
                    horizontalAlignment: Text.AlignHCenter; text: qsTr("Sign in"); color: Tokens.inkSoft
                    font.family: Tokens.family; font.weight: Font.DemiBold; font.pixelSize: 13 * Tokens.u }
            Label { anchors { top: plus.bottom; topMargin: 42 * Tokens.u; left: parent.left; right: parent.right }
                    horizontalAlignment: Text.AlignHCenter; text: qsTr("ADD ANOTHER PROFILE"); color: Tokens.inkMuted
                    font.family: Tokens.family; font.letterSpacing: 1 * Tokens.u; font.pixelSize: 7.5 * Tokens.u }
        }
    }
    Row {
        x: 40 * Tokens.u; y: 420 * Tokens.u
        spacing: 10 * Tokens.u
        MouseArea {
            width: 44 * Tokens.u; height: width
            onClicked: page.openSettings()
            Rectangle { anchors.fill: parent; radius: width / 2; color: Tokens.surface; border.width: 1; border.color: Tokens.lineStrong }
            Label { anchors.centerIn: parent; text: "⚙"; color: Tokens.brandPink; font.pixelSize: 20 * Tokens.u }
        }
        MouseArea {
            width: 100 * Tokens.u; height: 44 * Tokens.u
            onClicked: remorse.execute(qsTr("Signing out"), function () { Api.signOut() })
            Rectangle { anchors.fill: parent; radius: height / 2; color: Tokens.surface; border.width: 1; border.color: Tokens.lineStrong }
            Label { anchors.centerIn: parent; text: qsTr("Sign out"); color: Tokens.ink; font.family: Tokens.family; font.weight: Font.DemiBold; font.pixelSize: 9.5 * Tokens.u }
        }
    }
    RemorsePopup { id: remorse }
}
