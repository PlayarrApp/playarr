import QtQuick 2.6
QtObject {
    property string appName; property string category; property string appIcon; property bool isTransient; property int expireTimeout
    property string summary; property string body; property var progress; property var remoteActions; property string previewSummary; property string previewBody
    function remoteAction(a, b, c, d, e, f, g) { return [a, f] }
    function publish() { console.log("notification:", summary, "|", body, "|", progress) }
}
