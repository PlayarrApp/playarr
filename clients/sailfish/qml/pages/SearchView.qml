import QtQuick 2.6
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0
import "../components"
import "../components/NavIcons.js" as NavIcons

Item {
    id: root
    property var works: []
    property bool busy: false
    property string pending: ""
    signal opened(var work)
    signal goHome()

    Timer {
        id: debounce
        interval: 350
        onTriggered: root.run(field.text)
    }
    function run(q) {
        q = q.trim()
        if (q.length < 2) { works = []; busy = false; return }
        busy = true
        pending = q
        Api.request("GET", "/api/v1/catalog/search?limit=25&q=" + encodeURIComponent(q), null, function (status, data) {
            if (q !== pending) return
            busy = false
            works = (status === 200 && data) ? data.items : []
        })
    }

    PageTitle { id: head; y: 4 * Tokens.u; title: qsTr("Search"); onBackClicked: root.goHome() }
    // Web's search field: a white pill with a hairline border, a soft shadow and the focus ring at rest (global.css search input).
    Item {
        id: field
        property alias text: input.text
        x: Tokens.pad; y: 89.4 * Tokens.u
        width: parent.width - 2 * Tokens.pad; height: 60.4 * Tokens.u
        RectangularGlow {   // web card shadow under the field
            y: 10 * Tokens.u; width: parent.width; height: parent.height
            glowRadius: 10 * Tokens.u; spread: 0.1; cornerRadius: height / 2 + glowRadius
            color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, Tokens.dark ? 0.3 : 0.14)
        }
        Rectangle { anchors.fill: parent; radius: height / 2; color: Tokens.surfaceStrong; border.width: 1 * Tokens.u; border.color: Tokens.lineStrong }
        Rectangle {   // rest focus ring: 2 px, 3 css px off the box (mobile web), ink in light and white in dark
            anchors { fill: parent; margins: -4 * Tokens.u }
            radius: height / 2; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.dark ? "#ffffff" : Tokens.ink
        }
        Image { x: 18 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; width: 14 * Tokens.u; height: width; sourceSize: Qt.size(48, 48); source: NavIcons.url("search", Tokens.ink) }
        TextInput {
            id: input
            property bool navigationFocusable: true
            property bool navigationInitialFocus: true
            property string parityLabel: input.text || qsTr("Search")
            anchors { left: parent.left; leftMargin: 42 * Tokens.u; right: parent.right; rightMargin: 18 * Tokens.u; verticalCenter: parent.verticalCenter }
            color: Tokens.ink; selectionColor: Tokens.brandPink; font.family: Tokens.family; font.pixelSize: 13.2 * Tokens.u
            inputMethodHints: Qt.ImhNoPredictiveText
            // D-pad focus rests on the field without the on-screen keyboard or a caret; Enter or a tap starts editing.
            property bool editing: false
            readOnly: !editing
            cursorVisible: editing && activeFocus
            onActiveFocusChanged: if (!activeFocus) editing = false
            Keys.onReturnPressed: { if (!editing) { editing = true; Qt.inputMethod.show() } else event.accepted = false }
            Keys.onEnterPressed: { if (!editing) { editing = true; Qt.inputMethod.show() } else event.accepted = false }
            MouseArea { anchors.fill: parent; enabled: !input.editing; onClicked: { input.editing = true; input.forceActiveFocus(); Qt.inputMethod.show() } }
            EnterKey.iconSource: "image://theme/icon-m-enter-close"
            EnterKey.onClicked: focus = false
            onTextChanged: debounce.restart()
            Label { visible: input.text === ""; text: qsTr("Search your libraries and playlists"); color: Tokens.inkSoft; font: input.font; width: parent.width; elide: Text.ElideRight }
        }
    }
    WorkGrid {
        anchors { top: field.bottom; topMargin: 12 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        works: root.works
        done: true
        bottomMargin: 100 * Tokens.u
        onOpened: root.opened(work)
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
}
