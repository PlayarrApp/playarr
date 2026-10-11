import QtQuick 2.6
QtObject {
    readonly property int PlayingState: 1; readonly property int PausedState: 2; readonly property int StoppedState: 0
    readonly property int Loading: 2; readonly property int Loaded: 3; readonly property int Buffered: 6; readonly property int Stalled: 5; readonly property int Buffering: 4; readonly property int EndOfMedia: 7
    property url source; property int position; property int duration; property int status; property int playbackState; property string errorString
    signal error()
    function play() { playbackState = 1 } function pause() { playbackState = 2 } function stop() { playbackState = 0 } function seek(ms) { position = ms }
}
