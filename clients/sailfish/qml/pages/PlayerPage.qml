import QtQuick 2.6
import QtMultimedia 5.6
import Sailfish.Silica 1.0
import "../components"

// Fullscreen player: server-negotiated playback (direct or HLS) with resume and progress reporting.
Page {
    id: page
    property string mediaFileId
    property string title
    property int startMs: 0
    property string workId: ""           // for the now-playing artwork
    property string localPath: ""         // offline copy: no negotiation, no server reporting

    property var info: null
    property int offsetMs: 0          // HLS renditions start at source_offset_ms
    property bool controls: true
    property string error: ""
    property bool closing: false
    property bool pendingSeek: false
    property alias engine: player        // for smoke scripts (pause to hold the controls)
    property string nowPlayingArt: ""
    property bool menuOpen: false
    property string notice: ""             // "Waiting for transcode capacity"
    // Server-side choices that survive renegotiation.
    property int audioIndex: -1
    property string profile: ""
    property bool forceTranscode: false
    property bool ignoreSaved: false
    property string subtitleId: ""
    property var cues: []
    readonly property string cueText: subtitleId !== "" ? Playback.cueAt(cues, positionMs) : ""
    readonly property int durationMs: info && info.duration_ms > 0 ? info.duration_ms : player.duration
    readonly property int positionMs: offsetMs + player.position

    allowedOrientations: Orientation.All
    palette.colorScheme: Theme.LightOnDark
    background: Component { Rectangle { color: "black" } }
    showNavigationIndicator: false
    backNavigation: false

    function mmss(ms) {
        var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60
        return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x
    }

    function event(body) {
        if (info && body && info.mode !== "local") Api.request("POST", "/api/v1/playback/sessions/" + info.session_id + "/events", body, null)
    }
    function checkpoint(completed) {
        if (localPath !== "") return
        if (positionMs <= 0 || !durationMs) return
        Api.request("PUT", "/api/v1/playback/" + mediaFileId + "/progress",
                    { position_ms: positionMs, duration_ms: durationMs, completed: completed || positionMs >= durationMs - 5000 }, null)
    }

    // Negotiates (or renegotiates) playback at fromMs; 503 (no transcode capacity) is retried with backoff.
    function open(fromMs, attempt) {
        attempt = attempt || 0
        error = ""
        var q = Playback.query({ startMs: fromMs, profile: profile, forceTranscode: forceTranscode,
                                 audioStreamIndex: audioIndex, ignoreSaved: ignoreSaved,
                                 forceDirectVideo: Api.setting("forceDirectVideo", false) === true || Api.setting("forceDirectVideo", false) === "true",
                                 forceDirectAudio: Api.setting("forceDirectAudio", false) === true || Api.setting("forceDirectAudio", false) === "true" })
        Api.request("GET", "/api/v1/playback/" + mediaFileId + "?" + q, null, function (status, data) {
            if (closing) return
            if (status === 503 && Playback.retryDelayMs(attempt) > 0) {
                page.notice = qsTr("Waiting for transcode capacity")
                retry.attempt = attempt + 1
                retry.from = fromMs
                retry.interval = Playback.retryDelayMs(attempt)
                retry.restart()
                return
            }
            page.notice = ""
            if (status !== 200 || !data) {
                // 422 unsupported_colour_format: show the server's message, no retry.
                error = Playback.negotiationMessage(status, data || {}) || qsTr("Playback is not available for this title.")
                return
            }
            var first = !info
            info = data
            console.log("playback mode", data.mode, data.mime_type, "dur", data.duration_ms, "offset", data.source_offset_ms, "path", String(data.url).split("?")[0])
            offsetMs = data.mode === "hls" ? (data.source_offset_ms || 0) : 0
            pendingSeek = data.mode !== "hls" && fromMs > 0
            player.source = Api.playbackUrl(data.url, data.session_id)
            player.play()
            event({ kind: "start" })
            if (first) {
                audioIndex = -1
                chooseSubtitle(Playback.pickSubtitle(data.subtitle_tracks || [], Api.setting("subtitleMode", "off"), Api.setting("subtitleLanguage", "en")))
            }
        })
    }
    Timer {
        id: retry
        property int attempt: 0
        property int from: 0
        onTriggered: page.open(from, attempt)
    }

    function chooseSubtitle(id) {
        subtitleId = id
        cues = []
        if (id === "" || !info) return
        for (var i = 0; i < info.subtitle_tracks.length; ++i) {
            var t = info.subtitle_tracks[i]
            if (t.id !== id) continue
            Api.requestText(t.url, function (status, text) {
                if (subtitleId === id && status === 200 && text) cues = Playback.parseVtt(text)
            })
        }
    }
    function audioSelected(t) {
        return audioIndex >= 0 ? t.stream_index === audioIndex : t.id === info.selected_audio_track_id
    }
    // Audio and quality switch server-side: renegotiate at the current position.
    function switchAudio(track) {
        audioIndex = track.stream_index
        menuOpen = false
        renegotiate()
    }
    function switchQuality(option) {
        profile = option ? option.profile || "" : ""
        forceTranscode = !!option && !!option.profile
        ignoreSaved = !option
        menuOpen = false
        renegotiate()
    }
    function renegotiate() {
        var at = positionMs
        event({ kind: "stop", reason: "user_stopped", position_ms: at })
        player.stop()
        open(at)
    }

    function seekTo(ms) {
        ms = Math.max(0, Math.min(durationMs, ms))
        if (info && info.mode === "hls") {
            event({ kind: "stop", reason: "user_stopped", position_ms: positionMs })
            player.stop()
            open(ms)
        } else {
            event({ kind: "seek", from_ms: positionMs, to_ms: ms })
            player.seek(ms)
        }
    }

    function close(completed) {
        if (closing) return
        closing = true
        checkpoint(completed)
        event({ kind: "stop", reason: completed ? "completed" : "user_stopped", position_ms: positionMs })
        player.stop()
        pageStack.pop()
    }

    Component.onCompleted: {
        if (workId !== "") Api.fetchToCache(Api.artworkOf(workId, "poster"), "now-playing.jpg", function (st, u) { if (st === 200) nowPlayingArt = u })
        if (localPath === "") { open(startMs); return }
        info = { mode: "local", duration_ms: 0, session_id: "", audio_tracks: [], subtitle_tracks: [], quality_options: [] }
        pendingSeek = startMs > 0
        player.source = "file://" + localPath
        player.play()
    }
    // Leaving by any route (cover, system back) still saves the position.
    onStatusChanged: if (status === PageStatus.Deactivating && !closing) close(false)

    MediaPlayer {
        id: player
        onStatusChanged: {
            console.log("player status", status, "state", playbackState, "pos", position, "dur", duration, "err", errorString)
            if (status === MediaPlayer.Loaded || status === MediaPlayer.Buffered) {
                if (pendingSeek) { pendingSeek = false; player.seek(startMs) }
            } else if (status === MediaPlayer.EndOfMedia) {
                page.close(true)
            }
        }
        onError: page.error = errorString || qsTr("The player could not play this title.")
        onPlaybackStateChanged: if (page.info) page.event(playbackState === MediaPlayer.PausedState
                                                           ? { kind: "pause", position_ms: page.positionMs }
                                                           : playbackState === MediaPlayer.PlayingState ? { kind: "resume", position_ms: page.positionMs } : null)
    }
    Timer {
        interval: 10000
        repeat: true
        running: player.playbackState === MediaPlayer.PlayingState
        onTriggered: {
            page.event({ kind: "heartbeat", position_ms: page.positionMs, bytes_streamed_total: null })
            page.checkpoint(false)
        }
    }
    Timer {
        id: hide
        interval: 4000
        running: page.controls && player.playbackState === MediaPlayer.PlayingState && !seek.pressed
        onTriggered: page.controls = false
    }

    Rectangle { anchors.fill: parent; color: "black" }
    VideoOutput {
        anchors.fill: parent
        source: player
    }
    MouseArea {
        anchors.fill: parent
        onClicked: page.controls = !page.controls
    }
    BusyIndicator {
        anchors.centerIn: parent
        size: BusyIndicatorSize.Large
        running: !page.error && (!page.info || player.status === MediaPlayer.Loading || player.status === MediaPlayer.Stalled || player.status === MediaPlayer.Buffering)
    }
    Label {
        anchors { centerIn: parent; margins: Theme.paddingLarge }
        width: parent.width - 2 * Theme.paddingLarge
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
        visible: page.error !== ""
        text: page.error
        color: "white"
    }

    Label {
        anchors { horizontalCenter: parent.horizontalCenter; top: parent.verticalCenter; topMargin: 70 * Tokens.u }
        visible: page.notice !== ""
        text: page.notice
        color: "white"
    }
    Label {
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; bottomMargin: (page.controls ? 130 * Tokens.u : 48 * Tokens.u) + Tokens.safeBottom; leftMargin: Tokens.pad; rightMargin: Tokens.pad }
        visible: text !== ""
        text: page.cueText
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
        color: "white"
        style: Text.Outline
        styleColor: "black"
        font.pixelSize: 20 * Tokens.u
    }
    Item {
        anchors.fill: parent
        opacity: page.controls || page.error ? 1 : 0
        visible: opacity > 0
        Behavior on opacity { FadeAnimation {} }

        Rectangle {
            anchors { left: parent.left; right: parent.right; top: parent.top }
            height: 96 * Tokens.u
            gradient: Gradient { GradientStop { position: 0; color: "#cc000000" } GradientStop { position: 1; color: "transparent" } }
        }
        Rectangle {
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
            height: 150 * Tokens.u
            gradient: Gradient { GradientStop { position: 0; color: "transparent" } GradientStop { position: 1; color: "#cc000000" } }
        }
        IconButton {
            anchors { left: parent.left; top: parent.top; margins: Theme.paddingMedium; topMargin: Theme.paddingMedium + Tokens.safeTop }
            icon.source: "image://theme/icon-m-back"
            onClicked: page.menuOpen ? page.menuOpen = false : page.close(false)
        }
        IconButton {
            anchors { right: parent.right; top: parent.top; margins: Theme.paddingMedium; topMargin: Theme.paddingMedium + Tokens.safeTop }
            icon.source: "image://theme/icon-m-menu"
            visible: !!page.info
            onClicked: page.menuOpen = !page.menuOpen
        }
        Label {
            anchors { left: parent.left; right: parent.right; top: parent.top; leftMargin: 80 * Tokens.u; rightMargin: 80 * Tokens.u; topMargin: Theme.paddingLarge + Tokens.safeTop }
            text: page.title
            elide: Text.ElideRight
            color: "white"
            font.family: Tokens.family
            font.pixelSize: 17 * Tokens.u
        }
        IconButton {
            anchors.centerIn: parent
            width: 96 * Tokens.u
            height: width
            visible: !!page.info
            icon.source: "image://theme/icon-l-" + (player.playbackState === MediaPlayer.PlayingState ? "pause" : "play")
            onClicked: player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play()
        }
        Row {
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom; bottomMargin: Theme.paddingLarge + Tokens.safeBottom; leftMargin: Tokens.pad; rightMargin: Tokens.pad }
            spacing: 8 * Tokens.u
            Label {
                id: posLabel
                width: 56 * Tokens.u
                anchors.verticalCenter: parent.verticalCenter
                text: page.mmss(seek.pressed ? seek.sliderValue : page.positionMs)
                color: "white"
                font.pixelSize: 13 * Tokens.u
            }
            Slider {
                id: seek
                width: parent.width - 2 * 56 * Tokens.u - 2 * parent.spacing
                anchors.verticalCenter: parent.verticalCenter
                minimumValue: 0
                maximumValue: Math.max(1, page.durationMs)
                handleVisible: true
                onReleased: page.seekTo(sliderValue)
            }
            Binding { target: seek; property: "value"; value: page.positionMs; when: !seek.pressed }
            Label {
                width: 56 * Tokens.u
                anchors.verticalCenter: parent.verticalCenter
                horizontalAlignment: Text.AlignRight
                text: page.mmss(page.durationMs)
                color: "white"
                font.pixelSize: 13 * Tokens.u
            }
        }
    }

    // System media controls (MPRIS). Absent in the desktop smoke run, where the module does not exist.
    Loader {
        id: npLoader
        active: !!page.info
        source: "../components/NowPlaying.qml"
        onLoaded: { item.host = page; item.artUrl = page.nowPlayingArt }
    }
    Connections { target: page; onNowPlayingArtChanged: if (npLoader.item) npLoader.item.artUrl = page.nowPlayingArt }

    // Audio / subtitles / quality sheet.
    Rectangle {
        id: sheet
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
        height: Math.min(parent.height * 0.7, menuCol.height + 2 * Tokens.pad)
        color: Tokens.surfaceStrong
        radius: 16 * Tokens.u
        visible: page.menuOpen && !!page.info
        MouseArea { anchors.fill: parent }
        SilicaFlickable {
            anchors.fill: parent
            anchors.margins: Tokens.pad
            contentHeight: menuCol.height
            clip: true
            Column {
                id: menuCol
                width: parent.width
                spacing: 4 * Tokens.u
                Label { text: qsTr("Audio"); color: Tokens.brandPinkSoft; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: 13 * Tokens.u; visible: !!page.info && page.info.audio_tracks.length > 1 }
                Repeater {
                    model: page.info && page.info.audio_tracks.length > 1 ? page.info.audio_tracks : []
                    MenuRow {
                        text: modelData.label
                        selected: page.audioSelected(modelData)
                        onClicked: page.switchAudio(modelData)
                    }
                }
                Label { text: qsTr("Subtitles"); color: Tokens.brandPinkSoft; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: 13 * Tokens.u; topPadding: 10 * Tokens.u }
                MenuRow {
                    text: qsTr("Off")
                    selected: page.subtitleId === ""
                    onClicked: { page.chooseSubtitle(""); page.menuOpen = false }
                }
                Repeater {
                    model: page.info ? page.info.subtitle_tracks.filter(function (t) { return !!t.url }) : []
                    MenuRow {
                        text: modelData.label
                        selected: page.subtitleId === modelData.id
                        onClicked: { page.chooseSubtitle(modelData.id); page.menuOpen = false }
                    }
                }
                Label { text: qsTr("Quality"); color: Tokens.brandPinkSoft; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: 13 * Tokens.u; topPadding: 10 * Tokens.u }
                MenuRow {
                    text: qsTr("Original")
                    selected: !page.forceTranscode
                    onClicked: page.switchQuality(null)
                }
                Repeater {
                    model: page.info ? page.info.quality_options.filter(function (o) { return !!o.profile }) : []
                    MenuRow {
                        text: modelData.label
                        selected: page.forceTranscode && page.profile === modelData.profile
                        onClicked: page.switchQuality(modelData)
                    }
                }
            }
        }
    }
}
