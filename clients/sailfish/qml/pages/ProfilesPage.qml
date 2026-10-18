import QtQuick 2.6
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0
import "../components"
import "../components/NavIcons.js" as NavIcons

// "Who's watching?": the profiles signed in on this device, add-another, settings and sign out.
PlayarrPage {
    id: page
    objectName: "profiles"
    readonly property bool hasActiveProfile: {
        var profiles = Api.profiles
        for (var i = 0; i < profiles.length; ++i) if (profiles[i].active) return true
        return false
    }
    // The web profiles page sits on the darker shell colour with a faint brand glow behind the profiles.
    background: Component { Rectangle { color: Tokens.dark ? "#141214" : "#f5f3f2" } }
    RadialGradient {
        x: parent.width / 2 - width / 2; y: 0.48 * parent.height - height / 2
        width: 2 * 271 / 1.969 * Tokens.u; height: width
        horizontalRadius: width / 2; verticalRadius: height / 2   // the default radius is the full box, which left a visible square
        gradient: Gradient {
            GradientStop { position: 0.0; color: Qt.rgba(0xcf / 255, 0x31 / 255, 0x57 / 255, 0.13) }
            GradientStop { position: 1.0; color: Qt.rgba(0xcf / 255, 0x31 / 255, 0x57 / 255, 0) }
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
            property bool navigationFocusable: true
            property string parityLabel: index === 0 ? qsTr("Theme: ") + (Api.themeMode === "system" ? qsTr("Auto") : Api.themeMode === "dark" ? qsTr("Dark") : qsTr("Light")) : qsTr("Language: Auto")
            property int parityRail: 1
            property int parityIndex: index
            function navigationActivate() { if (index === 0) Api.themeMode = Api.themeMode === "system" ? "dark" : Api.themeMode === "dark" ? "light" : "system" }
            x: (index === 0 ? 144.2 : 264.1) * Tokens.u
            y: 14.2 * Tokens.u
            width: 111.7 * Tokens.u; height: 47.2 * Tokens.u
            onClicked: navigationActivate()
            Rectangle { anchors.fill: parent; color: Tokens.dark ? "#161416" : "#f4f2f1"; border.width: 1; border.color: Tokens.lineStrong }
            Row {
                anchors.centerIn: parent
                spacing: 9 * Tokens.u
                Image { anchors.verticalCenter: parent.verticalCenter; width: 14 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); source: NavIcons.url(index === 0 ? "sun" : "globe", Tokens.inkSoft) }
                Label { anchors.verticalCenter: parent.verticalCenter; text: index === 0 ? (Api.themeMode === "system" ? qsTr("Auto") : Api.themeMode === "dark" ? qsTr("Dark") : qsTr("Light")) : qsTr("Auto"); color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 11.5 * Tokens.u }
                Image { anchors.verticalCenter: parent.verticalCenter; width: 11 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); source: NavIcons.url("chevron", Tokens.inkSoft) }
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
                property bool navigationFocusable: true
                property string parityLabel: modelData.name
                // Prefer the signed-in profile, falling back when the saved active id is stale.
                property bool navigationInitialFocus: modelData.active || (!page.hasActiveProfile && index === 0)
                property int parityRail: 0
                property int parityIndex: index
                width: 177 * Tokens.u; height: 232 * Tokens.u
                function navigationActivate() {
                    if (modelData.pinLocked && !modelData.active) { pageStack.push(Qt.resolvedUrl("PinPage.qml"), { profile: modelData }); return }
                    Api.selectProfile(modelData.userId)
                    pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"))
                }
                onClicked: navigationActivate()
                onPressAndHold: remorse.execute(qsTr("Removing profile"), function () { Api.removeProfile(modelData.userId) })
                // Dark ring colour as WorkCard (web captures measure 197,138,151); light keeps the brand ink.
                readonly property color ringColor: Tokens.dark ? Qt.rgba(197 / 255, 138 / 255, 151 / 255, 1) : Tokens.brandInk
                // Web: the signed-in profile holds the default focus, so its card carries the focused shadow stack (as WorkCard).
                RectangularGlow {
                    visible: modelData.active
                    x: av.x; y: av.y + 24 * Tokens.u; width: av.width; height: av.width
                    glowRadius: 24 * Tokens.u; spread: 0.1; cornerRadius: width / 2 + glowRadius
                    color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.3)
                }
                RectangularGlow {
                    visible: modelData.active
                    x: av.x; y: av.y + 10 * Tokens.u; width: av.width; height: av.width
                    glowRadius: 10 * Tokens.u; spread: 0.1; cornerRadius: width / 2 + glowRadius
                    color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.2)
                }
                RectangularGlow {   // the ring's own glow as WorkCard: 0 0 20px 4px at 45 %; dark only, light scored lower with it
                    visible: modelData.active && Tokens.dark
                    x: av.x; y: av.y; width: av.width; height: av.width
                    glowRadius: 10 * Tokens.u; spread: 0.25; cornerRadius: width / 2 + glowRadius
                    color: Qt.rgba(ringColor.r, ringColor.g, ringColor.b, 0.45)
                }
                Avatar {
                    id: av
                    y: 4 * Tokens.u; anchors.horizontalCenter: parent.horizontalCenter
                    width: 168.6 * Tokens.u
                    source: modelData.avatar
                    // The active ring sits outside the plate, as on web.
                    Rectangle { anchors.fill: parent; anchors.margins: -4 * Tokens.u; radius: width / 2; color: "transparent"; border.width: modelData.active ? 4 * Tokens.u : 0; border.color: ringColor }   // alpha in the colour: item opacity drew a pink square behind the plate
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
            property bool navigationFocusable: true
            property string parityLabel: qsTr("Add another profile")
            property bool navigationInitialFocus: Api.profiles.length === 0
            property int parityRail: 0
            property int parityIndex: Api.profiles.length
            width: 155.4 * Tokens.u; height: 232 * Tokens.u
            function navigationActivate() { pageStack.push(Qt.resolvedUrl("LinkPage.qml"), { adding: true }) }
            onClicked: navigationActivate()
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
            property bool navigationFocusable: true
            property string parityLabel: qsTr("Settings")
            property int parityRail: 1
            property int parityIndex: 0
            width: 43.7 * Tokens.u; height: width
            function navigationActivate() { page.openSettings() }
            onClicked: navigationActivate()
            Rectangle { anchors.fill: parent; radius: width / 2; color: Tokens.dark ? "#1a181a" : "#fdfcfc"; border.width: 1; border.color: Tokens.lineStrong }
            Image { anchors.centerIn: parent; width: 16 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); source: NavIcons.url("settings", Tokens.brandPink) }
        }
        PillButton {
            parityRail: 1
            parityIndex: 1
            navigationActivate: function() { remorse.execute(qsTr("Signing out"), function () { Api.signOut() }) }
            iconImage: NavIcons.url("logout", Tokens.ink); iconSize: 14 * Tokens.u; labelFamily: Tokens.family610
            text: qsTr("Sign out")
            fontSize: 8.8 * Tokens.u
            implicitHeight: 43.7 * Tokens.u
            onClicked: navigationActivate()
        }
    }
    // The web profiles page pins a Clients link 22 px from the bottom right corner.
    PillButton {
        anchors { right: parent.right; rightMargin: 22 * Tokens.u; bottom: parent.bottom; bottomMargin: 22 * Tokens.u }
        labelFamily: Tokens.family610; fontSize: 7.3 * Tokens.u; implicitWidth: 75.5 * Tokens.u; implicitHeight: 43.7 * Tokens.u; lift: true
        text: qsTr("Clients") + "  \u2192"
        onClicked: Qt.openUrlExternally("https://playarr.app/clients")
    }
    RemorsePopup { id: remorse }
}
