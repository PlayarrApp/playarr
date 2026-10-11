import QtQuick 2.6
import Nemo.Notifications 1.0

// System notifications that follow each download: progress with percent and size, paused, complete and failed.
// Sailfish groups them under the app. Pause, Resume and Cancel are not offered on the notification: they need a
// D-Bus service in the app, so they stay in the Downloads tab.
Item {
    id: root
    property var notes: ({})
    Component {
        id: noteComp
        Notification {
            appName: "Playarr"
            category: "x-nemo.transfer"
            appIcon: "icon-lock-transfer"
            isTransient: false
            expireTimeout: 0
        }
    }
    function mb(n) { return (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB" }
    Connections {
        target: Downloads
        onProgress: {
            var n = root.notes[ticketId]
            if (!n) { n = noteComp.createObject(root); root.notes[ticketId] = n }
            n.summary = title
            if (state === "downloading") {
                var pct = size > 0 ? Math.round(100 * received / size) : 0
                n.body = qsTr("Downloading %1% \u00B7 %2 of %3").arg(pct).arg(root.mb(received)).arg(root.mb(size))
                n.progress = size > 0 ? received / size : 0
            } else {
                n.progress = undefined
                n.body = state === "done" ? qsTr("Download complete") + " \u00B7 " + root.mb(size)
                       : state === "paused" ? qsTr("Paused at %1 of %2").arg(root.mb(received)).arg(root.mb(size))
                       : qsTr("Download failed")
            }
            // Pause / Resume / Cancel call the app's D-Bus service while it runs.
            var act = function (name, label, method) { return n.remoteAction(name, label, "com.playarr.app", "/downloads", "com.playarr.Downloads", method, [ticketId]) }
            n.remoteActions = state === "downloading" ? [ act("pause", qsTr("Pause"), "pause"), act("cancel", qsTr("Cancel"), "cancel") ]
                            : state === "paused" ? [ act("resume", qsTr("Resume"), "resume"), act("cancel", qsTr("Cancel"), "cancel") ]
                            : []
            n.previewSummary = state === "done" || state === "failed" ? title : ""
            n.previewBody = state === "done" ? qsTr("Download complete") : state === "failed" ? qsTr("Download failed") : ""
            n.publish()
        }
    }
}
