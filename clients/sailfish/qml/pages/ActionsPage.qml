import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Title actions (press and hold a title): play, download, add to playlist, mark watched or unwatched.
PlayarrPage {
    id: page
    property var work
    property var detail: null
    property var playlists: []
    property bool showPlaylists: false
    property string note: ""

    // Every playable file under the title with its length.
    function leaves() {
        var out = []
        if (!detail) return out
        if (detail.media_file_id) out.push({ id: detail.media_file_id, ms: detail.runtime_ms || 0 })
        var seasons = detail.children && detail.children.Series ? detail.children.Series : []
        seasons.forEach(function (s) { s.episodes.forEach(function (e) { if (e.media_file_id) out.push({ id: e.media_file_id, ms: e.runtime_ms || 0 }) }) })
        return out
    }
    function mark(watched) {
        var l = leaves(), left = l.length, ok = true
        if (left === 0) { note = qsTr("Nothing to mark"); return }
        l.forEach(function (f) {
            var dur = watched ? f.ms : Math.max(f.ms, 5001)
            Api.request("PUT", "/api/v1/playback/" + f.id + "/progress", { position_ms: watched ? f.ms : 0, duration_ms: dur, completed: watched }, function (st) {
                if (st !== 200 && st !== 204) ok = false
                if (--left === 0) note = ok ? (watched ? qsTr("Marked as watched") : qsTr("Marked as unwatched")) : qsTr("Could not update")
            })
        })
    }
    function play() {
        if (detail && detail.media_file_id) {
            Api.request("GET", "/api/v1/playback/" + detail.media_file_id + "/progress", null, function (st, p) {
                var start = (st === 200 && p && p.state === "part_watched") ? p.position_ms : 0
                pageStack.replace(Qt.resolvedUrl("PlayerPage.qml"), { mediaFileId: detail.media_file_id, title: work.title, startMs: start })
            })
        } else {
            pageStack.replace(Qt.resolvedUrl("DetailPage.qml"), { work: work })
        }
    }
    function download() {
        if (!detail || !detail.media_file_id) { note = qsTr("Open the title to pick an episode"); return }
        Api.request("POST", "/api/v1/downloads", { media_file_id: detail.media_file_id, quality_id: "original" }, function (st, t) {
            if (st === 200 || st === 201) { Api.setSetting("dltitle-" + t.id, work.title); note = qsTr("Requested: see Downloads") }
            else note = st === 403 ? qsTr("Downloads are not allowed") : qsTr("Download failed")
        })
    }
    function addTo(pl) {
        Api.request("POST", "/api/v1/playlists/" + pl.id + "/items", { work_id: work.id }, function (st) {
            note = (st === 200 || st === 201 || st === 204) ? qsTr("Added to %1").arg(pl.name) : qsTr("Could not add")
            showPlaylists = false
        })
    }
    Component.onCompleted: {
        Api.request("GET", "/api/v1/catalog/" + work.id, null, function (st, d) { if (st === 200 && d) detail = d })
        Api.request("GET", "/api/v1/playlists", null, function (st, d) { if (st === 200 && d) playlists = d.filter(function (p) { return !p.is_system }) })
    }

    SilicaFlickable {
        id: flick
        anchors.fill: parent
        contentHeight: col.height + 60 * Tokens.u
        clip: true
        Column {
            id: col
            width: parent.width
            spacing: 10 * Tokens.u
            Item {
                width: parent.width
                height: 84 * Tokens.u
                Column {
                    anchors { left: parent.left; leftMargin: Tokens.pad; verticalCenter: parent.verticalCenter; right: closeBtn.left; rightMargin: 8 * Tokens.u }
                    Label { text: qsTr("TITLE ACTIONS"); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u; font.letterSpacing: 1.5 * Tokens.u }
                    Label { width: parent.width; text: page.work.title; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 26 * Tokens.u }
                }
                MouseArea {
                    id: closeBtn
                    anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: parent.verticalCenter }
                    width: 44 * Tokens.u; height: width
                    onClicked: pageStack.pop()
                    Rectangle { anchors.fill: parent; radius: width / 2; color: "transparent"; border.width: 1; border.color: Tokens.lineStrong }
                    Label { anchors.centerIn: parent; text: "✕"; color: Tokens.ink; font.pixelSize: 16 * Tokens.u }
                }
            }
            ActionRow { glyph: "▶"; text: qsTr("Play"); primary: true; onClicked: page.play() }
            ActionRow { glyph: "⤓"; text: qsTr("Download"); visible: !!page.detail && !!page.detail.media_file_id; onClicked: page.download() }
            ActionRow { glyph: "+"; text: qsTr("Add to Playlist"); visible: page.playlists.length > 0; onClicked: page.showPlaylists = !page.showPlaylists }
            Repeater {
                model: page.showPlaylists ? page.playlists : []
                ActionRow { glyph: "♪"; text: modelData.name; x: Tokens.pad * 2; width: col.width - 3 * Tokens.pad; onClicked: page.addTo(modelData) }
            }
            ActionRow { glyph: "✓"; text: qsTr("Mark as Watched"); onClicked: page.mark(true) }
            ActionRow { glyph: "○"; text: qsTr("Mark as Unwatched"); onClicked: page.mark(false) }
            Label { x: Tokens.pad; visible: page.note !== ""; text: page.note; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u }
        }
        EdgeFade { target: flick }
        VerticalScrollDecorator {}
    }
}
