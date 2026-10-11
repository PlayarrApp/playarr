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

    SilicaFlickable {
        id: flick
        anchors.fill: parent
        contentHeight: col.height + 60 * Tokens.u
        clip: true
        Column {
            id: col
            width: parent.width
            spacing: 12 * Tokens.u
            Item {
                width: parent.width
                height: 84 * Tokens.u
                Column {
                    x: Tokens.pad
                    anchors.verticalCenter: parent.verticalCenter
                    Label { text: page.calendar ? qsTr("CALENDAR CONTROLS") : qsTr("LIBRARY CONTROLS"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
                    Label { text: qsTr("Filters"); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 30 * Tokens.u }
                }
                MouseArea {
                    id: closeBtn
                    anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: parent.verticalCenter }
                    width: 44 * Tokens.u; height: width
                    onClicked: pageStack.pop()
                    Rectangle { anchors.fill: parent; radius: width / 2; color: "transparent"; border.width: 1; border.color: Tokens.lineStrong }
                    Label { anchors.centerIn: parent; text: "\u2715"; color: Tokens.ink; font.pixelSize: 16 * Tokens.u }
                }
            }
            Label { x: Tokens.pad; text: qsTr("VIEW"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            Row {
                x: Tokens.pad
                spacing: 8 * Tokens.u
                Repeater {
                    model: page.calendar ? [ { id: "month", label: qsTr("Month") }, { id: "week", label: qsTr("Week") }, { id: "agenda", label: qsTr("Agenda") } ]
                                         : [ { id: "list", label: qsTr("List") }, { id: "screen", label: qsTr("Screen") }, { id: "cover", label: qsTr("Cover") } ]
                    PillButton {
                        text: modelData.label
                        primary: (page.calendar ? page.calMode : page.view) === modelData.id
                        implicitWidth: (col.width - 2 * Tokens.pad - 16 * Tokens.u) / 3
                        onClicked: {
                            if (page.calendar) { page.calMode = modelData.id; Api.setSetting("cal.mode", modelData.id); page.applied() }
                            else { page.view = modelData.id; page.set("view", modelData.id) }
                        }
                    }
                }
            }
            Label { x: Tokens.pad; visible: !page.calendar; text: qsTr("SORT BY"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            Row {
                x: Tokens.pad
                visible: !page.calendar
                spacing: 8 * Tokens.u
                Repeater {
                    model: [ { id: "title", label: qsTr("Title") }, { id: "date_added", label: qsTr("Date Added") } ]
                    PillButton {
                        text: modelData.label
                        primary: page.sort === modelData.id
                        implicitWidth: (col.width - 2 * Tokens.pad - 8 * Tokens.u) / 2
                        onClicked: {
                            page.sort = modelData.id
                            page.order = modelData.id === "title" ? "asc" : "desc"
                            Api.setSetting("lib.order", page.order)
                            page.set("sort", modelData.id)
                        }
                    }
                }
            }
            Label { x: Tokens.pad; visible: !page.calendar; text: qsTr("ORDER"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            Row {
                x: Tokens.pad
                visible: !page.calendar
                spacing: 8 * Tokens.u
                Repeater {
                    model: [ { id: "asc", label: page.sort === "title" ? qsTr("A-Z") : qsTr("Oldest") }, { id: "desc", label: page.sort === "title" ? qsTr("Z-A") : qsTr("Newest") } ]
                    PillButton {
                        text: modelData.label
                        primary: page.order === modelData.id
                        implicitWidth: (col.width - 2 * Tokens.pad - 8 * Tokens.u) / 2
                        onClicked: { page.order = modelData.id; page.set("order", modelData.id) }
                    }
                }
            }
            Label { x: Tokens.pad; visible: !page.calendar; text: qsTr("AUDIO LANGUAGE"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            ChipRow { visible: !page.calendar; options: page.languages; value: page.audio; onPicked: { page.audio = id; page.set("audio", id) } }
            Label { x: Tokens.pad; visible: !page.calendar; text: qsTr("SUBTITLE LANGUAGE"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            ChipRow { visible: !page.calendar; options: page.languages; value: page.subs; onPicked: { page.subs = id; page.set("subs", id) } }
        }
        EdgeFade { target: flick }
        VerticalScrollDecorator {}
    }
}
