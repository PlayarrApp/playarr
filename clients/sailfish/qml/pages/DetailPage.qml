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
                var t = { id: id, title: work.title + " · S" + seasons[s].season.season_number + "E" + eps[e].episode.episode_number, season: seasons[s].season, episode: eps[e] }
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
    onDetailChanged: if (detail) { work = detail.work; resolveWatchlist(); focusEp.restart() }
    onStatusChanged: if (status === PageStatus.Active && detail) load() // refresh resume state after playback
    Component.onCompleted: load()

    function hm(ms) { var m = Math.round(ms / 60000); return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m" }
    property bool inWatchlist: false
    property string titleKey: ""
    function snapshot() { return { kind: work.kind, title: work.title, work_id: work.id, year: work.release_date ? Number(work.release_date.substr(0, 4)) : null } }
    function resolveWatchlist() {
        Api.request("POST", "/api/v1/discover/resolve", snapshot(), function (st, r) {
            if (st === 200 && r) { inWatchlist = !!r.in_watchlist; titleKey = r.title ? r.title.title_key : "" }
        })
    }
    function toggleWatchlist() {
        if (inWatchlist && titleKey) {
            Api.request("DELETE", "/api/v1/watchlist/" + encodeURIComponent(titleKey), null, function () { inWatchlist = false })
        } else {
            Api.request("POST", "/api/v1/watchlist", snapshot(), function (st, r) {
                if (st === 200 && r) { inWatchlist = true; titleKey = r.title ? r.title.title_key : titleKey }
            })
        }
    }
    function minutes(ms) { return ms ? Math.round(ms / 60000) + " min" : "" }
    function mmss(ms) {
        var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60
        return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x
    }

    // Series open scrolled to the next-up episode, as the web focuses it.
    Timer { id: focusEp; interval: 700; onTriggered: if (epPanel.visible) flick.contentY = epPanel.y - 6 * Tokens.u }
    SilicaFlickable {
        id: flick
        anchors.fill: parent
        contentHeight: col.height + 110 * Tokens.u
        Column {
            id: col
            width: parent.width
            spacing: 14 * Tokens.u

            // Hero: dim backdrop with the library header and a title watermark, as on web mobile.
            Item {
                width: parent.width
                height: 292 * Tokens.u
                Artwork {
                    anchors.fill: parent
                    radius: 0
                    hero: true
                    opacity: Tokens.dark ? 0.16 : 0.28
                    work: page.work
                    kinds: ["backdrop", "poster", "thumb"]
                }
                Rectangle {
                    anchors.fill: parent
                    gradient: Gradient {
                        GradientStop { position: 0.0; color: "transparent" }
                        GradientStop { position: 1.0; color: Tokens.bg }
                    }
                }
                Label {
                    x: Tokens.pad + 4 * Tokens.u
                    y: 86 * Tokens.u
                    width: parent.width - 2 * Tokens.pad
                    text: work.title
                    wrapMode: Text.Wrap
                    maximumLineCount: 3
                    lineHeight: 0.85
                    color: Tokens.ink
                    opacity: 0.04
                    font.family: Tokens.family
                    font.weight: Font.Bold
                    font.pixelSize: 62 * Tokens.u
                }
                PageTitle {
                    y: 4 * Tokens.u
                    title: work.kind === "movie" ? qsTr("Movies") : work.kind === "series" ? qsTr("Series") : qsTr("Music")
                    onBackClicked: pageStack.pop()
                }
                Label {
                    x: 72 * Tokens.u
                    y: 64 * Tokens.u
                    text: work.title.toUpperCase()
                    color: Tokens.brandPinkSoft
                    font.family: Tokens.family
                    font.weight: Font.Bold
                    font.letterSpacing: 1 * Tokens.u
                    font.pixelSize: 9.5 * Tokens.u
                }
            }
            Label {
                x: Tokens.pad + 4 * Tokens.u
                text: work.genres && work.genres.length ? work.genres[0].toUpperCase() : ""
                visible: text !== ""
                color: Tokens.brandPinkSoft
                font.family: Tokens.family
                font.weight: Font.Bold
                font.letterSpacing: 1 * Tokens.u
                font.pixelSize: 10 * Tokens.u
            }
            Label {
                x: Tokens.pad + 4 * Tokens.u
                width: parent.width - 2 * Tokens.pad
                text: work.title
                wrapMode: Text.Wrap
                color: Tokens.ink
                font.family: Tokens.family
                font.weight: Font.Bold
                font.letterSpacing: -1 * Tokens.u
                font.pixelSize: 35 * Tokens.u
                lineHeight: 0.92
            }
            Row {
                x: Tokens.pad + 4 * Tokens.u
                spacing: 11 * Tokens.u
                Label { text: work.kind === "movie" ? qsTr("Movie") : work.kind === "series" ? qsTr("Series") : qsTr("Music"); font.weight: Font.Bold; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                Label { visible: !!detail && !!detail.runtime_ms; text: detail ? hm(detail.runtime_ms) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                Label { visible: !!work.release_date; text: work.release_date ? work.release_date.substr(0, 4) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                Label { visible: !!work.release_date; text: work.release_date ? qsTr("Released %1").arg(Qt.formatDate(new Date(work.release_date + "T00:00:00"), "d MMM yyyy")) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                Repeater {
                    model: work.genres ? work.genres.slice(0, 3) : []
                    Label { text: modelData; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                }
            }
            Label {
                x: Tokens.pad + 4 * Tokens.u
                width: parent.width - 2 * Tokens.pad
                visible: !!work.overview
                text: work.overview || ""
                wrapMode: Text.Wrap
                maximumLineCount: 3
                elide: Text.ElideRight
                color: Tokens.inkSoft
                font.family: Tokens.family
                font.pixelSize: 11 * Tokens.u
            }
            Row {
                x: Tokens.pad
                spacing: 8 * Tokens.u
                visible: !!page.target
                PillButton {
                    visible: !!detail && !!detail.media_file_id
                    text: page.downloadNote !== "" ? page.downloadNote : "\u21E9  " + qsTr("Download")
                    implicitWidth: 106 * Tokens.u
                    fontSize: 9.5 * Tokens.u
                    onClicked: page.requestDownload()
                }
                PillButton {
                    text: "\u2630  " + qsTr("Playback")
                    implicitWidth: 120 * Tokens.u
                    fontSize: 11.5 * Tokens.u
                    onClicked: pageStack.push(Qt.resolvedUrl("ActionsPage.qml"), { work: page.work })
                }
                PillButton {
                    primary: true
                    fontSize: 11.5 * Tokens.u
                    implicitHeight: 44 * Tokens.u
                    implicitWidth: 122 * Tokens.u
                    text: "\u25B6  " + (page.targetProgress ? qsTr("Resume from %1").arg(mmss(page.targetProgress.position_ms)) : qsTr("Play"))
                    onClicked: page.play(page.target.id, page.target.title)
                }
            }
            Row {
                x: Tokens.pad
                spacing: 8 * Tokens.u
                visible: !!page.detail
                PillButton {
                    text: "+  " + (page.inWatchlist ? qsTr("In watchlist") : qsTr("Add to watchlist"))
                    implicitWidth: 142 * Tokens.u
                    fontSize: 9.5 * Tokens.u
                    onClicked: page.toggleWatchlist()
                }
                PillButton {
                    text: "+  " + qsTr("Add to Playlist")
                    implicitWidth: 126 * Tokens.u
                    fontSize: 9.5 * Tokens.u
                    onClicked: pageStack.push(Qt.resolvedUrl("ActionsPage.qml"), { work: page.work })
                }
            }
            BusyIndicator { anchors.horizontalCenter: parent.horizontalCenter; size: BusyIndicatorSize.Medium; running: !detail && !failed }
            Label {
                x: Tokens.pad
                visible: failed
                text: qsTr("Could not load this title")
                color: Tokens.danger
                font.family: Tokens.family
            }

            // Series: the next-up episode panel, then every season as a two-column grid of episode cards (web).
            Column {
                id: epPanel
                width: parent.width
                spacing: 10 * Tokens.u
                visible: seasons.length > 0 && !!page.target && !!page.target.episode
                Label {
                    x: Tokens.pad + 4 * Tokens.u; width: parent.width - 2 * Tokens.pad
                    text: page.target && page.target.episode ? (page.target.episode.episode.title || qsTr("Episode")) : ""
                    elide: Text.ElideRight
                    color: Tokens.ink; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: 15 * Tokens.u
                }
                Row {
                    x: Tokens.pad + 4 * Tokens.u; spacing: 11 * Tokens.u
                    Label { text: page.target && page.target.season ? qsTr("Season %1").arg(page.target.season.season_number) : ""; font.weight: Font.Bold; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                    Label { text: page.target && page.target.episode ? "S" + ("0" + page.target.season.season_number).slice(-2) + " \u00B7 E" + ("0" + page.target.episode.episode.episode_number).slice(-2) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                    Label { visible: !!page.target && !!page.target.episode && !!page.target.episode.runtime_ms; text: page.target && page.target.episode ? Math.round((page.target.episode.runtime_ms || 0) / 60000) + " min" : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                    Label { visible: !!page.target && !!page.target.episode && !!page.target.episode.episode.air_date; text: page.target && page.target.episode && page.target.episode.episode.air_date ? qsTr("Aired %1").arg(Qt.formatDate(new Date(page.target.episode.episode.air_date + "T00:00:00"), "d MMM yyyy")) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                }
                Label {
                    x: Tokens.pad + 4 * Tokens.u; width: parent.width - 2 * Tokens.pad
                    visible: !!page.target && !!page.target.episode && !!page.target.episode.episode.overview
                    text: page.target && page.target.episode ? (page.target.episode.episode.overview || "") : ""
                    wrapMode: Text.Wrap; maximumLineCount: 3; elide: Text.ElideRight
                    color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u
                }
                Row {
                    x: Tokens.pad
                    spacing: 8 * Tokens.u
                    PillButton {
                        primary: true
                        fontSize: 11 * Tokens.u
                        implicitWidth: 100 * Tokens.u
                        text: "\u25B6  " + (page.targetProgress ? qsTr("Resume") : qsTr("Play"))
                        onClicked: page.play(page.target.id, page.target.title)
                    }
                    PillButton {
                        fontSize: 9.5 * Tokens.u
                        implicitWidth: 142 * Tokens.u
                        text: "+  " + (page.inWatchlist ? qsTr("In watchlist") : qsTr("Add to watchlist"))
                        onClicked: page.toggleWatchlist()
                    }
                    PillButton {
                        fontSize: 9.5 * Tokens.u
                        implicitWidth: 126 * Tokens.u
                        text: "+  " + qsTr("Add to Playlist")
                        onClicked: pageStack.push(Qt.resolvedUrl("ActionsPage.qml"), { work: page.work })
                    }
                }
            }
            Repeater {
                model: seasons
                Column {
                    id: seasonCol
                    width: col.width
                    spacing: 8 * Tokens.u
                    property var sdata: modelData
                    Label { x: Tokens.pad + 4 * Tokens.u; text: qsTr("Season %1").arg(modelData.season.season_number); color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 17 * Tokens.u }
                    Label { x: Tokens.pad + 4 * Tokens.u; text: qsTr("%1 episodes").arg(modelData.episodes.length); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                    ListView {
                        width: col.width
                        height: 176 * Tokens.u * 9 / 16 + 40 * Tokens.u
                        orientation: ListView.Horizontal
                        spacing: 12 * Tokens.u
                        leftMargin: Tokens.pad
                        rightMargin: Tokens.pad
                        clip: true
                        model: modelData.episodes
                        delegate: MouseArea {
                                id: epCard
                                readonly property real cw: 176 * Tokens.u
                                width: cw
                                height: cw * 9 / 16 + 34 * Tokens.u
                                enabled: !!modelData.media_file_id
                                opacity: enabled ? 1 : 0.4
                                onClicked: page.play(modelData.media_file_id, work.title + " \u00B7 " + (modelData.episode.title || ""))
                                property var pr: page.progress[modelData.media_file_id]
                                Rectangle {
                                    id: thumb
                                    width: parent.width; height: parent.width * 9 / 16
                                    radius: 10 * Tokens.u; color: Tokens.surfaceSoft; clip: true
                                    Image {
                                        anchors.fill: parent; fillMode: Image.PreserveAspectCrop; asynchronous: true; sourceSize.width: 400
                                        source: modelData.media_file_id ? Api.url("/api/v1/media/" + modelData.media_file_id + "/thumbnail") : ""
                                    }
                                    Label { anchors { right: parent.right; bottom: parent.bottom; margins: 8 * Tokens.u }
                                            text: ("0" + modelData.episode.episode_number).slice(-2); color: "#ffffff"; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
                                    Rectangle {
                                        visible: !epCard.pr || epCard.pr.state === "unseen"
                                        width: 10 * Tokens.u; height: width; radius: width / 2
                                        anchors { top: parent.top; right: parent.right; topMargin: 7 * Tokens.u; rightMargin: 7 * Tokens.u }
                                        color: Tokens.brandPink; border.width: 1.6 * Tokens.u; border.color: "#ffffff"
                                    }
                                    Rectangle {
                                        visible: !!epCard.pr && epCard.pr.state === "part_watched" && epCard.pr.duration_ms > 0
                                        anchors { left: parent.left; bottom: parent.bottom }
                                        height: 3 * Tokens.u; color: Tokens.brandPink
                                        width: visible ? parent.width * Math.min(1, epCard.pr.position_ms / epCard.pr.duration_ms) : 0
                                    }
                                }
                                Row {
                                    anchors { top: thumb.bottom; topMargin: 8 * Tokens.u; left: parent.left; right: parent.right; leftMargin: 4 * Tokens.u }
                                    spacing: 6 * Tokens.u
                                    Label { id: codeLbl; text: "S" + ("0" + seasonCol.sdata.season.season_number).slice(-2) + " \u00B7 E" + ("0" + modelData.episode.episode_number).slice(-2); color: Tokens.ink; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: 8.5 * Tokens.u }
                                    Label { width: epCard.width - codeLbl.width - 14 * Tokens.u; text: modelData.episode.title || ""; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 9 * Tokens.u }
                                }
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

    // The web keeps its nav on title pages; selecting a tab returns to the shell on that section.
    NavBar {
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: 12 * Tokens.u; rightMargin: 12 * Tokens.u; bottomMargin: 8 * Tokens.u }
        section: page.work.kind === "movie" ? "movies" : page.work.kind === "series" ? "series" : "music"
        onSelected: {
            var mp = pageStack.find(function (p) { return p.objectName === "main" })
            if (mp) { mp.section = target; pageStack.pop(mp) }
        }
        onProfileClicked: pageStack.push(Qt.resolvedUrl("ProfilesPage.qml"))
    }
}
