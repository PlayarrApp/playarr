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
    background: Component { Rectangle { color: Tokens.dark ? "#151315" : "#f5f3f2" } }
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
    readonly property color page_bg: Tokens.dark ? "#151315" : "#f5f3f2"
    Image {
        x: 21 * Tokens.u; y: 20 * Tokens.u
        width: 30 * Tokens.u; height: width
        source: "file:///usr/share/icons/hicolor/86x86/apps/harbour-playarr.png"
        smooth: true
    }
    // Theme and language selects, as on web (the language has no setting on this device, so it only reads "Auto").
    Row {
        anchors { right: parent.right; rightMargin: 14 * Tokens.u }
        y: 14 * Tokens.u
        spacing: 8 * Tokens.u
        Repeater {
            model: 2
            MouseArea {
                id: sel
                property bool navigationFocusable: true
                property string parityLabel: index === 0 ? qsTr("Theme: ") + (Api.themeMode === "system" ? qsTr("Auto") : Api.themeMode === "dark" ? qsTr("Dark") : qsTr("Light")) : qsTr("Language: Auto")
                property string a11yName: index === 0 ? parityLabel : qsTr("Auto")
                property int parityRail: 1
                property int parityIndex: index
                function navigationActivate() { if (index === 0) Api.themeMode = Api.themeMode === "system" ? "dark" : Api.themeMode === "dark" ? "light" : "system" }
                width: selRow.width + 38.8 * Tokens.u; height: 48 * Tokens.u
                onClicked: navigationActivate()
                Rectangle { anchors.fill: parent; color: page.page_bg; border.width: 2; border.color: Tokens.lineStrong }
                Row {
                    id: selRow
                    anchors.centerIn: parent
                    spacing: 9.59 * Tokens.u
                    Image { property string parityRole: "image"; anchors.verticalCenter: parent.verticalCenter; width: 16 * Tokens.u; height: width; sourceSize: Qt.size(64, 64); source: NavIcons.url(index === 0 ? "sun" : "globe", Tokens.inkSoft) }
                    PLabel { renderType: Text.NativeRendering; anchors.verticalCenter: parent.verticalCenter; text: index === 0 ? (Api.themeMode === "system" ? qsTr("Auto") : Api.themeMode === "dark" ? qsTr("Dark") : qsTr("Light")) : qsTr("Auto")
                            color: Tokens.ink; font.family: Tokens.fam(720); font.letterSpacing: -0.15; font.pixelSize: Tokens.fs(11.52);}
                    Image { anchors.verticalCenter: parent.verticalCenter; width: 12 * Tokens.u; height: width; sourceSize: Qt.size(64, 64); source: NavIcons.url("chevron", Tokens.inkSoft) }
                }
            }
        }
    }
    Label { renderType: Text.QtRendering;
        x: -16 * Tokens.u; width: parent.width; y: 71.5 * Tokens.u
        horizontalAlignment: Text.AlignHCenter
        text: qsTr("PROFILES")
        color: Tokens.dark ? Tokens.brandPinkSoft : "#821e36"
       
        font.family: Tokens.fam(820); font.letterSpacing: 2.19; font.pixelSize: Tokens.fs(7.36)
    }
    Label { renderType: Text.QtRendering;
        x: -16 * Tokens.u; width: parent.width; y: 82 * Tokens.u
        horizontalAlignment: Text.AlignHCenter
        text: qsTr("Who’s watching?")
        color: Tokens.ink
        property string parityRole: "heading"
       
        font.family: Tokens.fam(480); font.letterSpacing: -5.78; font.pixelSize: Tokens.fs(42.9)
    }
    Item {
        anchors.fill: parent
        Repeater {
            model: Api.profiles
            MouseArea {
                id: card
                property bool navigationFocusable: true
                property string parityLabel: modelData.name
                property string a11yName: modelData.name + (modelData.active ? qsTr(", current profile") : "")
                // Prefer the signed-in profile, falling back when the saved active id is stale.
                property bool navigationInitialFocus: modelData.active || (!page.hasActiveProfile && index === 0)
                property int parityRail: 0
                property int parityIndex: index
                x: (24.49 + index * 181.51) * Tokens.u; y: 169.42 * Tokens.u
                width: 163.02 * Tokens.u; height: 212.51 * Tokens.u
                function navigationActivate() {
                    if (modelData.pinLocked && !modelData.active) { pageStack.push(Qt.resolvedUrl("PinPage.qml"), { profile: modelData }); return }
                    Api.selectProfile(modelData.userId)
                    pageStack.replaceAbove(null, Qt.resolvedUrl("MainPage.qml"))
                }
                onClicked: navigationActivate()
                onPressAndHold: remorse.execute(qsTr("Removing profile"), function () { Api.removeProfile(modelData.userId) })
                // Dark ring colour as WorkCard (web captures measure 197,138,151); light keeps the brand ink.
                readonly property color ringColor: Tokens.dark ? Qt.rgba(94 / 255, 30 / 255, 46 / 255, 1) : Qt.rgba(216 / 255, 153 / 255, 167 / 255, 1)   // web: 0 0 0 4px brand at 42 %, measured on the static refs
                // Web: the signed-in profile holds the default focus, so its card carries the focused shadow stack (as WorkCard).
                RectangularGlow {   // web .profile-choice.is-selected .profile-avatar: 0 22px 52px rgba(31,14,20,.18)
                    visible: modelData.active
                    x: av.x; y: av.y + 22 * Tokens.u; width: av.width; height: av.width
                    glowRadius: 26 * Tokens.u; spread: 0.1; cornerRadius: width / 2 + glowRadius
                    color: Qt.rgba(31 / 255, 14 / 255, 20 / 255, 0.18)
                }
                Avatar {
                    id: av
                    x: -2.85 * Tokens.u; y: -2.85 * Tokens.u
                    width: 168.73 * Tokens.u
                    source: modelData.avatar
                    // A bundled preset (".../avatars/<id>.png") is drawn natively from its artwork and plate colours.
                    readonly property string presetId: /\/avatars\/[a-z]+\.png$/.test(String(modelData.avatar)) ? String(modelData.avatar).replace(/^.*\/avatars\/([a-z]+)\.png$/, "$1") : ""
                    readonly property var presetColours: ({ astronaut: ["#5267ad", "#222d5f"], cat: ["#e37c68", "#9c3f66"], dinosaur: ["#55a46e", "#237265"],
                                                           robot: ["#5d9caf", "#365383"], pirate: ["#d39a48", "#91464c"], alien: ["#8b71c5", "#4a477f"] })   // clients/shared/profile-avatars/presets.json
                    artSource: presetId !== "" && presetColours[presetId] ? String(modelData.avatar).replace("/avatars/", "/avatar-art/") : ""
                    plateStart: presetId !== "" && presetColours[presetId] ? presetColours[presetId][0] : "#000000"
                    plateEnd: presetId !== "" && presetColours[presetId] ? presetColours[presetId][1] : "#000000"
                    // The plate PNG carries the figure inset by 7.55 %: the web's plate container and its inner picture.
                    // The active ring sits outside the plate, as on web.
                    Rectangle { anchors.fill: parent; anchors.margins: -4 * Tokens.u; radius: width / 2; color: "transparent"; border.width: modelData.active ? 4 * Tokens.u : 0; border.color: ringColor }   // alpha in the colour: item opacity drew a pink square behind the plate
                }
                PLabel { renderType: Text.NativeRendering; anchors { top: av.bottom; topMargin: 5.4 * Tokens.u; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter; text: modelData.name; elide: Text.ElideRight; color: Tokens.ink;
                        font.family: Tokens.fam(680); font.letterSpacing: 0.38; font.pixelSize: Tokens.fs(13.12) }
                PLabel { renderType: Text.NativeRendering; anchors { top: av.bottom; topMargin: 35.9 * Tokens.u; left: parent.left; right: parent.right }
                        horizontalAlignment: Text.AlignHCenter; text: modelData.active ? qsTr("WATCHING NOW") : ""; color: Tokens.dark ? "#c2b5bb" : "#4d4248";
                        font.family: Tokens.fam(680); font.letterSpacing: 1.13; font.pixelSize: Tokens.fs(6.72) }
            }
        }
        MouseArea {
            property bool navigationFocusable: true
            property string parityLabel: qsTr("Add another profile")
            property string a11yName: "+ " + qsTr("Sign in") + " " + qsTr("ADD ANOTHER PROFILE")
            property bool navigationInitialFocus: Api.profiles.length === 0
            property int parityRail: 0
            property int parityIndex: Api.profiles.length
            x: (24.49 + Api.profiles.length * 181.51) * Tokens.u; y: 182 * Tokens.u
            width: 156 * Tokens.u; height: 203.36 * Tokens.u
            function navigationActivate() { pageStack.push(Qt.resolvedUrl("LinkPage.qml"), { adding: true }) }
            onClicked: navigationActivate()
            Rectangle {
                id: plus
                width: parent.width; height: width; radius: width / 2
                y: 0
                gradient: Gradient {
                    GradientStop { position: 0; color: Tokens.dark ? "#6a2c42" : "#eec4cd" }
                    GradientStop { position: 1; color: Tokens.dark ? "#962a4e" : "#b84b6b" }
                }
                Canvas {   // web: .profile-add .profile-avatar draws its 1 px border dashed
                    anchors.fill: parent
                    renderTarget: Canvas.Image
                    property color tint: Qt.rgba(Tokens.lineStrong.r, Tokens.lineStrong.g, Tokens.lineStrong.b, Tokens.lineStrong.a * 0.66)
                    onTintChanged: requestPaint()
                    onWidthChanged: requestPaint()
                    onPaint: {
                        var ctx = getContext("2d"), w = Math.max(1, Tokens.u), r = (width - w) / 2, c = width / 2
                        var dash = 3 * Tokens.u / r, period = 5 * Tokens.u / r
                        ctx.clearRect(0, 0, width, height)
                        ctx.strokeStyle = tint; ctx.lineWidth = w
                        // dashes drawn as separate arcs: Qt 5.6 Context2D has no portable setLineDash
                        for (var a = -Math.PI / 2; a < 1.5 * Math.PI - 0.001; a += period) {
                            ctx.beginPath(); ctx.arc(c, c, r, a, Math.min(a + dash, 1.5 * Math.PI), false); ctx.stroke()
                        }
                    }
                }
                RadialGradient {   // web: a soft light spot up and left of centre
                    x: 0.30 * parent.width - width / 2; y: 0.26 * parent.width - height / 2
                    width: 0.5 * parent.width; height: width; horizontalRadius: width / 2; verticalRadius: height / 2
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: Qt.rgba(1, 1, 1, Tokens.dark ? 0.22 : 0.18) }
                        GradientStop { position: 1.0; color: Qt.rgba(1, 1, 1, 0) }
                    }
                }
                PLabel { renderType: Text.NativeRendering; anchors.centerIn: parent; text: "+"; color: Tokens.dark ? "#cdc1c6" : "#443a40"; font.family: Tokens.fam(300); font.pixelSize: Tokens.fs(38.4) }
            }
            PLabel { renderType: Text.NativeRendering; anchors { top: plus.bottom; topMargin: 8.8 * Tokens.u; left: parent.left; right: parent.right }
                    horizontalAlignment: Text.AlignHCenter; text: qsTr("Sign in"); color: Tokens.dark ? "#cdc1c6" : "#443a40";
                    font.family: Tokens.fam(680); font.pixelSize: Tokens.fs(13.12) }
            PLabel { renderType: Text.NativeRendering; anchors { top: plus.bottom; topMargin: 37.1 * Tokens.u; left: parent.left; right: parent.right }
                    horizontalAlignment: Text.AlignHCenter; text: qsTr("ADD ANOTHER PROFILE"); color: Tokens.dark ? "#c2b5bb" : "#4d4248";
                    font.family: Tokens.fam(680); font.letterSpacing: 0.76; font.pixelSize: Tokens.fs(6.72) }
        }
    }
    Row {
        x: 35.03 * Tokens.u; y: 405.36 * Tokens.u
        spacing: 8.8 * Tokens.u
        MouseArea {
            property bool navigationFocusable: true
            property string parityLabel: qsTr("Settings")
            property string a11yName: qsTr("%1 settings").arg(Api.profileName)
            property int parityRail: 1
            property int parityIndex: 0
            width: 44 * Tokens.u; height: width
            function navigationActivate() { page.openSettings() }
            onClicked: navigationActivate()
            Rectangle { anchors.fill: parent; radius: width / 2; color: Tokens.dark ? "#1d191d" : "#fbfbfa"; border.width: 1; border.color: Tokens.lineStrong }
            Image { anchors.centerIn: parent; width: 18 * Tokens.u; height: width; sourceSize: Qt.size(64, 64); source: NavIcons.url("settings", Tokens.brandPink) }
        }
        PillButton {
            parityRail: 1
            parityIndex: 1
            a11yName: qsTr("Sign out %1").arg(Api.profileName)
            navigationActivate: function() { remorse.execute(qsTr("Signing out"), function () { Api.signOut() }) }
            iconImage: NavIcons.url("logout", Tokens.ink); iconSize: 18 * Tokens.u; labelFamily: Tokens.fam(720)
            text: qsTr("Sign out"); labelSpacing: 0.1; contentGap: 7.2; padCss: 17; textInk: Tokens.dark ? "#cdc1c6" : "#443a40"
            fontSize: Tokens.fs(7.68)
            implicitHeight: 44 * Tokens.u
            onClicked: navigationActivate()
        }
    }
    // The web profiles page pins a Clients link 22 px from the bottom right corner.
    MouseArea {
        id: clients
        property string a11yName: qsTr("Clients")
        property string parityRole: "link"
        anchors { right: parent.right; rightMargin: 22 * Tokens.u; bottom: parent.bottom; bottomMargin: 22 * Tokens.u }
        width: 75.5 * Tokens.u; height: 43.7 * Tokens.u
        onClicked: Qt.openUrlExternally("https://playarr.app/clients")
        RectangularGlow { y: 14 * Tokens.u; width: parent.width; height: parent.height; glowRadius: 19 * Tokens.u; spread: 0.05; cornerRadius: height / 2 + glowRadius; color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.12) }
        Rectangle { id: clientsBg; anchors.fill: parent; radius: height / 2; color: Tokens.dark ? "#1e1a1e" : "#fcfcfb"; border.width: 1; border.color: Tokens.line }
        PLabel { id: clientsLbl; property string parityRole: "link"; renderType: Text.NativeRendering; x: 16.95 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; anchors.verticalCenterOffset: 0; text: qsTr("Clients")
                color: Tokens.dark ? "#cdc1c6" : "#443a40"; font.family: Tokens.fam(720); font.pixelSize: Tokens.fs(7.68) }
        PLabel { renderType: Text.NativeRendering; x: 50.83 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; anchors.verticalCenterOffset: 0; text: "\u2192"
               
                color: Tokens.dark ? "#cdc1c6" : "#443a40"; font.family: Tokens.fam(720) + ",Liberation Sans"; font.pixelSize: Tokens.fs(7.68) }
    }
    RemorsePopup { id: remorse }
}
