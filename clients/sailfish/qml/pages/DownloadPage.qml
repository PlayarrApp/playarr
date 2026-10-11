import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Download options as on web: quality (from the server's download options) and keep-until. Also edits an existing
// download: a new quality replaces the ticket, keep-until only changes the local rule.
PlayarrPage {
    id: page
    property string mediaFileId
    property string title
    property var edit: null                 // existing ticket to edit, or null for a new download
    property var options: []
    property string quality: "original"
    property string keepType: "forever"     // forever | date | after-watched
    property int keepDays: 30
    property int amount: 7
    property string unit: "days"
    property string note: ""
    property bool busy: false

    function meta() { return JSON.parse(Api.setting("dlmeta-" + (edit ? edit.id : ""), "{}")) }
    function keepDateIso() { var d = new Date(Date.now() + keepDays * 86400000); return Qt.formatDate(d, "yyyy-MM-dd") }
    function policy() {
        return keepType === "date" ? { type: "date", date: keepDateIso() }
             : keepType === "after-watched" ? { type: "after-watched", amount: amount, unit: unit } : { type: "forever" }
    }
    function mb(n) { return n ? (n / 1048576 >= 1024 ? (n / 1073741824).toFixed(1) + " GB" : Math.round(n / 1048576) + " MB") : "" }
    function save() {
        busy = true
        var p = policy()
        if (edit && quality === edit.quality_id) {   // keep-until only
            var m = meta(); m.keepUntil = p; Api.setSetting("dlmeta-" + edit.id, JSON.stringify(m))
            pageStack.pop(); return
        }
        var old = edit
        Api.request("POST", "/api/v1/downloads", { media_file_id: mediaFileId, quality_id: quality }, function (st, t) {
            busy = false
            console.log("download ticket request", st, quality)
            if (st !== 200 && st !== 201) { note = st === 403 ? qsTr("Downloads are not allowed") : qsTr("Download failed"); return }
            Api.setSetting("dlmeta-" + t.id, JSON.stringify({ title: title, keepUntil: p }))
            if (old) { Downloads.remove(old.id); Api.request("DELETE", "/api/v1/downloads/" + old.id, null, null) }
            pageStack.pop()
        })
    }
    Component.onCompleted: {
        if (edit) { var m = meta(); quality = edit.quality_id; if (m.keepUntil) { keepType = m.keepUntil.type; if (m.keepUntil.amount) { amount = m.keepUntil.amount; unit = m.keepUntil.unit } } }
        Api.request("GET", "/api/v1/media/" + mediaFileId + "/download-options", null, function (st, d) {
            if (st === 200 && d) options = d.options
        })
    }

    PageTitle { id: head; y: 4 * Tokens.u; title: edit ? qsTr("Edit download") : qsTr("Download"); onBackClicked: pageStack.pop() }
    SilicaFlickable {
        id: flick
        anchors { top: head.bottom; left: parent.left; right: parent.right; bottom: parent.bottom }
        contentHeight: col.height + 40 * Tokens.u
        clip: true
        Column {
            id: col
            width: parent.width
            spacing: 12 * Tokens.u
            Label { x: Tokens.pad; width: parent.width - 2 * Tokens.pad; text: page.title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 16 * Tokens.u }
            Label { x: Tokens.pad; text: qsTr("QUALITY"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            Repeater {
                model: page.options
                MenuRow {
                    text: modelData.label + (modelData.estimated_size_bytes ? "  ·  " + (modelData.size_is_estimate ? "~" : "") + page.mb(modelData.estimated_size_bytes) : "")
                    selected: page.quality === modelData.id
                    x: Tokens.pad
                    width: col.width - 2 * Tokens.pad
                    onClicked: page.quality = modelData.id
                }
            }
            Label { x: Tokens.pad; text: qsTr("KEEP UNTIL"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
            ChipRow {
                options: [ { id: "forever", label: qsTr("Forever") }, { id: "date", label: qsTr("Date") }, { id: "after-watched", label: qsTr("After watched") } ]
                value: page.keepType
                onPicked: page.keepType = id
            }
            Row {
                x: Tokens.pad; spacing: 10 * Tokens.u; visible: page.keepType === "date"
                Label { anchors.verticalCenter: parent.verticalCenter; text: qsTr("In %1 days (%2)").arg(page.keepDays).arg(page.keepDateIso()); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
                PillButton { text: "−"; implicitWidth: 40 * Tokens.u; onClicked: page.keepDays = Math.max(1, page.keepDays - 7) }
                PillButton { text: "+"; implicitWidth: 40 * Tokens.u; onClicked: page.keepDays += 7 }
            }
            Row {
                x: Tokens.pad; spacing: 10 * Tokens.u; visible: page.keepType === "after-watched"
                Label { anchors.verticalCenter: parent.verticalCenter; text: qsTr("%1 %2 after watching").arg(page.amount).arg(page.unit === "weeks" ? qsTr("weeks") : qsTr("days")); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
                PillButton { text: "−"; implicitWidth: 40 * Tokens.u; onClicked: page.amount = Math.max(1, page.amount - 1) }
                PillButton { text: "+"; implicitWidth: 40 * Tokens.u; onClicked: page.amount += 1 }
                PillButton { text: page.unit === "weeks" ? qsTr("weeks") : qsTr("days"); implicitWidth: 80 * Tokens.u; onClicked: page.unit = page.unit === "weeks" ? "days" : "weeks" }
            }
            PillButton { x: Tokens.pad; primary: true; enabled: !page.busy; text: edit ? qsTr("Save") : qsTr("Start download"); onClicked: page.save() }
            Label { x: Tokens.pad; visible: page.note !== ""; text: page.note; color: Tokens.danger; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
        }
        VerticalScrollDecorator {}
    }
}
