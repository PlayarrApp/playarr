import QtQuick 2.6
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0
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
        var first = null, unwatched = null, part = null, lead = null
        for (var s = 0; s < seasons.length; ++s) {
            var eps = seasons[s].episodes
            for (var e = 0; e < eps.length; ++e) {
                var id = eps[e].media_file_id
                if (!id) continue
                var t = { id: id, title: work.title + " · S" + seasons[s].season.season_number + "E" + eps[e].episode.episode_number, season: seasons[s].season, episode: eps[e] }
                var st = progress[id] ? progress[id].state : "unseen"
                if (!first) first = t
                if (!lead && plan && plan.target && plan.target.media_file_id === id) lead = t
                if (!part && st === "part_watched") part = t
                if (!unwatched && st !== "watched") unwatched = t
            }
        }
        return lead || part || unwatched || first   // the server's resume plan leads, as on the web
    }
    property var plan: null                 // series: GET /catalog/{id}/resume-plan
    readonly property var targetProgress: target && progress[target.id] && progress[target.id].state === "part_watched" ? progress[target.id] : null

    // Asks the server for a download ticket of the original file; the Downloads tab shows its progress.
    function requestDownload() {
        pageStack.push(Qt.resolvedUrl("DownloadPage.qml"), { mediaFileId: detail.media_file_id, title: work.title, info: { kind: "movie" } })
    }
    function play(id, title) {
        var p = progress[id]
        pageStack.push(Qt.resolvedUrl("PlayerPage.qml"), {
            mediaFileId: id, title: title, workId: work.id,
            startMs: p && p.state === "part_watched" ? p.position_ms : 0 })
    }
    // A stacked plan asks where to continue, records the answer, then plays it (web ResumeChooserModal).
    function resumeSeries() {
        if (!plan || !plan.needs_choice) { play(target.id, target.title); return }
        var pg = pageStack.push(Qt.resolvedUrl("ResumeChooserPage.qml"), { seriesTitle: work.title, plan: plan })
        pg.chosen.connect(function (opt) {
            Api.request("POST", "/api/v1/catalog/" + work.id + "/resume-plan/choice", { kind: opt.kind, episode_id: opt.episode_id }, function (st, p) { if (st === 200 && p) plan = p })
            play(opt.media_file_id, work.title + (opt.title ? " \u00B7 " + opt.title : ""))
        })
    }
    function askAgain() {
        Api.request("DELETE", "/api/v1/catalog/" + work.id + "/resume-plan/choices", null, function () {
            Api.request("GET", "/api/v1/catalog/" + work.id + "/resume-plan", null, function (st, p) { if (st === 200 && p) plan = p })
        })
    }
    function load() {
        if (work.kind === "series")
            Api.request("GET", "/api/v1/catalog/" + work.id + "/resume-plan", null, function (st, p) { if (st === 200 && p) plan = p })
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
    function dmy(iso) { return Qt.formatDate(new Date(iso + "T00:00:00"), "d MMM yyyy").replace(" Sep ", " Sept ") }
    function yearRange() {
        var a = work.release_date ? work.release_date.substr(0, 4) : "", b = work.end_date ? work.end_date.substr(0, 4) : ""
        return a && b && b > a ? a + "\u2013" + b : a
    }
    function minutes(ms) { return ms ? Math.round(ms / 60000) + " min" : "" }
    function mmss(ms) {
        var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60
        return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x
    }

    // Series open scrolled to the next-up episode, as the web focuses it.
    Timer { id: focusEp; interval: 700; onTriggered: if (epPanel.visible) flick.contentY = epPanel.y + 0.5 * Tokens.u }
    SilicaFlickable {
        id: flick
        anchors.fill: parent
        contentHeight: col.height + 110 * Tokens.u
        Column {
            id: col
            width: parent.width
            spacing: 12 * Tokens.u

            // Hero: dim backdrop with the library header and a title watermark, as on web mobile.
            Item {
                width: parent.width
                height: 298 * Tokens.u
                Item {   // the picture bleeds up behind a cutout; the copy below stays inside the safe area
                    y: -Tokens.safeTop; width: parent.width; height: parent.height + Tokens.safeTop
                    clip: true
                    HeroArt { y: 0; work: page.work }
                    Item {
                        y: Tokens.safeTop; width: parent.width; height: 298 * Tokens.u
                        PageTitle {
                            y: 4 * Tokens.u
                            title: work.kind === "movie" ? qsTr("Movies") : work.kind === "series" ? qsTr("Series") : qsTr("Music")
                            filled: true
                            onBackClicked: pageStack.pop()
                        }
                    }
                }
            }
            Label {
                x: Tokens.pad
                text: work.genres && work.genres.length ? work.genres[0].toUpperCase() : ""
                visible: text !== ""
                height: implicitHeight - 6.5 * Tokens.u
                color: Tokens.brandInk
                font.family: Tokens.family820
                font.letterSpacing: 1 * Tokens.u
                font.pixelSize: 10 * Tokens.u
            }
            Label {
                x: Tokens.pad
                width: parent.width - 2 * Tokens.pad
                text: work.title
                wrapMode: Text.Wrap
                color: Tokens.ink
                font.family: Tokens.family580   // web .tv-detail-title: weight 560, letter-spacing -0.072em
                font.letterSpacing: -2.8 * Tokens.u
                font.pixelSize: 38.8 * Tokens.u   // web: clamp(2rem, 10vw, 3.5rem) at 384 px
                lineHeight: 0.92
                topPadding: -3 * Tokens.u   // the taller web title sits 6 px higher in its box
                height: implicitHeight - 2.6 * Tokens.u
            }
            Row {
                x: Tokens.pad
                spacing: 11.5 * Tokens.u
                height: implicitHeight - 1.5 * Tokens.u
                Label { text: work.kind === "movie" ? qsTr("Movie") : work.kind === "series" ? qsTr("Series") : qsTr("Music"); font.weight: Font.Bold; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                Label { visible: !!detail && !!detail.runtime_ms; text: detail ? hm(detail.runtime_ms) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                Label { visible: !!work.release_date; text: yearRange(); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                Label { visible: !!work.release_date; text: work.release_date ? qsTr("Released %1").arg(dmy(work.release_date)) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                Repeater {
                    model: work.genres ? work.genres.slice(0, 3) : []
                    Label { text: modelData; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                }
            }
            Label {
                x: Tokens.pad
                width: parent.width - 2 * Tokens.pad
                visible: !!work.overview
                text: work.overview || ""
                wrapMode: Text.Wrap
                maximumLineCount: 3
                elide: Text.ElideRight
                color: Tokens.inkSoft
                font.family: Tokens.family
                font.pixelSize: 11.7 * Tokens.u
                lineHeight: 0.98
                bottomPadding: 1.5 * Tokens.u
            }
            Row {
                x: Tokens.pad
                spacing: 8 * Tokens.u
                visible: !!page.target
                // Web: Download is as wide as its content; Playback and Play share the rest equally.
                readonly property real fillW: (col.width - 2 * Tokens.pad - (dlBtn.visible ? dlBtn.width + spacing : 0) - spacing) / 2
                PillButton {
                    lift: true
                    id: dlBtn
                    visible: !!detail && !!detail.media_file_id
                    icon: "\u21E9"; iconSize: 10 * Tokens.u; labelFamily: Tokens.family610
                    text: qsTr("Download")
                    fontSize: 8.5 * Tokens.u
                    onClicked: page.requestDownload()
                }
                PillButton {
                    lift: true
                    icon: "\u2637"; iconSize: 13 * Tokens.u; labelFamily: Tokens.family610
                    text: qsTr("Playback")
                    width: parent.fillW
                    fontSize: 11 * Tokens.u
                    onClicked: pageStack.push(Qt.resolvedUrl("ActionsPage.qml"), { work: page.work })
                }
                PillButton {
                    lift: true
                    primary: work.kind !== "movie"
                    fill: work.kind === "movie" ? "#a52745" : "transparent"; fillInk: "#ffffff"   // web: the film's Play holds the default focus, drawn crimson
                    icon: "\u25B6"; iconSize: 9 * Tokens.u; labelFamily: Tokens.family610
                    fontSize: 11 * Tokens.u
                    implicitHeight: 44 * Tokens.u
                    width: parent.fillW
                    text: page.targetProgress ? qsTr("Resume from %1").arg(mmss(page.targetProgress.position_ms)) : qsTr("Play")
                    onClicked: page.resumeSeries()
                }
            }
            Row {
                x: Tokens.pad
                spacing: 8 * Tokens.u
                visible: !!page.detail
                PillButton {
                    lift: true
                    icon: page.inWatchlist ? "\u2713" : "+"; iconSize: 9 * Tokens.u; labelFamily: Tokens.family610
                    text: page.inWatchlist ? qsTr("Remove from watchlist") : qsTr("Add to watchlist")
                    fontSize: 8.5 * Tokens.u
                    onClicked: page.toggleWatchlist()
                }
                PillButton {
                    lift: true
                    icon: "+"; iconSize: 9 * Tokens.u; labelFamily: Tokens.family610
                    text: qsTr("Add to Playlist")
                    fontSize: 8.5 * Tokens.u
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
                spacing: 11.5 * Tokens.u
                visible: seasons.length > 0 && !!page.target && !!page.target.episode
                Label {
                    x: Tokens.pad; width: parent.width - 2 * Tokens.pad
                    text: page.target && page.target.episode ? (page.target.episode.episode.title || qsTr("Episode")) : ""
                    elide: Text.ElideRight
                    color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 15 * Tokens.u
                    height: implicitHeight - 3 * Tokens.u
                }
                Row {
                    x: Tokens.pad; spacing: 11.5 * Tokens.u
                    Label { text: page.target && page.target.season ? qsTr("Season %1").arg(page.target.season.season_number) : ""; font.weight: Font.Bold; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                    Label { text: page.target && page.target.episode ? "S" + ("0" + page.target.season.season_number).slice(-2) + " \u00B7 E" + ("0" + page.target.episode.episode.episode_number).slice(-2) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                    Label { visible: !!page.target && !!page.target.episode && !!page.target.episode.runtime_ms; text: page.target && page.target.episode ? Math.round((page.target.episode.runtime_ms || 0) / 60000) + " min" : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                    Label { visible: yearRange() !== ""; text: yearRange(); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                    Label { visible: !!page.target && !!page.target.episode && !!page.target.episode.episode.air_date; text: page.target && page.target.episode && page.target.episode.episode.air_date ? qsTr("Aired %1").arg(dmy(page.target.episode.episode.air_date)) : ""; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                    Repeater {
                        model: work.genres ? work.genres.slice(0, 3) : []
                        Label { text: modelData; color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                    }
                }
                Label {
                    x: Tokens.pad; width: parent.width - 2 * Tokens.pad
                    visible: !!page.target && !!page.target.episode && !!page.target.episode.episode.overview
                    text: page.target && page.target.episode ? (page.target.episode.episode.overview || "") : ""
                    wrapMode: Text.Wrap; maximumLineCount: 3; elide: Text.ElideRight
                    color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 11.7 * Tokens.u; lineHeight: 0.97
                }
                // The web lays the actions over a faded slice of the series backdrop.
                Item {
                    width: parent.width; height: 67 * Tokens.u
                    z: -1   // the slice starts above the row, under the overview text
                    // The web's key art is pinned to the top of the screen (sticky); only the part below the copy shows.
                    Item {
                        id: stripWindow
                        y: -2.5 * Tokens.u; width: parent.width; height: 100 * Tokens.u; clip: true
                        HeroArt {
                            id: stickyArt
                            bleed: false
                            y: { flick.contentY; return -stripWindow.mapToItem(page, 0, 0).y }
                            work: page.work; kinds: ["backdrop", "poster", "thumb"]
                            artOpacity: Tokens.dark ? 0.2 : 0.42
                        }
                    }
                    Row {
                        y: 2 * Tokens.u
                        x: Tokens.pad
                        spacing: 8 * Tokens.u
                        PillButton {
                            lift: true
                            primary: true
                            icon: "\u25B6"; iconSize: 9 * Tokens.u; labelFamily: Tokens.family610
                            fontSize: 11 * Tokens.u
                            implicitHeight: 43.5 * Tokens.u
                            width: col.width - 2 * Tokens.pad - (askBtn.visible ? 3 : 2) * parent.spacing - wlBtn.width - plBtn.width - (askBtn.visible ? askBtn.width : 0)
                            text: page.plan ? (page.plan.action === "start" ? qsTr("Start") : page.plan.action === "restart" ? qsTr("Watch again") : qsTr("Resume")) : page.targetProgress ? qsTr("Resume") : qsTr("Play")
                            onClicked: page.resumeSeries()
                        }
                        PillButton {
                            lift: true
                            id: askBtn
                            visible: !!page.plan && page.plan.action !== "start"
                            icon: "\u21BA"; iconSize: 10 * Tokens.u; labelFamily: Tokens.family610
                            fontSize: 8.5 * Tokens.u
                            implicitHeight: 43.5 * Tokens.u
                            text: qsTr("Ask again")
                            onClicked: page.askAgain()
                        }
                        PillButton {
                            lift: true
                            id: wlBtn
                            width: naturalWidth + 1 * Tokens.u   // web's pill runs a little wider than its content
                            icon: page.inWatchlist ? "\u2713" : "+"; iconSize: 9 * Tokens.u; labelFamily: Tokens.family610
                            fontSize: 8.0 * Tokens.u
                            implicitHeight: 43.5 * Tokens.u
                            text: page.inWatchlist ? qsTr("Remove from watchlist") : qsTr("Add to watchlist")
                            onClicked: page.toggleWatchlist()
                        }
                        PillButton {
                            lift: true
                            id: plBtn
                            width: naturalWidth + 3.5 * Tokens.u
                            icon: "+"; iconSize: 9 * Tokens.u; labelFamily: Tokens.family610
                            fontSize: 8.0 * Tokens.u
                            implicitHeight: 43.5 * Tokens.u
                            text: qsTr("Add to Playlist")
                            onClicked: pageStack.push(Qt.resolvedUrl("ActionsPage.qml"), { work: page.work })
                        }
                    }
                }
            }
            Item { width: 1; height: 8 * Tokens.u }
            Repeater {
                model: seasons
                Column {
                    id: seasonCol
                    width: col.width
                    spacing: 6 * Tokens.u   // web: 24 px from the season heading to its count
                    property var sdata: modelData
                    Label { x: Tokens.pad; text: qsTr("Season %1").arg(modelData.season.season_number); color: Tokens.ink; font.family: Tokens.family580; font.pixelSize: 15.4 * Tokens.u }
                    Label { x: Tokens.pad; text: qsTr("%1 episodes").arg(modelData.episodes.length); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10.6 * Tokens.u }
                    Item { width: 1; height: 6.5 * Tokens.u }
                    Item {
                        width: col.width; height: 178.8 * Tokens.u * 9 / 16 + 58 * Tokens.u
                    ListView {
                        id: epList
                        y: -24 * Tokens.u; width: col.width   // room for the focus ring and its glow above the card inside the clip
                        height: parent.height + 32 * Tokens.u
                        orientation: ListView.Horizontal
                        spacing: 12.2 * Tokens.u
                        leftMargin: Tokens.pad
                        rightMargin: Tokens.pad
                        clip: true
                        model: modelData.episodes
                        // The web opens each rail at the next-up episode of its own season.
                        function focusNext() {
                            if (!page.target || !page.target.season || page.target.season.id !== seasonCol.sdata.season.id) return
                            for (var i = 0; i < modelData.episodes.length; ++i)
                                if (modelData.episodes[i].media_file_id === page.target.id) { positionViewAtIndex(i, ListView.Beginning); contentX -= Tokens.pad; return }
                        }
                        Timer { id: railTimer; interval: 300; onTriggered: epList.focusNext() }
                        Component.onCompleted: railTimer.start()
                        Connections { target: page; onTargetChanged: railTimer.restart() }
                        delegate: MouseArea {
                                y: 24 * Tokens.u
                                id: epCard
                                readonly property real cw: 178.8 * Tokens.u
                                width: cw
                                height: cw * 9 / 16 + 34 * Tokens.u
                                enabled: !!modelData.media_file_id
                                opacity: enabled ? 1 : 0.4
                                onClicked: page.play(modelData.media_file_id, work.title + " \u00B7 " + (modelData.episode.title || ""))
                                // Press and hold: download this episode (grouped by series and season in the Downloads tab).
                                onPressAndHold: pageStack.push(Qt.resolvedUrl("DownloadPage.qml"), {
                                    mediaFileId: modelData.media_file_id, title: work.title + " \u00B7 " + (modelData.episode.title || ""),
                                    info: { kind: "episode", series: work.title, season: seasonCol.sdata.season.season_number, episode: modelData.episode.episode_number } })
                                property var pr: page.progress[modelData.media_file_id]
                                RectangularGlow {   // web card shadow, 0 10px 20px / 0 3px 8px of the ink tone
                                    visible: !Tokens.dark
                                    x: 0; y: 10 * Tokens.u; width: parent.width; height: parent.width * 9 / 16
                                    glowRadius: 14 * Tokens.u; spread: 0.1; cornerRadius: 8 * Tokens.u + glowRadius
                                    color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.16)
                                }
                                Rectangle {
                                    id: thumb
                                    width: parent.width; height: parent.width * 9 / 16
                                    radius: 8 * Tokens.u; color: Tokens.surfaceSoft
                                    Item {
                                        id: thumbArt
                                        anchors.fill: parent; visible: false
                                        Image {
                                            // The web prefers the episode's own still, then the media-file frame.
                                            readonly property bool hasStill: (modelData.episode.images || []).some(function (i) { return i.kind === "thumb" })
                                            anchors.fill: parent; fillMode: Image.PreserveAspectCrop; asynchronous: true; mipmap: true; sourceSize.width: 540
                                            source: hasStill ? Api.url("/api/v1/artwork/episode/" + work.id + "/" + modelData.episode.id + "/thumb?width=540")
                                                  : modelData.media_file_id ? Api.url("/api/v1/media/" + modelData.media_file_id + "/thumbnail") : ""
                                        }
                                        Rectangle {   // web: linear-gradient(135deg, black 5%, black 48%) over the picture
                                            anchors.centerIn: parent
                                            width: parent.width + parent.height; height: width * 0.7071; rotation: -45
                                            gradient: Gradient {
                                                GradientStop { position: 0.0; color: Qt.rgba(0, 0, 0, 0.05) }
                                                GradientStop { position: 1.0; color: Qt.rgba(0, 0, 0, 0.48) }
                                            }
                                        }
                                    }
                                    Rectangle { id: thumbMask; anchors.fill: parent; radius: thumb.radius; visible: false }
                                    Desaturate { id: thumbGrey; anchors.fill: parent; source: thumbArt; desaturation: 0.25; visible: false }
                                    OpacityMask { anchors.fill: parent; source: thumbGrey; maskSource: thumbMask }
                                    Label { anchors { right: parent.right; bottom: parent.bottom; rightMargin: 11.5 * Tokens.u; bottomMargin: 8.8 * Tokens.u }
                                            text: ("0" + modelData.episode.episode_number).slice(-2); color: "#ffffff"; font.family: Tokens.family580; font.pixelSize: 12.8 * Tokens.u }
                                    UnseenDot {
                                        visible: !epCard.pr || epCard.pr.state === "unseen"
                                        anchors { top: parent.top; right: parent.right; topMargin: 7 * Tokens.u; rightMargin: 7 * Tokens.u }
                                    }
                                    Rectangle {
                                        visible: !!epCard.pr && epCard.pr.state === "part_watched" && epCard.pr.duration_ms > 0
                                        anchors { left: parent.left; bottom: parent.bottom }
                                        height: 3 * Tokens.u; color: Tokens.brandPink
                                        width: visible ? parent.width * Math.min(1, epCard.pr.position_ms / epCard.pr.duration_ms) : 0
                                    }
                                }
                                readonly property bool next: !!page.target && page.target.id === modelData.media_file_id
                                readonly property color ringColor: Tokens.dark ? Qt.rgba(197 / 255, 138 / 255, 151 / 255, 1) : Qt.rgba(141 / 255, 37 / 255, 60 / 255, 1)
                                // Web's focused card (page-layout.css --card-shadow-focus), as WorkCard draws it.
                                RectangularGlow {
                                    visible: epCard.next
                                    z: -1; y: 24 * Tokens.u; width: thumb.width; height: thumb.height
                                    glowRadius: 24 * Tokens.u; spread: 0.1; cornerRadius: thumb.radius + glowRadius
                                    color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.3)
                                }
                                RectangularGlow {
                                    visible: epCard.next
                                    z: -1; y: 10 * Tokens.u; width: thumb.width; height: thumb.height
                                    glowRadius: 10 * Tokens.u; spread: 0.1; cornerRadius: thumb.radius + glowRadius
                                    color: Qt.rgba(56 / 255, 38 / 255, 33 / 255, 0.2)
                                }
                                RectangularGlow {
                                    visible: epCard.next
                                    z: -1; width: thumb.width; height: thumb.height
                                    glowRadius: 10 * Tokens.u; spread: 0.25; cornerRadius: thumb.radius + glowRadius
                                    color: Qt.rgba(epCard.ringColor.r, epCard.ringColor.g, epCard.ringColor.b, 0.45)
                                }
                                Rectangle {   // web focus ring on the next-up episode
                                    visible: epCard.next
                                    anchors { fill: thumb; margins: -3 * Tokens.u }
                                    radius: thumb.radius + 3 * Tokens.u; color: "transparent"
                                    border.width: 3 * Tokens.u; border.color: epCard.ringColor
                                }
                                Row {
                                    anchors { top: thumb.bottom; topMargin: 12 * Tokens.u; left: parent.left; right: parent.right; }
                                    spacing: 9.5 * Tokens.u
                                    readonly property bool current: !!page.target && page.target.id === modelData.media_file_id
                                    Label { id: codeLbl; text: "S" + ("0" + seasonCol.sdata.season.season_number).slice(-2) + " \u00B7 E" + ("0" + modelData.episode.episode_number).slice(-2); color: parent.current ? Tokens.ink : Tokens.inkSoft; font.family: parent.current ? Tokens.family820 : Tokens.family580; font.pixelSize: 9.5 * Tokens.u }
                                    Label {
                                        id: titleLbl
                                        width: epCard.width - codeLbl.width - 14 * Tokens.u
                                        text: modelData.episode.title || ""; elide: Text.ElideRight
                                        color: Tokens.ink; font.family: Tokens.family580; font.pixelSize: 12 * Tokens.u
                                    }
                                }
                        }
                    }
                                            EdgeFade { target: epList; horizontal: true; size: 38 * Tokens.u }   // web: --page-edge-fade-size
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
        blurSource: flick
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; leftMargin: 10 * Tokens.u; rightMargin: 10 * Tokens.u; bottomMargin: 7 * Tokens.u }
        section: page.work.kind === "movie" ? "movies" : page.work.kind === "series" ? "series" : "music"
        onSelected: {
            var mp = pageStack.find(function (p) { return p.objectName === "main" })
            if (mp) { mp.section = target; pageStack.pop(mp) }
        }
        onProfileClicked: pageStack.push(Qt.resolvedUrl("ProfilesPage.qml"))
    }
}
