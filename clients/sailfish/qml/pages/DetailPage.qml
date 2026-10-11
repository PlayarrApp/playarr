import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Title detail: hero, facts, Play/Resume, and the episode or track lists.
PlayarrPage {
    id: page
    property var work
    property var detail: null
    property var progress: ({})      // media_file_id -> watch progress
    property int season: 0
    property bool failed: false

    readonly property var seasons: detail && detail.children && detail.children.Series ? detail.children.Series : []
    readonly property var albums: detail && detail.children && detail.children.Artist ? detail.children.Artist : []

    // Movie: its file. Series: the part-watched episode, else the first unwatched, else the first.
    readonly property var target: {
        if (!detail) return null
        if (detail.media_file_id) return { id: detail.media_file_id, title: work.title }
        var first = null, unwatched = null, part = null
        for (var s = 0; s < seasons.length; ++s) {
            var eps = seasons[s].episodes
            for (var e = 0; e < eps.length; ++e) {
                var id = eps[e].media_file_id
                if (!id) continue
                var t = { id: id, title: work.title + " · S" + seasons[s].season.season_number + "E" + eps[e].episode.episode_number }
                var st = progress[id] ? progress[id].state : "unseen"
                if (!first) first = t
                if (!part && st === "part_watched") part = t
                if (!unwatched && st !== "watched") unwatched = t
            }
        }
        return part || unwatched || first
    }
    readonly property var targetProgress: target && progress[target.id] && progress[target.id].state === "part_watched" ? progress[target.id] : null

    property string downloadNote: ""
    // Asks the server for a download ticket of the original file; the Downloads tab shows its progress.
    function requestDownload() {
        Api.request("POST", "/api/v1/downloads", { media_file_id: detail.media_file_id, quality_id: "original" }, function (status, ticket) {
            if (status === 200 || status === 201) {
                Api.setSetting("dltitle-" + ticket.id, work.title)
                downloadNote = qsTr("Requested: see Downloads")
            } else {
                downloadNote = status === 403 ? qsTr("Downloads are not allowed") : qsTr("Download failed")
            }
        })
    }
    function play(id, title) {
        var p = progress[id]
        pageStack.push(Qt.resolvedUrl("PlayerPage.qml"), {
            mediaFileId: id, title: title,
            startMs: p && p.state === "part_watched" ? p.position_ms : 0 })
    }
    function load() {
        Api.request("GET", "/api/v1/catalog/" + work.id, null, function (status, data) {
            if (status === 200 && data) detail = data; else failed = true
        })
        Api.request("GET", "/api/v1/playback/progress", null, function (status, data) {
            if (status !== 200 || !data) return
            var m = {}
            data.forEach(function (p) { m[p.media_file_id] = p })
            progress = m
        })
    }
    onDetailChanged: if (detail) work = detail.work
    onStatusChanged: if (status === PageStatus.Active && detail) load() // refresh resume state after playback
    Component.onCompleted: load()

    function minutes(ms) { return ms ? Math.round(ms / 60000) + " min" : "" }
    function mmss(ms) {
        var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60
        return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x
    }

    SilicaFlickable {
        anchors.fill: parent
        contentHeight: col.height + 60 * Tokens.u
        Column {
            id: col
            width: parent.width
            spacing: 14 * Tokens.u

            Item {
                width: parent.width
                height: 240 * Tokens.u
                Artwork {
                    anchors.fill: parent
                    radius: 0
                    work: page.work
                    kinds: ["backdrop", "poster", "thumb"]
                }
                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        GradientStop { position: 0.4; color: "transparent" }
                        GradientStop { position: 1; color: Tokens.bg }
                    }
                }
            }
            Label {
                x: Tokens.pad
                text: work.genres && work.genres.length ? work.genres[0].toUpperCase() : ""
                visible: text !== ""
                color: Tokens.brandPinkSoft
                font.family: Tokens.family
                font.weight: Font.Bold
                font.letterSpacing: 2 * Tokens.u
                font.pixelSize: 13 * Tokens.u
            }
            Label {
                x: Tokens.pad
                width: parent.width - 2 * Tokens.pad
                text: work.title
                wrapMode: Text.Wrap
                color: Tokens.ink
                font.family: Tokens.family
                font.pixelSize: 38 * Tokens.u
                lineHeight: 0.95
            }
            Row {
                x: Tokens.pad
                spacing: 14 * Tokens.u
                Label { text: work.kind === "movie" ? qsTr("Movie") : work.kind === "series" ? qsTr("Series") : qsTr("Music"); font.weight: Font.Bold; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u }
                Label { visible: !!detail && !!detail.runtime_ms; text: detail ? minutes(detail.runtime_ms) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u }
                Label { visible: !!work.release_date; text: work.release_date ? work.release_date.substr(0, 4) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 14 * Tokens.u }
            }
            Label {
                x: Tokens.pad
                width: parent.width - 2 * Tokens.pad
                visible: !!work.overview
                text: work.overview || ""
                wrapMode: Text.Wrap
                color: Tokens.inkSoft
                font.family: Tokens.family
                font.pixelSize: 15 * Tokens.u
            }
            PillButton {
                x: Tokens.pad
                visible: !!page.target
                primary: true
                width: 160 * Tokens.u
                text: "▶  " + (page.targetProgress ? qsTr("Resume %1").arg(mmss(page.targetProgress.position_ms)) : qsTr("Play"))
                onClicked: page.play(page.target.id, page.target.title)
            }
            PillButton {
                x: Tokens.pad
                visible: !!detail && !!detail.media_file_id
                text: page.downloadNote !== "" ? page.downloadNote : qsTr("Download")
                onClicked: page.requestDownload()
            }
            BusyIndicator { anchors.horizontalCenter: parent.horizontalCenter; size: BusyIndicatorSize.Medium; running: !detail && !failed }
            Label {
                x: Tokens.pad
                visible: failed
                text: qsTr("Could not load this title")
                color: Tokens.danger
                font.family: Tokens.family
            }

            // Series: season chips + episodes
            Flickable {
                visible: seasons.length > 0
                width: parent.width
                height: 44 * Tokens.u
                contentWidth: chips.width + 2 * Tokens.pad
                clip: true
                Row {
                    id: chips
                    x: Tokens.pad
                    spacing: 10 * Tokens.u
                    Repeater {
                        model: seasons
                        PillButton {
                            text: qsTr("Season %1").arg(modelData.season.season_number)
                            primary: index === page.season
                            onClicked: page.season = index
                        }
                    }
                }
            }
            Repeater {
                model: seasons.length > page.season ? seasons[page.season].episodes : []
                MouseArea {
                    width: col.width
                    height: 84 * Tokens.u
                    enabled: !!modelData.media_file_id
                    opacity: enabled ? 1 : 0.4
                    onClicked: page.play(modelData.media_file_id, work.title + " · " + (modelData.episode.title || ""))
                    Rectangle {
                        id: thumb
                        x: Tokens.pad
                        width: 120 * Tokens.u
                        height: 68 * Tokens.u
                        radius: 8 * Tokens.u
                        color: Tokens.surfaceSoft
                        clip: true
                        Image {
                            anchors.fill: parent
                            fillMode: Image.PreserveAspectCrop
                            asynchronous: true
                            sourceSize.width: 240
                            source: modelData.media_file_id ? Api.url("/api/v1/media/" + modelData.media_file_id + "/thumbnail") : ""
                        }
                        Rectangle {
                            visible: !!page.progress[modelData.media_file_id] && page.progress[modelData.media_file_id].duration_ms > 0
                            anchors { left: parent.left; bottom: parent.bottom }
                            height: 3 * Tokens.u
                            color: Tokens.brandPink
                            width: visible ? parent.width * Math.min(1, page.progress[modelData.media_file_id].position_ms / page.progress[modelData.media_file_id].duration_ms) : 0
                        }
                    }
                    Column {
                        anchors { left: thumb.right; leftMargin: 12 * Tokens.u; right: parent.right; rightMargin: Tokens.pad; verticalCenter: thumb.verticalCenter }
                        Label {
                            width: parent.width
                            text: modelData.episode.episode_number + ". " + (modelData.episode.title || qsTr("Episode"))
                            elide: Text.ElideRight
                            color: Tokens.ink
                            font.family: Tokens.family
                            font.pixelSize: 15 * Tokens.u
                        }
                        Label {
                            text: minutes(modelData.runtime_ms)
                            color: Tokens.inkMuted
                            font.family: Tokens.family
                            font.pixelSize: 12 * Tokens.u
                        }
                    }
                }
            }

            // Music: albums with tracks
            Repeater {
                model: albums
                Column {
                    width: col.width
                    Label {
                        x: Tokens.pad
                        text: modelData.album.title
                        color: Tokens.ink
                        font.family: Tokens.family
                        font.pixelSize: 20 * Tokens.u
                    }
                    Repeater {
                        model: modelData.tracks
                        MouseArea {
                            width: col.width
                            height: 44 * Tokens.u
                            enabled: !!modelData.media_file_id
                            opacity: enabled ? 1 : 0.4
                            onClicked: page.play(modelData.media_file_id, modelData.track.title)
                            Label {
                                x: Tokens.pad
                                anchors.verticalCenter: parent.verticalCenter
                                width: parent.width - 2 * Tokens.pad
                                text: modelData.track.track_number + ". " + modelData.track.title
                                elide: Text.ElideRight
                                color: Tokens.inkSoft
                                font.family: Tokens.family
                                font.pixelSize: 15 * Tokens.u
                            }
                        }
                    }
                }
            }
        }
        VerticalScrollDecorator {}
        EdgeFade { target: parent }
    }
}
