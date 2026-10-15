import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Library controls (web's Filters page): view, sort, order and language filters, saved on this device.
PlayarrPage {
    id: page
    signal applied()
    property bool calendar: false
    property string calMode: Api.setting("cal.mode", "agenda")
    property string view: Api.setting("lib.view", "screen")
    property string sort: Api.setting("lib.sort", "title")
    property string order: Api.setting("lib.order", sort === "title" ? "asc" : "desc")
    property string audio: Api.setting("lib.audio", "")
    property string subs: Api.setting("lib.subs", "")
    readonly property var languages: [ { id: "", label: qsTr("Any language") }, { id: "en", label: "English" }, { id: "th", label: "\u0E44\u0E17\u0E22" },
                                       { id: "ja", label: "\u65E5\u672C\u8A9E" }, { id: "de", label: "Deutsch" }, { id: "fr", label: "Fran\u00E7ais" }, { id: "es", label: "Espa\u00F1ol" } ]

    function set(key, value) { Api.setSetting("lib." + key, value); applied() }

    readonly property real gut: 20.3 * Tokens.u
    readonly property color chip: Tokens.dark ? Tokens.surfaceStrong : "#e6e4e5"   // web light controls are grey, not white
    property string openSelect: ""     // "audio" or "subs": the language list that is expanded

    SilicaFlickable {
        id: flick
        anchors.fill: parent
        contentHeight: 560 * Tokens.u + (page.openSelect !== "" ? page.languages.length * 40 * Tokens.u : 0)
        clip: true
        // Section caption.
        Repeater {
            model: page.calendar ? [ { t: qsTr("VIEW"), y: 97.5 } ] : [ { t: qsTr("VIEW"), y: 97.5 }, { t: qsTr("SORT BY"), y: 190 }, { t: qsTr("ORDER"), y: 282 }, { t: qsTr("AUDIO LANGUAGE"), y: 375 }, { t: qsTr("SUBTITLE LANGUAGE"), y: 478 + (page.openSelect === "audio" ? page.languages.length * 40 : 0) } ]
            Label { x: page.gut; y: (modelData.y - 5) * Tokens.u; text: modelData.t; color: Tokens.inkSoft; font.family: Tokens.family820; font.pixelSize: 6.6 * Tokens.u; font.letterSpacing: 1 * Tokens.u }
        }
        Label { x: page.gut; y: 19 * Tokens.u; text: page.calendar ? qsTr("CALENDAR CONTROLS") : qsTr("LIBRARY CONTROLS"); color: Tokens.inkSoft; font.family: Tokens.family820; font.pixelSize: 6.6 * Tokens.u; font.letterSpacing: 1 * Tokens.u }
        Label { x: page.gut; y: 33 * Tokens.u; text: qsTr("Filters"); color: Tokens.ink; font.family: Tokens.family580; font.pixelSize: 21.5 * Tokens.u; font.letterSpacing: -1 * Tokens.u }
        MouseArea {
            x: parent.width - page.gut - width; y: 20 * Tokens.u
            width: 43.7 * Tokens.u; height: width
            onClicked: pageStack.pop()
            Rectangle { anchors.fill: parent; radius: width / 2; color: page.chip; border.width: 1; border.color: Tokens.lineStrong }
            Rectangle {   // web: the drawer's close button takes the focus on open, so it holds the ring (2 px, 3 css px off)
                anchors { fill: parent; margins: -4 * Tokens.u }
                radius: width / 2; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.dark ? "#ffffff" : Tokens.ink
            }
            Label { anchors.centerIn: parent; text: "\u2715"; color: Tokens.ink; font.family: Tokens.family820; font.pixelSize: 10 * Tokens.u }
        }
        // View: icon over label.
        Row {
            x: page.gut; y: 116 * Tokens.u
            spacing: 7.1 * Tokens.u
            Repeater {
                model: page.calendar ? [ { id: "month", label: qsTr("Month") }, { id: "week", label: qsTr("Week") }, { id: "agenda", label: qsTr("Agenda") } ]
                                     : [ { id: "list", label: qsTr("List") }, { id: "screen", label: qsTr("Screen") }, { id: "cover", label: qsTr("Cover") } ]
                MouseArea {
                    readonly property bool active: (page.calendar ? page.calMode : page.view) === modelData.id
                    width: (flick.width - 2 * page.gut - 14.2 * Tokens.u) / 3; height: 47.3 * Tokens.u
                    onClicked: {
                        if (page.calendar) { page.calMode = modelData.id; Api.setSetting("cal.mode", modelData.id); page.applied() }
                        else { page.view = modelData.id; page.set("view", modelData.id) }
                    }
                    Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: parent.active ? Tokens.primary : page.chip; border.width: parent.active ? 0 : 1; border.color: Tokens.line }
                    Column {
                        anchors.centerIn: parent
                        spacing: 2 * Tokens.u
                        Item {
                            anchors.horizontalCenter: parent.horizontalCenter
                            readonly property string kind: modelData.id === "list" || modelData.id === "agenda" ? "list" : modelData.id === "cover" || modelData.id === "week" ? "tall" : "wide"
                            width: 18 * Tokens.u; height: kind === "tall" ? 13 * Tokens.u : kind === "list" ? 11 * Tokens.u : 6 * Tokens.u
                            Repeater {
                                model: 3
                                Rectangle {
                                    readonly property string kind: parent.kind
                                    color: "transparent"; radius: 1 * Tokens.u
                                    border.width: kind === "list" ? 0 : 1.2 * Tokens.u; border.color: parent.parent.parent.parent.active ? Tokens.primaryInk : Tokens.inkSoft
                                    x: kind === "list" ? 0 : index * 7 * Tokens.u; y: kind === "list" ? index * 4.5 * Tokens.u : 0
                                    width: kind === "list" ? parent.width : 4 * Tokens.u; height: kind === "list" ? 2 * Tokens.u : parent.height
                                    Rectangle { visible: parent.kind === "list"; anchors.fill: parent; radius: 1; color: parent.parent.parent.parent.parent.active ? Tokens.primaryInk : Tokens.inkSoft }
                                }
                            }
                        }
                        Label { anchors.horizontalCenter: parent.horizontalCenter; text: modelData.label; color: parent.parent.active ? Tokens.primaryInk : Tokens.inkSoft; font.family: Tokens.family820; font.pixelSize: 10.3 * Tokens.u }
                    }
                }
            }
        }
        // Sort and order: two wide pills each.
        Repeater {
            model: page.calendar ? [] : [
                { row: 0, y: 207.7, id: "title", label: qsTr("Title") }, { row: 0, y: 207.7, id: "date_added", label: qsTr("Date Added") },
                { row: 1, y: 300.6, id: "asc", label: page.sort === "title" ? qsTr("A-Z") : qsTr("Oldest") }, { row: 1, y: 300.6, id: "desc", label: page.sort === "title" ? qsTr("Z-A") : qsTr("Newest") } ]
            MouseArea {
                readonly property bool isLeft: modelData.id === "title" || modelData.id === "asc"
                readonly property bool active: modelData.row === 0 ? page.sort === modelData.id : page.order === modelData.id
                x: isLeft ? 18.3 * Tokens.u : 199.6 * Tokens.u
                y: modelData.y * Tokens.u
                width: (isLeft ? 174.7 : 170.1) * Tokens.u; height: 47.7 * Tokens.u
                onClicked: {
                    if (modelData.row === 0) {
                        page.sort = modelData.id
                        page.order = modelData.id === "title" ? "asc" : "desc"
                        Api.setSetting("lib.order", page.order)
                        page.set("sort", modelData.id)
                    } else { page.order = modelData.id; page.set("order", modelData.id) }
                }
                Rectangle { anchors.fill: parent; radius: 14 * Tokens.u; color: parent.active ? Tokens.primary : page.chip; border.width: parent.active ? 0 : 1; border.color: Tokens.line }
                Label { anchors.centerIn: parent; text: modelData.label; color: parent.active ? Tokens.primaryInk : Tokens.inkSoft; font.family: Tokens.family610; font.pixelSize: 12.5 * Tokens.u }
            }
        }
        // Language selects.
        Repeater {
            model: page.calendar ? [] : [ { key: "audio", y: 394 }, { key: "subs", y: 497 } ]
            Item {
                readonly property string cur: modelData.key === "audio" ? page.audio : page.subs
                readonly property bool opened: page.openSelect === modelData.key
                x: page.gut; width: flick.width - 2 * page.gut
                y: (modelData.y + (modelData.key === "subs" && page.openSelect === "audio" ? page.languages.length * 40 : 0)) * Tokens.u
                height: 57.4 * Tokens.u + (opened ? page.languages.length * 40 * Tokens.u : 0)
                MouseArea {
                    width: parent.width; height: 57.4 * Tokens.u
                    onClicked: page.openSelect = parent.opened ? "" : modelData.key
                    Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.dark ? page.chip : "#e8e6e6"; border.width: 1; border.color: Tokens.lineStrong }   // measured web select fill
                    Label {
                        x: 19.8 * Tokens.u; anchors.verticalCenter: parent.verticalCenter
                        text: { for (var i = 0; i < page.languages.length; ++i) if (page.languages[i].id === parent.parent.cur) return page.languages[i].label; return "" }
                        color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 8.8 * Tokens.u
                    }
                    Label { anchors { right: parent.right; rightMargin: 22 * Tokens.u; verticalCenter: parent.verticalCenter }
                        text: "\u2304"; color: Tokens.inkSoft; font.pixelSize: 9 * Tokens.u }
                }
                Column {
                    y: 57.4 * Tokens.u; width: parent.width; visible: parent.opened
                    Repeater {
                        model: page.languages
                        MouseArea {
                            width: parent.width; height: 40 * Tokens.u
                            onClicked: {
                                if (parent.parent.parent.modelData.key === "audio") { page.audio = modelData.id; page.set("audio", modelData.id) }
                                else { page.subs = modelData.id; page.set("subs", modelData.id) }
                                page.openSelect = ""
                            }
                            Label { x: 19.8 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; text: modelData.label; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 9.5 * Tokens.u }
                        }
                    }
                }
            }
        }
        VerticalScrollDecorator {}
    }
    NavBar {
        blurSource: flick
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: 10 * Tokens.u; rightMargin: 10 * Tokens.u; bottomMargin: 7 * Tokens.u }
        section: page.calendar ? "" : "movies"
        onSelected: {
            var mp = pageStack.find(function (p) { return p.objectName === "main" })
            if (mp) { mp.section = target; pageStack.pop(mp) }
        }
        onProfileClicked: pageStack.push(Qt.resolvedUrl("ProfilesPage.qml"))
    }
}
