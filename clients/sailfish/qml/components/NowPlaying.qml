import QtQuick 2.6
import Amber.Mpris 1.0

// MPRIS entry for the Sailfish media controls (lock screen, events view, headset keys): title, position and duration,
// Play/Pause/Stop and Seek reach the player page. Next and Previous are not offered: a title plays on its own.
Item {
    id: root
    property var host            // the PlayerPage
    property string artUrl: ""

    MprisPlayer {
        id: mp
        serviceName: "harbour-playarr"
        identity: "Playarr"
        desktopEntry: "harbour-playarr"
        canControl: true
        canPlay: true
        canPause: true
        canSeek: true
        canGoNext: false
        canGoPrevious: false
        playbackStatus: !root.host ? Mpris.Stopped : root.host.engine.playbackState === 1 ? Mpris.Playing : root.host.engine.playbackState === 2 ? Mpris.Paused : Mpris.Stopped
        // Amber takes milliseconds and converts to the spec's microseconds itself.
        position: root.host ? root.host.positionMs : 0

        onPlayRequested: root.host.engine.play()
        onPauseRequested: root.host.engine.pause()
        onPlayPauseRequested: root.host.engine.playbackState === 1 ? root.host.engine.pause() : root.host.engine.play()
        onStopRequested: root.host.close(false)
        onSeekRequested: root.host.seekTo(root.host.positionMs + offset / 1000)
        onSetPositionRequested: root.host.seekTo(position / 1000)
    }
    Binding { target: mp.metaData; property: "title"; value: root.host ? root.host.title : "" }
    Binding { target: mp.metaData; property: "duration"; value: root.host ? root.host.durationMs : 0 }
    Binding { target: mp.metaData; property: "artUrl"; value: root.artUrl }
}
