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

    property var info: null
    property int offsetMs: 0          // HLS renditions start at source_offset_ms
    property bool controls: true
    property string error: ""
    property bool closing: false
    property bool pendingSeek: false
    readonly property int durationMs: info && info.duration_ms > 0 ? info.duration_ms : player.duration
    readonly property int positionMs: offsetMs + player.position

    allowedOrientations: Orientation.All
    showNavigationIndicator: false
    backNavigation: false

    function mmss(ms) {
        var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60
        return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x
    }

    function event(body) {
        if (info && body) Api.request("POST", "/api/v1/playback/sessions/" + info.session_id + "/events", body, null)
    }
    function checkpoint(completed) {
        if (positionMs <= 0 || !durationMs) return
        Api.request("PUT", "/api/v1/playback/" + mediaFileId + "/progress",
                    { position_ms: positionMs, duration_ms: durationMs, completed: completed || positionMs >= durationMs - 5000 }, null)
    }

    function open(fromMs) {
        error = ""
        var q = "containers=mp4,mkv,m3u8,mp3,flac,m4a,ogg,wav&video_codecs=h264&audio_codecs=aac,mp3,flac,vorbis,opus&max_bitrate_bps=20000000"
        if (fromMs > 0) q += "&start_position_ms=" + fromMs
        Api.request("GET", "/api/v1/playback/" + mediaFileId + "?" + q, null, function (status, data) {
            if (closing) return
            if (status !== 200 || !data) { error = qsTr("Playback is not available for this title."); return }
            info = data
            offsetMs = data.mode === "hls" ? (data.source_offset_ms || 0) : 0
            pendingSeek = data.mode !== "hls" && fromMs > 0
            player.source = Api.playbackUrl(data.url, data.session_id)
            player.play()
            event({ kind: "start" })
        })
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

    Component.onCompleted: open(startMs)
    // Leaving by any route (cover, system back) still saves the position.
    onStatusChanged: if (status === PageStatus.Deactivating && !closing) close(false)

    MediaPlayer {
        id: player
        onStatusChanged: {
            if (status === MediaPlayer.Loaded || status === MediaPlayer.Buffered) {
                if (pendingSeek) { pendingSeek = false; seek(startMs) }
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
            anchors { left: parent.left; top: parent.top; margins: Theme.paddingMedium }
            icon.source: "image://theme/icon-m-back"
            onClicked: page.close(false)
        }
        Label {
            anchors { left: parent.left; right: parent.right; top: parent.top; leftMargin: 80 * Tokens.u; rightMargin: Tokens.pad; topMargin: Theme.paddingLarge }
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
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom; bottomMargin: Theme.paddingLarge; leftMargin: Tokens.pad; rightMargin: Tokens.pad }
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
}
