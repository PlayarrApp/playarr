import QtQuick 2.6
import QtMultimedia 5.6
import Sailfish.Silica 1.0
import "../components"
import "../components/playerBusy.js" as PlayerBusy
import QtQuick.Window 2.2

// Fullscreen player: server-negotiated playback (direct or HLS) with resume and progress reporting.
Page {
    id: page
    signal parityCaptureLayoutDumpRequested()
    objectName: "player"
    property alias navigation: navigation
    property string mediaFileId
    property string title
    property int startMs: 0
    property bool parityCaptureHold: false
    property bool paritySeekRequested: false
    property bool parityPositionAcknowledged: false
    property string parityCaptureFailure: ""
    property int paritySeekWaitTicks: 0
    property int parityCaptureWaitTicks: 0
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

    onInfoChanged: if (info && !navigation.moved) navigation.focusFirst()

    function logParityPlayerState() {
        console.log("PARITY|player|" + player.playbackState + "|" + Math.floor(positionMs / 1000)
                    + "|" + (menuOpen ? 1 : 0) + "|" + (controls ? 1 : 0) + "|" + player.position + "|" + positionMs)
    }

    function playerBusyShouldRun() {
        return PlayerBusy.shouldRun(page.error !== "", !!page.info,
                                    player.status === MediaPlayer.Loading,
                                    player.status === MediaPlayer.Stalled,
                                    player.status === MediaPlayer.Buffering,
                                    player.playbackState === MediaPlayer.PausedState)
    }

    function prepareParityCaptureHold() {
        if (!parityCaptureHold || paritySeekRequested || parityCaptureFailure !== "") return
        if (!info || info.mode !== "direct" || offsetMs !== 0) {
            parityCaptureFailure = "unsupported-mode:" + (info ? info.mode : "unknown") + ":offset=" + offsetMs
            console.log("PARITY|player-capture-failed|" + parityCaptureFailure)
            return
        }
        if (!player.seekable) {
            if (!paritySeekablePoll.running) {
                paritySeekWaitTicks = 0
                paritySeekablePoll.restart()
            }
            return
        }
        paritySeekablePoll.stop()
        paritySeekRequested = true
        player.pause()
        controls = true
        player.seek(2000)
        parityCapturePoll.restart()
    }

    onMenuOpenChanged: logParityPlayerState()
    onControlsChanged: logParityPlayerState()

    allowedOrientations: Orientation.All
    palette.colorScheme: Theme.LightOnDark
    background: Component { Rectangle { color: "black" } }
    showNavigationIndicator: false
    backNavigation: false

    DpadNavigation { id: navigation; page: page }
    Keys.priority: Keys.BeforeItem
    Keys.onPressed: {
        if (!navigation.handleBack(event)) navigation.handlePressed(event)
    }
    Keys.onReleased: navigation.handleReleased(event)

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
            if (!parityCaptureHold) {
                player.play()
                event({ kind: "start" })
            }
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
    function audioInitialFocus(track, index) {
        if (!info || !info.audio_tracks) return false
        if (audioSelected(track)) return true
        for (var i = 0; i < info.audio_tracks.length; ++i) if (audioSelected(info.audio_tracks[i])) return false
        return index === 0
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
        logParityPlayerState()
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
        autoPlay: false
        onStatusChanged: {
            console.log("player status", status, "state", playbackState, "pos", position, "dur", duration, "err", errorString)
            if (status === MediaPlayer.Loaded || status === MediaPlayer.Buffered) {
                if (page.parityCaptureHold) page.prepareParityCaptureHold()
                else if (pendingSeek) { pendingSeek = false; player.seek(startMs) }
            } else if (status === MediaPlayer.EndOfMedia) {
                page.close(true)
            }
        }
        onError: page.error = errorString || qsTr("The player could not play this title.")
        onPlaybackStateChanged: {
            page.logParityPlayerState()
            if (page.info && !page.parityCaptureHold) page.event(playbackState === MediaPlayer.PausedState
                                      ? { kind: "pause", position_ms: page.positionMs }
                                      : playbackState === MediaPlayer.PlayingState ? { kind: "resume", position_ms: page.positionMs } : null)
        }
    }
    Timer {
        id: paritySeekablePoll
        interval: 100
        repeat: true
        onTriggered: {
            if (player.seekable) {
                page.prepareParityCaptureHold()
            } else if (++page.paritySeekWaitTicks >= 100) {
                page.parityCaptureFailure = "not-seekable:state=" + player.playbackState + ":engine=" + player.position + ":source=" + page.positionMs
                console.log("PARITY|player-capture-failed|" + page.parityCaptureFailure)
                stop()
            }
        }
    }
    Timer {
        id: parityCapturePoll
        interval: 50
        repeat: true
        onTriggered: {
            if (++page.parityCaptureWaitTicks > 1000) {
                page.parityCaptureFailure = "readiness-timeout:status=" + player.status + ":state=" + player.playbackState
                        + ":engine=" + player.position + ":source=" + page.positionMs
                        + ":busy=" + playerBusy.running + ":opacity=" + playerBusy.opacity
                console.log("PARITY|player-capture-failed|" + page.parityCaptureFailure)
                stop()
                return
            }
            if (!PlayerBusy.captureReady(player.playbackState, MediaPlayer.PausedState,
                                         page.status === PageStatus.Active, page.controls,
                                         player.position, page.positionMs, playerBusy.running, playerBusy.opacity)) return
            page.parityPositionAcknowledged = true
            console.log("PARITY|player-capture-ack|" + page.positionMs + "|" + player.position)
            page.logParityPlayerState()
            page.parityCaptureLayoutDumpRequested()
            stop()
        }
    }
    Timer {
        interval: 1000
        repeat: true
        running: true
        onTriggered: page.logParityPlayerState()
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
        id: playerBusy
        anchors.centerIn: parent
        size: BusyIndicatorSize.Large
        running: page.playerBusyShouldRun()
    }
    FitText { 
        anchors { centerIn: parent; margins: Theme.paddingLarge }
        width: parent.width - 2 * Theme.paddingLarge
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
        visible: page.error !== ""
        text: page.error
        color: "white"
    }

    PLabel { renderType: Text.NativeRendering;
        anchors { horizontalCenter: parent.horizontalCenter; top: parent.verticalCenter; topMargin: 70 * Tokens.u }
        visible: page.notice !== ""
        text: page.notice
        color: "white"
    }
    FitText { 
        anchors { left: parent.left; right: parent.right; bottom: parent.bottom; bottomMargin: (page.controls ? 130 * Tokens.u : 48 * Tokens.u) + Tokens.safeBottom; leftMargin: Tokens.pad; rightMargin: Tokens.pad }
        visible: text !== ""
        text: page.cueText
        horizontalAlignment: Text.AlignHCenter
        wrapMode: Text.Wrap
        color: "white"
        style: Text.Outline
        styleColor: "black"
        font.pixelSize: Tokens.fs(20)
    }
    // The web player chrome (css px of a 390 px wide viewport, scaled by Tokens.u): minimise and close top right, the seek bar, the
    // time line and two rows of round controls.
    Item {
        id: chrome
        anchors.fill: parent
        opacity: page.controls || page.error ? 1 : 0
        visible: opacity > 0
        Behavior on opacity { FadeAnimation {} }
        property color plate: "#000000"

        Rectangle {
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
            height: parent.height - 355.17 * Tokens.u
            gradient: Gradient { GradientStop { position: 0; color: "transparent" } GradientStop { position: 0.55; color: "#99000000" } GradientStop { position: 1; color: "#e6000000" } }
        }
        PlayerButton {
            x: 278 * Tokens.u; y: 14 * Tokens.u; icon: "pMin"; label: qsTr("Minimise player"); plate: "#0a0809"; parityIndex: 0
            objectName: "parity-player-back"
            navigationActivate: function() { page.menuOpen ? page.menuOpen = false : page.close(false) }
            onClicked: page.menuOpen ? page.menuOpen = false : page.close(false)
        }
        PlayerButton {
            x: 330 * Tokens.u; y: 14 * Tokens.u; icon: "pClose"; iconCss: 22; label: qsTr("Close player"); plate: "#070606"; parityIndex: 1
            objectName: "parity-player-menu"
            navigationActivate: function() { page.menuOpen = !page.menuOpen }
            onClicked: page.close(false)
        }
        // Seek bar: a 44 px touch area over a 6 px track (buffered part lighter, played part brand).
        Item {
            id: seekArea
            x: 12 * Tokens.u; y: 518.13 * Tokens.u; width: 366 * Tokens.u; height: 44 * Tokens.u
            Accessible.name: qsTr("Seek")
            Accessible.role: Accessible.Slider
            Rectangle { y: 19 * Tokens.u; width: parent.width; height: 6 * Tokens.u; color: "#2b2b2b" }
            Rectangle { y: 19 * Tokens.u; width: 0.8 * parent.width; height: 6 * Tokens.u; color: "#6e6e6e" }
            Rectangle { y: 19 * Tokens.u; width: Math.max(1, parent.width * Math.min(1, page.positionMs / Math.max(1, page.durationMs))); height: 6 * Tokens.u; color: Tokens.brandPink }
            MouseArea {
                id: seek
                objectName: "parity-player-seek"
                property bool navigationFocusable: true
                property int parityRail: 1
                property int parityIndex: 0
                property real sliderValue: Math.max(0, Math.min(1, mouseX / width)) * page.durationMs
                anchors.fill: parent
                Keys.priority: Keys.BeforeItem
                Keys.onPressed: page.navigation.observeNativeKey(event, true)
                Keys.onReleased: page.navigation.observeNativeKey(event, false)
                onReleased: page.seekTo(sliderValue)
            }
        }
        // The time code: the web's three text runs (position, a dimmer slash, duration), each at its own place.
        PText { x: 167.91 * Tokens.u; y: 556.13 * Tokens.u; text: page.mmss(page.positionMs); color: "#ffffff"; font.letterSpacing: -0.245; font.family: Tokens.family400; font.pixelSize: Tokens.fs(9.92) }
        PText { x: 193.59 * Tokens.u; y: 556.13 * Tokens.u; text: "/"; color: "#a5969e"; font.letterSpacing: 0; font.family: Tokens.family400; font.pixelSize: Tokens.fs(9.92) }
        PText { x: 202 * Tokens.u; y: 556.13 * Tokens.u; text: page.mmss(page.durationMs); color: "#ffffff"; font.letterSpacing: -0.245; font.family: Tokens.family400; font.pixelSize: Tokens.fs(9.92) }
        PlayerButton { x: 12 * Tokens.u; y: 577 * Tokens.u; icon: "pPrev"; label: qsTr("Previous episode"); dimmed: true; parityIndex: 3 }
        PlayerButton {
            x: 58 * Tokens.u; y: 577 * Tokens.u; plate: "#242424"; label: qsTr("Play"); parityIndex: 2
            objectName: "parity-player-play"
            navigationInitialFocus: true
            icon: player.playbackState === MediaPlayer.PlayingState ? "pPause" : "pPlay"
            navigationActivate: function() { player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play() }
            onClicked: player.playbackState === MediaPlayer.PlayingState ? player.pause() : player.play()
        }
        PlayerButton { x: 104 * Tokens.u; y: 577 * Tokens.u; icon: "pNext"; label: qsTr("Next episode"); dimmed: true; parityIndex: 4 }
        PlayerButton {
            x: 150 * Tokens.u; y: 577 * Tokens.u; icon: "pVolume"; label: qsTr("Mute"); parityIndex: 5
            navigationActivate: function() { player.muted = !player.muted }
            onClicked: player.muted = !player.muted
        }
        PlayerButton { x: 196 * Tokens.u; y: 577 * Tokens.u; icon: "pAudio"; label: qsTr("Audio: Unavailable"); dimmed: true; parityIndex: 6 }
        PlayerButton {
            x: 242 * Tokens.u; y: 577 * Tokens.u; icon: "pSubs"; label: qsTr("Subtitles: Off"); parityIndex: 7
            navigationActivate: function() { page.menuOpen = !page.menuOpen }
            onClicked: page.menuOpen = !page.menuOpen
        }
        PlayerButton {
            x: 288 * Tokens.u; y: 577 * Tokens.u; icon: "pList"; label: qsTr("Playlist: 1 item"); parityIndex: 8
        }
        PlayerButton {
            x: 334 * Tokens.u; y: 577 * Tokens.u; label: qsTr("Quality: Original · 0.3 Mbps"); parityIndex: 9
            navigationActivate: function() { page.menuOpen = !page.menuOpen }
            onClicked: page.menuOpen = !page.menuOpen
        }
        // The quality control's own labels: a small HD badge and the current quality, which the web lets run over the right edge.
        PText {   // the control's HD badge: its own text record, running over the button's left edge
            x: 325.25 * Tokens.u; y: 593.23 * Tokens.u
            text: "HD"; color: "#ffffff"; font.family: Tokens.fam(700); font.pixelSize: Tokens.fs(7.68)
        }
        FitText { x: 351.25 * Tokens.u; y: 575.23 * Tokens.u; width: 40.31 * Tokens.u; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; lineHeightMode: Text.FixedHeight; lineHeight: 15.85 * Tokens.u
                text: qsTr("Original · 0.3 Mbps"); color: "#ffffff"; font.family: Tokens.fam(700); font.pixelSize: Tokens.fs(10.56) }
        PlayerButton { x: 127 * Tokens.u; y: 625 * Tokens.u; icon: "pHealth"; label: qsTr("Info and playback health"); parityIndex: 10 }
        PlayerButton { x: 173 * Tokens.u; y: 625 * Tokens.u; icon: "pCast"; label: qsTr("Play on another device"); parityIndex: 11 }
        PlayerButton { x: 219 * Tokens.u; y: 625 * Tokens.u; icon: "pFull"; label: qsTr("Enter fullscreen"); parityIndex: 12 }
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
        objectName: "parity-player-sheet"
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
                PLabel { renderType: Text.NativeRendering; text: qsTr("Audio"); color: Tokens.brandPinkSoft; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: Tokens.fs(13); visible: !!page.info && page.info.audio_tracks.length > 1 }
                Repeater {
                    model: page.info && page.info.audio_tracks.length > 1 ? page.info.audio_tracks : []
                    MenuRow {
                        objectName: page.audioInitialFocus(modelData, index) ? "parity-player-menu-first" : ""
                        navigationInitialFocus: page.audioInitialFocus(modelData, index)
                        parityRail: 1
                        parityIndex: index
                        navigationActivate: function() { page.switchAudio(modelData) }
                        text: modelData.label
                        selected: page.audioSelected(modelData)
                        onClicked: page.switchAudio(modelData)
                    }
                }
                PLabel { renderType: Text.NativeRendering; text: qsTr("Subtitles"); color: Tokens.brandPinkSoft; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: Tokens.fs(13); topPadding: 10 * Tokens.u }
                MenuRow {
                    objectName: page.info && page.info.audio_tracks.length > 1 ? "parity-player-menu-off" : "parity-player-menu-first"
                    navigationInitialFocus: !page.info || page.info.audio_tracks.length <= 1
                    parityRail: 1
                    parityIndex: page.info && page.info.audio_tracks.length > 1 ? page.info.audio_tracks.length : 0
                    navigationActivate: function() { page.chooseSubtitle(""); page.menuOpen = false }
                    text: qsTr("Off")
                    selected: page.subtitleId === ""
                    onClicked: { page.chooseSubtitle(""); page.menuOpen = false }
                }
                Repeater {
                    model: page.info ? page.info.subtitle_tracks.filter(function (t) { return !!t.url }) : []
                    MenuRow {
                        parityRail: 1
                        parityIndex: (page.info && page.info.audio_tracks.length > 1 ? page.info.audio_tracks.length : 0) + 1 + index
                        navigationActivate: function() { page.chooseSubtitle(modelData.id); page.menuOpen = false }
                        text: modelData.label
                        selected: page.subtitleId === modelData.id
                        onClicked: { page.chooseSubtitle(modelData.id); page.menuOpen = false }
                    }
                }
                PLabel { renderType: Text.NativeRendering; text: qsTr("Quality"); color: Tokens.brandPinkSoft; font.family: Tokens.family; font.weight: Font.Bold; font.pixelSize: Tokens.fs(13); topPadding: 10 * Tokens.u }
                MenuRow {
                    parityRail: 1
                    parityIndex: 1000
                    navigationActivate: function() { page.switchQuality(null) }
                    text: qsTr("Original")
                    selected: !page.forceTranscode
                    onClicked: page.switchQuality(null)
                }
                Repeater {
                    model: page.info ? page.info.quality_options.filter(function (o) { return !!o.profile }) : []
                    MenuRow {
                        parityRail: 1
                        parityIndex: 1001 + index
                        navigationActivate: function() { page.switchQuality(modelData) }
                        text: modelData.label
                        selected: page.forceTranscode && page.profile === modelData.profile
                        onClicked: page.switchQuality(modelData)
                    }
                }
            }
        }
    }
}
