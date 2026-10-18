import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"
import "../components/Qr.js" as Qr

// The calendar feed panel the web opens from the bell: the viewer's private iCal link with Copy, a QR code and the
// Google / Apple / Outlook steps, and Reset link (after a confirmation) to replace it. The server only returns the URL
// when it is created, so this device remembers it per server and profile, as the web does.
PlayarrPage {
    id: page
    readonly property real gut: 20.3 * Tokens.u
    readonly property string storeKey: "cal.link." + Api.serverUrl + "|" + Api.profileId
    property string url: Api.setting(storeKey, "")
    property bool busy: true
    property bool needsReset: false
    property bool confirming: false
    property bool copied: false
    property string failure: ""
    property var qr: url !== "" ? Qr.encode(url) : []

    function remember(link) { url = link; Api.setSetting(storeKey, link); needsReset = false; confirming = false; copied = false }
    function fail(status) {
        failure = status === 401 || status === 403 ? qsTr("Your sign-in has expired. Sign in again to get your calendar link.")
                : status === 404 || status === 405 || status === 501 ? qsTr("This server version does not support calendar links yet. Ask your server admin to update Playarr Server.")
                : status === 0 ? qsTr("Could not reach your Playarr server. Check your connection and that the server is online, then try again.")
                : qsTr("Something went wrong getting your calendar link. Try again.")
    }
    // One status call, then at most one POST that never replaces an existing link.
    function open() {
        busy = true; failure = ""
        Api.request("GET", "/api/v1/calendar/feed", null, function (st, status) {
            if (st !== 200 || !status) { busy = false; fail(st); return }
            if (!status.active || status.link_available === true) {
                Api.request("POST", "/api/v1/calendar/feed", null, function (st2, made) {
                    busy = false
                    if ((st2 === 200 || st2 === 201) && made && made.url) remember(made.url); else fail(st2)
                })
            } else { busy = false; needsReset = url === "" }
        })
    }
    function reset() {
        busy = true; failure = ""
        Api.request("POST", "/api/v1/calendar/feed?rotate=true", null, function (st, made) {
            busy = false
            if ((st === 200 || st === 201) && made && made.url) remember(made.url); else fail(st)
        })
    }
    Component.onCompleted: open()

    SilicaFlickable {
        id: flick
        anchors { fill: parent; bottomMargin: 106 * Tokens.u }
        contentHeight: body.y + body.height + 24 * Tokens.u
        clip: true
        Label { x: page.gut; y: 19 * Tokens.u; text: qsTr("CALENDAR"); color: Tokens.inkSoft; font.family: Tokens.family820; font.pixelSize: 6.6 * Tokens.u; font.letterSpacing: 1 * Tokens.u }
        Label { x: page.gut; y: 35.5 * Tokens.u; text: qsTr("Calendar link"); color: Tokens.ink; font.family: Tokens.family580; font.pixelSize: 21.5 * Tokens.u; font.letterSpacing: -1 * Tokens.u }
        MouseArea {
            x: parent.width - page.gut - width; y: 20 * Tokens.u
            width: 43.7 * Tokens.u; height: width
            onClicked: pageStack.pop()
            Rectangle { anchors.fill: parent; radius: width / 2; color: Tokens.dark ? Tokens.surfaceStrong : "#e6e4e5"; border.width: 1; border.color: Tokens.lineStrong }
            Label { anchors.centerIn: parent; text: "✕"; color: Tokens.ink; font.family: Tokens.family820; font.pixelSize: 10 * Tokens.u }
        }
        Column {
            id: body
            x: page.gut; y: 92 * Tokens.u
            width: flick.width - 2 * page.gut
            spacing: 11 * Tokens.u
            Label {
                width: parent.width; wrapMode: Text.Wrap; lineHeight: 1.0
                text: qsTr("Add your releases to Google, Apple or Outlook Calendar with this private link. Anyone with the link can see your releases, so keep it secret.")
                color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; bottomPadding: 2.5 * Tokens.u
            }
            Label {
                visible: page.failure !== ""; width: parent.width; wrapMode: Text.Wrap
                text: page.failure; color: Tokens.danger; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u
            }
            PillButton {
                visible: page.failure !== ""; text: qsTr("Try again"); labelFamily: Tokens.family610; fontSize: 10.5 * Tokens.u
                implicitHeight: 36 * Tokens.u; onClicked: page.open()
            }
            Label {
                visible: page.busy && page.url === ""; text: qsTr("Getting your link…")
                color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u
            }
            Item {
                visible: page.url !== ""; width: parent.width; height: 43 * Tokens.u
                Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.dark ? "#1e1b1e" : Tokens.surface; border.width: 1; border.color: Tokens.lineStrong }
                Label {
                    x: 13 * Tokens.u; width: parent.width - 18 * Tokens.u; anchors.verticalCenter: parent.verticalCenter
                    text: page.url; clip: true; wrapMode: Text.NoWrap
                    color: Tokens.ink; font.family: "monospace"; font.pixelSize: 14.2 * Tokens.u
                }
                TextField { id: urlField; width: 1; height: 1; opacity: 0; readOnly: true; text: page.url }
            }
            PillButton {
                visible: page.url !== ""
                text: page.copied ? qsTr("Copied") : qsTr("Copy link")
                labelFamily: Tokens.family820; fontSize: 10.8 * Tokens.u; implicitHeight: 43.7 * Tokens.u; implicitWidth: 92 * Tokens.u
                fill: Tokens.dark ? "#dfdcdd" : "#4d4248"; fillInk: Tokens.dark ? "#211d21" : "#ffffff"
                onClicked: { urlField.selectAll(); urlField.copy(); urlField.deselect(); page.copied = true }
            }
            Item {   // web: the code sits 3 px closer to Copy link and 1 px further from the steps heading
                visible: page.url !== ""; width: 240 * Tokens.u; height: width - 2
              Rectangle {
                y: -3; width: 240 * Tokens.u; height: width; radius: 14 * Tokens.u; color: "#ffffff"
                Canvas {
                    id: qrCanvas
                    anchors { fill: parent; margins: 20 * Tokens.u }
                    renderTarget: Canvas.Image
                    onPaint: {
                        var m = page.qr, ctx = getContext("2d")
                        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height)
                        if (m.length === 0) return
                        var s = width / m.length
                        ctx.fillStyle = "#000000"
                        for (var y = 0; y < m.length; ++y) for (var x = 0; x < m.length; ++x)
                            if (m[y][x]) ctx.fillRect(Math.floor(x * s), Math.floor(y * s), Math.ceil(s), Math.ceil(s))
                    }
                    Connections { target: page; onQrChanged: qrCanvas.requestPaint() }
                }
              }
            }
            Label { visible: page.needsReset && page.url === ""; width: parent.width; wrapMode: Text.Wrap
                text: qsTr("Your link was created on another device and is not stored here. Reset it to get a new link to copy.")
                color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
            Label { text: qsTr("ADD IT TO YOUR CALENDAR APP"); color: Tokens.inkSoft; font.family: Tokens.family820; font.pixelSize: 6.6 * Tokens.u; font.letterSpacing: 1 * Tokens.u; topPadding: 0; bottomPadding: 2 * Tokens.u }
            Column {
              spacing: 8.25 * Tokens.u
              Repeater {
                model: [ qsTr("Google Calendar: Other calendars (+) > From URL, then paste the link."),
                         qsTr("Apple Calendar: File > New Calendar Subscription, then paste the link."),
                         qsTr("Outlook: Add calendar > Subscribe from web, then paste the link.") ]
                Row {
                    spacing: 11 * Tokens.u; x: 4 * Tokens.u; width: body.width - 4 * Tokens.u   // web list indent
                    Label { text: "•"; color: Tokens.ink; font.pixelSize: 10 * Tokens.u }
                    Label { width: parent.width - 20 * Tokens.u; wrapMode: Text.Wrap; text: modelData; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                }
              }
            }
            Label {
                visible: page.confirming; width: parent.width; wrapMode: Text.Wrap
                text: qsTr("Resetting makes a new link and the current link stops working straight away. Calendars using it will need the new link.")
                color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u
            }
            Row {
                spacing: 8 * Tokens.u; visible: page.url !== "" || page.needsReset
                PillButton { visible: !page.confirming; text: qsTr("Reset link"); labelFamily: Tokens.family610; fontSize: 10.5 * Tokens.u; implicitHeight: 40 * Tokens.u; onClicked: page.confirming = true }
                PillButton { visible: page.confirming; primary: true; text: qsTr("Reset link"); labelFamily: Tokens.family610; fontSize: 10.5 * Tokens.u; implicitHeight: 40 * Tokens.u; enabled: !page.busy; onClicked: page.reset() }
                PillButton { visible: page.confirming; text: qsTr("Cancel"); labelFamily: Tokens.family610; fontSize: 10.5 * Tokens.u; implicitHeight: 40 * Tokens.u; onClicked: page.confirming = false }
            }
        }
        VerticalScrollDecorator {}
    }
    Rectangle {   // the web's panel fades its scrolled content out above the bar
        anchors { left: parent.left; right: parent.right; bottom: flick.bottom }
        height: 24 * Tokens.u
        gradient: Gradient { GradientStop { position: 0; color: "transparent" } GradientStop { position: 1; color: Tokens.surface } }
    }
    NavBar {
        blurSource: flick
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: 10 * Tokens.u; rightMargin: 10 * Tokens.u; bottomMargin: 7 * Tokens.u }
        section: ""
        onSelected: {
            var mp = pageStack.find(function (p) { return p.objectName === "main" })
            if (mp) { mp.section = target; pageStack.pop(mp) }
        }
        onProfileClicked: pageStack.push(Qt.resolvedUrl("ProfilesPage.qml"))
    }
}
