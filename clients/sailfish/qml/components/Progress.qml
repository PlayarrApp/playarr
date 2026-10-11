pragma Singleton
import QtQuick 2.6

// Watch state by work (part_watched wins over watched), as the web's WatchStateOverlay reads it.
QtObject {
    property var byWork: ({})
    property bool loaded: false
    function refresh() {
        Api.request("GET", "/api/v1/playback/progress", null, function (status, data) {
            if (status !== 200 || !data) return
            var m = {}
            data.forEach(function (p) {
                var cur = m[p.work_id]
                var rank = function (s) { return s === "part_watched" ? 2 : s === "watched" ? 1 : 0 }
                if (!cur || rank(p.state) > rank(cur.state)) m[p.work_id] = p
            })
            byWork = m
            loaded = true
        })
    }
}
