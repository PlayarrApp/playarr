import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Library controls (web's Filters page): view, sort, order and language filters, saved on this device.
PlayarrPage {
    id: page
    objectName: "filters"
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

    readonly property real gut: 20 * Tokens.u
    readonly property color chip: Tokens.dark ? Tokens.surfaceStrong : "#e6e4e5"   // web light controls are grey, not white
    property var layoutEls: [ { x: 0, y: 0, w: 390, h: 683, bg: Tokens.dark ? "#151315" : "#f5f3f2" }, { x: 0, y: 0, w: 390, h: 683, bg: String(Tokens.bg) }, { x: 0, y: 0, w: 390, h: 683, bg: String(Tokens.bg) }, { role: "dialog", x: 0, y: 0, w: 390, h: 683, bg: Tokens.dark ? "#201c20" : "#ffffff" } ]
    readonly property color pill: Tokens.dark ? "#2b252a" : "#eae8e9"   // web chip fill
    property string openSelect: ""     // "audio" or "subs": the language list that is expanded

    SilicaFlickable {
        id: flick
        anchors.fill: parent
        contentHeight: 560 * Tokens.u + (page.openSelect !== "" ? page.languages.length * 40 * Tokens.u : 0)
        clip: true
        // Section caption.
        Repeater {
            model: page.calendar ? [ { t: qsTr("VIEW"), y: 97.5 } ] : [ { t: qsTr("VIEW"), y: 97.5 }, { t: qsTr("SORT BY"), y: 190 }, { t: qsTr("ORDER"), y: 283.4 }, { t: qsTr("AUDIO LANGUAGE"), y: 375 }, { t: qsTr("SUBTITLE LANGUAGE"), y: 479.3 + (page.openSelect === "audio" ? page.languages.length * 40 : 0) } ]
            Label { renderType: Text.NativeRendering; x: page.gut; y: (modelData.y - 5) * Tokens.u; text: modelData.t; color: Tokens.inkMuted; property string parityRole: "heading"; font.family: Tokens.fam(720); font.letterSpacing: 1.4; font.pixelSize: Tokens.fsDown(7.04) }
        }
        Label { renderType: Text.NativeRendering; x: page.gut; y: 19 * Tokens.u; text: page.calendar ? qsTr("CALENDAR CONTROLS") : qsTr("LIBRARY CONTROLS"); color: Tokens.inkMuted; font.family: Tokens.fam(720); font.pixelSize: Tokens.fsDown(7.04); font.letterSpacing: 1.5 }
        Label { renderType: Text.NativeRendering; x: page.gut; y: 34 * Tokens.u; text: qsTr("Filters"); color: Tokens.ink; property string parityRole: "heading"; font.family: Tokens.family580; font.pixelSize: Tokens.fs(22.4); font.letterSpacing: -1.25 * Tokens.u }
        MouseArea {
            objectName: "parity-filters-close"
            property bool navigationFocusable: true
            property bool navigationInitialFocus: true
            property int parityRail: 1
            property int parityIndex: 0
            function navigationActivate() { pageStack.pop() }
            property bool layoutSkip: true
            property var layoutEls: [ { role: "button", text: qsTr("Close filters"), dx: 0, w: 44, h: 44, radius: 50, bg: String(Tokens.surfaceSoft) } ]
            x: parent.width - page.gut - width; y: 20 * Tokens.u
            width: 44 * Tokens.u; height: width
            onClicked: pageStack.pop()
            Rectangle { property bool layoutNoEmit: true; anchors.fill: parent; radius: width / 2; color: Tokens.surfaceSoft; border.width: 1; border.color: Tokens.lineStrong }
            Rectangle {   // web: the drawer's close button takes the focus on open, so it holds the ring (2 px, 3 css px off)
                visible: false
                anchors { fill: parent; margins: -4 * Tokens.u }
                radius: width / 2; color: "transparent"; border.width: 2 * Tokens.u; border.color: Tokens.dark ? "#ffffff" : Tokens.ink
            }
            Label { renderType: Text.NativeRendering; anchors.centerIn: parent; text: "\u00D7"; color: Tokens.ink; font.family: Tokens.fam(720); font.pixelSize: Tokens.fs(16) }
        }
        // View: icon over label.
        Row {
            x: page.gut; y: 115.92 * Tokens.u
            spacing: 8 * Tokens.u
            Repeater {
                model: page.calendar ? [ { id: "month", label: qsTr("Month") }, { id: "week", label: qsTr("Week") }, { id: "agenda", label: qsTr("Agenda") } ]
                                     : [ { id: "list", label: qsTr("List") }, { id: "screen", label: qsTr("Screen") }, { id: "cover", label: qsTr("Cover") } ]
                MouseArea {
                    property bool navigationFocusable: true
                    property string parityLabel: modelData.label
                    property int parityRail: 0
                    property int parityIndex: index
                    function navigationActivate() {
                        if (page.calendar) { page.calMode = modelData.id; Api.setSetting("cal.mode", modelData.id); page.applied() }
                        else { page.view = modelData.id; page.set("view", modelData.id) }
                    }
                    readonly property bool active: (page.calendar ? page.calMode : page.view) === modelData.id
                    readonly property int slot: index
                    property bool layoutSkip: true
                    property var layoutEls: {
                        var k = modelData.id === "list" || modelData.id === "agenda" ? "list" : modelData.id === "cover" || modelData.id === "week" ? "tall" : "wide"
                        var sx = active ? 1.025 : 1, ox = 0, oy = 0, bg = active ? String(Tokens.primary) : String(page.pill)
                        var out = [ { role: "button", text: modelData.label, dx: ox, dy: oy, w: 111.33 * sx, h: 48 * sx, radius: 12, bg: bg } ]
                        var xs = k === "list" ? [45.66, 45.66, 45.66] : k === "wide" ? [46.79, 54.31, 61.82] : [47.67, 53.67, 59.67]
                        for (var i = 0; i < 3; ++i)
                            out.push(k === "list" ? { role: "container", dx: xs[i], dy: 8.28 + 4 * i, w: 20, h: 2, radius: 1, bg: bg }
                                   : k === "wide" ? { role: "container", dx: xs[i], dy: 11.68, w: i === 2 ? 5.48 : 5.46, h: 3.86, radius: 1, bg: bg }
                                   : { role: "container", dx: xs[i], dy: 6.78, w: 4, h: 13, radius: 1, bg: bg })
                        return out
                    }
                    scale: active ? 1.025 : 1
                    width: 111.33 * Tokens.u; height: 48 * Tokens.u
                    onClicked: navigationActivate()
                    Rectangle { property bool layoutNoEmit: true; anchors.fill: parent; radius: 12 * Tokens.u; color: parent.active ? Tokens.primary : page.pill; border.width: parent.active ? 0 : 1; border.color: Tokens.line }
                    Column {
                        anchors.centerIn: parent
                        spacing: 2 * Tokens.u
                        Item {
                            property bool layoutSkipTree: true
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
                        Label { renderType: Text.NativeRendering; anchors.horizontalCenter: parent.horizontalCenter; text: modelData.label.toLowerCase(); color: parent.parent.active ? (Tokens.dark ? "#151315" : "#f5f3f2") : Tokens.inkSoft; font.family: Tokens.fam(900); font.letterSpacing: 0.6; font.pixelSize: Tokens.fs(11.52)
                            transform: Translate { y: (modelData.id === "list" || modelData.id === "agenda" ? 2.8 : modelData.id === "cover" || modelData.id === "week" ? 3.3 : 2.4) * Tokens.u } }
                    }
                }
            }
        }
        // Sort and order: two wide pills each.
        Repeater {
            model: page.calendar ? [] : [
                { row: 0, y: 207.7, id: "title", label: qsTr("Title") }, { row: 0, y: 207.7, id: "date_added", label: qsTr("Date added") },
                { row: 1, y: 300.6, id: "asc", label: page.sort === "title" ? qsTr("A-Z") : qsTr("Oldest") }, { row: 1, y: 300.6, id: "desc", label: page.sort === "title" ? qsTr("Z-A") : qsTr("Newest") } ]
            MouseArea {
                property bool navigationFocusable: true
                property string parityLabel: modelData.label
                property int parityRail: 0
                property int parityIndex: 3 + index
                function navigationActivate() {
                    if (modelData.row === 0) {
                        page.sort = modelData.id
                        page.order = modelData.id === "title" ? "asc" : "desc"
                        Api.setSetting("lib.order", page.order)
                        page.set("sort", modelData.id)
                    } else { page.order = modelData.id; page.set("order", modelData.id) }
                }
                readonly property bool isLeft: modelData.id === "title" || modelData.id === "asc"
                readonly property bool active: modelData.row === 0 ? page.sort === modelData.id : page.order === modelData.id
                property bool layoutSkip: true
                x: isLeft ? 18.3 * Tokens.u : 199.6 * Tokens.u
                y: modelData.y * Tokens.u
                width: (isLeft ? 174.7 : 170.1) * Tokens.u; height: 47.7 * Tokens.u
                onClicked: navigationActivate()
                Rectangle { property bool layoutNoEmit: true; anchors.fill: parent; radius: 14 * Tokens.u; color: parent.active ? Tokens.primary : page.pill; border.width: parent.active ? 0 : 1; border.color: Tokens.line }
                Label { renderType: Text.NativeRendering; anchors.centerIn: parent; text: modelData.label; property string parityRole: "button"; property int layoutRadius: 12; property color layoutBg: parent.active ? Tokens.primary : page.pill; color: parent.active ? (Tokens.dark ? "#151315" : "#f5f3f2") : Tokens.inkSoft; font.family: Tokens.fam(680); font.pixelSize: Tokens.fs(11.52) }
            }
        }
        // Language selects.
        Repeater {
            model: page.calendar ? [] : [ { key: "audio", y: 393.61 }, { key: "subs", y: 496.95 } ]
            Item {
                readonly property string cur: modelData.key === "audio" ? page.audio : page.subs
                readonly property bool opened: page.openSelect === modelData.key
                x: page.gut; width: flick.width - 2 * page.gut
                y: (modelData.y + (modelData.key === "subs" && page.openSelect === "audio" ? page.languages.length * 40 : 0)) * Tokens.u
                height: 58.78 * Tokens.u + (opened ? page.languages.length * 40 * Tokens.u : 0)
                MouseArea {
                    property bool navigationFocusable: true
                    property string parityLabel: modelData.key === "audio" ? qsTr("Audio language") : qsTr("Subtitle language")
                    property int parityRail: 0
                    property int parityIndex: 7 + index
                    function navigationActivate() { page.openSelect = parent.opened ? "" : modelData.key }
                    width: parent.width; height: 58.78 * Tokens.u
                    property bool layoutSkip: true
                    property string curLabel: { for (var i = 0; i < page.languages.length; ++i) if (page.languages[i].id === parent.cur) return page.languages[i].label; return "" }
                    property var layoutEls: [ { role: "group", dx: 0, dy: 0, w: 350, h: 58.78, radius: 12, bg: String(page.pill) },
                        { role: "button", text: curLabel + " \u2304", dx: 7.39, dy: 7.39, w: 335.22, h: 44, radius: 10, bg: String(page.pill) } ]
                    onClicked: navigationActivate()
                    Rectangle { property bool layoutNoEmit: true; anchors.fill: parent; radius: 12 * Tokens.u; color: page.pill; border.width: 1; border.color: Tokens.lineStrong }
                    Label { renderType: Text.NativeRendering;
                        x: 19.8 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; anchors.verticalCenterOffset: -2; property color layoutBg: page.pill
                        text: { for (var i = 0; i < page.languages.length; ++i) if (page.languages[i].id === parent.parent.cur) return page.languages[i].label; return "" }
                        color: Tokens.ink; font.family: Tokens.fam(680); font.letterSpacing: -0.3; font.pixelSize: Tokens.fs(8.96)
                    }
                    Label { renderType: Text.NativeRendering; anchors { right: parent.right; rightMargin: 19.4 * Tokens.u; verticalCenter: parent.verticalCenter; verticalCenterOffset: -2 }
                        text: "\u2304"; color: Tokens.inkSoft; property color layoutBg: page.pill; font.family: Tokens.fam(680); font.pixelSize: Tokens.fs(8.96) }
                }
                Column {
                    y: 57.4 * Tokens.u; width: parent.width; visible: parent.opened
                    Repeater {
                        model: page.languages
                        MouseArea {
                            property bool navigationFocusable: visible
                            property string parityLabel: modelData.label
                            property int parityRail: 0
                            property int parityIndex: 9 + index
                            function navigationActivate() {
                                if (parent.parent.parent.modelData.key === "audio") { page.audio = modelData.id; page.set("audio", modelData.id) }
                                else { page.subs = modelData.id; page.set("subs", modelData.id) }
                                page.openSelect = ""
                            }
                            width: parent.width; height: 40 * Tokens.u
                            onClicked: navigationActivate()
                            Label { renderType: Text.NativeRendering; x: 19.8 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; text: modelData.label; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: Tokens.fs(9.5) }
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
