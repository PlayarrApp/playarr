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
    // Web's search field: a white pill with a hairline border and a soft shadow (global.css search input); the static touch refs show no focus ring at rest.
    Item {
        id: field
        property alias text: input.text
        x: Tokens.pad; y: 89.4 * Tokens.u
        width: parent.width - 2 * Tokens.pad; height: 60.4 * Tokens.u
        RectangularGlow {   // web card shadow under the field: a wide, low soft shadow
            y: 22 * Tokens.u; width: parent.width; height: parent.height
            glowRadius: 26 * Tokens.u; spread: 0.05; cornerRadius: height / 2 + glowRadius
            color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, Tokens.dark ? 0.3 : 0.16)
        }
        Rectangle { anchors.fill: parent; radius: height / 2; color: Tokens.surfaceStrong; border.width: 1 * Tokens.u; border.color: Tokens.lineStrong }
        Image { x: 15.5 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; width: 17.5 * Tokens.u; height: width; sourceSize: Qt.size(64, 64); source: NavIcons.url("search", Tokens.ink) }
        TextInput {
            id: input
            property bool navigationFocusable: true
            property bool navigationInitialFocus: true
            property bool navigationNavUp: true
            property string parityLabel: input.text || qsTr("Search")
            anchors { left: parent.left; leftMargin: 42 * Tokens.u; right: parent.right; rightMargin: 18 * Tokens.u; verticalCenter: parent.verticalCenter }
            color: Tokens.ink; selectionColor: Tokens.brandPink; font.family: Tokens.family610; font.pixelSize: 16.6 * Tokens.u
            inputMethodHints: Qt.ImhNoPredictiveText
            // D-pad focus rests on the field without the on-screen keyboard or a caret; Enter or a tap starts editing.
            property bool editing: false
            readOnly: !editing
            cursorVisible: editing && activeFocus
            onActiveFocusChanged: if (!activeFocus) editing = false
            Keys.onReturnPressed: { if (!editing) { editing = true; Qt.inputMethod.show() } else event.accepted = false }
            Keys.onEscapePressed: { if (editing) { editing = false; Qt.inputMethod.hide() } else event.accepted = false }
            Keys.onEnterPressed: { if (!editing) { editing = true; Qt.inputMethod.show() } else event.accepted = false }
            MouseArea { anchors.fill: parent; enabled: !input.editing; onClicked: { input.editing = true; input.forceActiveFocus(); Qt.inputMethod.show() } }
            EnterKey.iconSource: "image://theme/icon-m-enter-close"
            EnterKey.onClicked: focus = false
            onTextChanged: debounce.restart()
            Label { renderType: Text.NativeRendering; visible: input.text === ""; text: qsTr("Search your libraries and playlists"); color: Tokens.inkSoft; font: input.font; width: parent.width; elide: Text.ElideRight }
        }
    }
    MouseArea {   // web: the Filters button at the end of the header row, as on the library pages
        id: filterBtn
        anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: head.verticalCenter }
        width: 43.7 * Tokens.u; height: width
        onClicked: pageStack.push(Qt.resolvedUrl("FiltersPage.qml"))
        Rectangle { anchors.fill: parent; radius: 11 * Tokens.u; color: Tokens.dark ? "transparent" : Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: filterBtn.pressed ? 0.5 : 1 }
        Image { anchors.centerIn: parent; width: 16.8 * Tokens.u; height: width; sourceSize: Qt.size(64, 64); opacity: 0.8; source: NavIcons.url("filter", Tokens.ink) }
    }
    // Web TvEmptyState (graphic search, "Start typing to search."): a round plate with the magnifier-minus drawing and the title beside it.
    Item {
        id: idle
        visible: root.works.length === 0 && !root.busy && field.text.trim().length < 2
        x: Tokens.pad; y: field.y + field.height + 19.8 * Tokens.u
        width: parent.width - 2 * Tokens.pad; height: 85 * Tokens.u
        Rectangle {
            id: plate
            width: 85 * Tokens.u; height: width; radius: width / 2
            color: Qt.rgba(Tokens.surfaceStrong.r, Tokens.surfaceStrong.g, Tokens.surfaceStrong.b, 0.54)
            border.width: 1; border.color: Qt.rgba(Tokens.lineStrong.r, Tokens.lineStrong.g, Tokens.lineStrong.b, Tokens.lineStrong.a * 0.5)
            Canvas {   // the web's 48 x 32 viewBox drawing, 34 css px wide, 1.8 stroke
                width: 34 * Tokens.u; height: 22.7 * Tokens.u
                anchors.centerIn: parent
                property color ink: Tokens.dark ? "#d65a78" : "#ae2e4a"
                onInkChanged: requestPaint()
                onPaint: {
                    var c = getContext("2d"), k = width / 48; c.clearRect(0, 0, width, height); c.scale(k, k)
                    c.strokeStyle = ink; c.lineWidth = 1.8; c.lineCap = "round"
                    c.beginPath(); c.arc(21, 14, 9, 0, 2 * Math.PI); c.stroke()
                    c.beginPath(); c.moveTo(28, 21); c.lineTo(37, 29); c.moveTo(17, 14); c.lineTo(25, 14); c.stroke()
                }
            }
        }
        Label { renderType: Text.NativeRendering
            anchors { left: plate.right; leftMargin: 22.3 * Tokens.u; verticalCenter: plate.verticalCenter }
            text: qsTr("Start typing to search."); color: Tokens.ink
            font.family: Tokens.family610; font.pixelSize: 11.52 * Tokens.u; font.letterSpacing: -0.23 * Tokens.u
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
