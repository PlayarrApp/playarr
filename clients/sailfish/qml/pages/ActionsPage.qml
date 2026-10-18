import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Title actions (press and hold a title): play, download, add to playlist, mark watched or unwatched.
PlayarrPage {
    id: page
    objectName: "actions"
    property var work
    property var detail: null
    property var playlists: []
    property bool canDownload: false
    property bool downloadCapabilityLoaded: false
    readonly property bool downloadActionVisible: canDownload && !!detail && !!detail.media_file_id
    readonly property bool playlistActionVisible: !!work && (work.kind === "movie" || work.kind === "series" || work.kind === "site" || work.kind === "artist")
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
                pageStack.replace(Qt.resolvedUrl("PlayerPage.qml"), { mediaFileId: detail.media_file_id, title: work.title, startMs: start, workId: work.id })
            })
        } else {
            pageStack.replace(Qt.resolvedUrl("DetailPage.qml"), { work: work })
        }
    }
    function download() {
        if (!detail || !detail.media_file_id) { note = qsTr("Open the title to pick an episode"); return }
        pageStack.push(Qt.resolvedUrl("DownloadPage.qml"), { mediaFileId: detail.media_file_id, title: work.title, info: { kind: work.kind === "artist" ? "artist" : "movie" } })
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
        Api.request("GET", "/api/v1/users/me/capabilities", null, function (st, c) {
            canDownload = st === 200 && c && c.can_download === true
            downloadCapabilityLoaded = true
        })
    }

    SilicaFlickable {
        id: flick
        anchors.fill: parent
        contentHeight: col.height + 60 * Tokens.u
        clip: true
        Column {
            id: col
            width: parent.width
            spacing: 13.5 * Tokens.u
            Item {
                width: parent.width
                height: 47.4 * Tokens.u + Math.min(2, titleLbl.lineCount) * 33 * Tokens.u
                Column {
                    anchors { left: parent.left; leftMargin: 20.3 * Tokens.u; top: parent.top; topMargin: 18 * Tokens.u; right: closeBtn.left; rightMargin: 8 * Tokens.u }
                    spacing: 4 * Tokens.u
                    Label { renderType: Text.NativeRendering; text: qsTr("TITLE ACTIONS"); color: Tokens.inkSoft; font.family: Tokens.family820; font.pixelSize: 6.6 * Tokens.u; font.letterSpacing: 0.8 * Tokens.u }
                    Label { renderType: Text.NativeRendering;
                        id: titleLbl
                        width: parent.width; text: page.work.title; wrapMode: Text.Wrap; maximumLineCount: 2; elide: Text.ElideRight
                        lineHeightMode: Text.FixedHeight; lineHeight: 33 * Tokens.u
                        color: Tokens.ink; font.family: Tokens.family580; font.letterSpacing: -0.6 * Tokens.u; font.pixelSize: 24 * Tokens.u
                    }
                }
                MouseArea {
                    id: closeBtn
                    objectName: "parity-actions-close"
                    property bool navigationFocusable: true
                    function navigationActivate() { pageStack.pop() }
                    anchors { right: parent.right; rightMargin: 20.3 * Tokens.u; top: parent.top; topMargin: 20.3 * Tokens.u }
                    width: 43.7 * Tokens.u; height: width
                    onClicked: pageStack.pop()
                    Rectangle { anchors.fill: parent; radius: width / 2; color: Tokens.dark ? "#262226" : "#dedcdd"; border.width: 1; border.color: Tokens.lineStrong }
                    Label { renderType: Text.NativeRendering; anchors.centerIn: parent; text: "\u2715"; color: Tokens.ink; font.family: Tokens.family820; font.pixelSize: 10 * Tokens.u }
                }
            }
            ActionRow { glyph: "▶"; text: qsTr("Play"); primary: true; navigationInitialFocus: true; parityIndex: 0; navigationActivate: function() { page.play() }; onClicked: page.play() }
            ActionRow { glyph: "⤓"; text: qsTr("Download"); visible: page.downloadActionVisible; parityIndex: 1; navigationActivate: function() { page.download() }; onClicked: page.download() }
            ActionRow { glyph: "+"; text: qsTr("Add to Playlist"); visible: page.playlistActionVisible; parityIndex: 2; navigationActivate: function() { page.showPlaylists = !page.showPlaylists }; onClicked: page.showPlaylists = !page.showPlaylists }
            Label { renderType: Text.NativeRendering; x: Tokens.pad * 2; visible: page.showPlaylists && page.playlists.length === 0; text: qsTr("No personal playlists yet. Create one from the Playlists page."); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u; wrapMode: Text.Wrap; width: col.width - 3 * Tokens.pad }
            Repeater {
                model: page.showPlaylists ? page.playlists : []
                ActionRow { glyph: "♪"; text: modelData.name; x: Tokens.pad * 2; width: col.width - 3 * Tokens.pad; parityIndex: 3 + index; navigationActivate: function() { page.addTo(modelData) }; onClicked: page.addTo(modelData) }
            }
            ActionRow { glyph: "✓"; text: qsTr("Mark as Watched"); parityIndex: 3 + (page.showPlaylists ? page.playlists.length : 0); navigationActivate: function() { page.mark(true) }; onClicked: page.mark(true) }
            ActionRow { glyph: "○"; text: qsTr("Mark as Unwatched"); parityIndex: 4 + (page.showPlaylists ? page.playlists.length : 0); navigationActivate: function() { page.mark(false) }; onClicked: page.mark(false) }
            Label { renderType: Text.NativeRendering; x: Tokens.pad; visible: page.note !== ""; text: page.note; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u }
        }
        EdgeFade { target: flick }
        VerticalScrollDecorator {}
    }
}
