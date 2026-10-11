import QtQuick 2.6

// Applies each download's keep-until rule: deletes the local copy and its ticket once the rule has passed.
// "after-watched" counts from the first time this device saw the file as watched (stored as watchedAt).
Item {
    id: keepRules
    function check() {
        var local = Downloads.items
        if (!local.length || !Api.signedIn) return
        Api.request("GET", "/api/v1/playback/progress", null, function (st, rows) {
            var watched = {}
            if (st === 200 && rows) rows.forEach(function (p) { if (p.state === "watched") watched[p.media_file_id] = true })
            Api.request("GET", "/api/v1/downloads", null, function (st2, tickets) {
                if (st2 !== 200 || !tickets) return
                tickets.forEach(function (t) {
                    var key = "dlmeta-" + t.id
                    var m = JSON.parse(Api.setting(key, "{}"))
                    var k = m.keepUntil
                    if (!k || !Downloads.items.some(function (d) { return d.ticketId === t.id })) return
                    if (watched[t.media_file_id] && !m.watchedAt) { m.watchedAt = Date.now(); Api.setSetting(key, JSON.stringify(m)) }
                    if (Downloads.keepExpired(k.type, k.date || "", k.amount || 0, k.unit || "days", m.watchedAt || 0)) {
                        Downloads.remove(t.id)
                        Api.request("DELETE", "/api/v1/downloads/" + t.id, null, null)
                    }
                })
            })
        })
    }
    Timer { interval: 3600000; repeat: true; running: true; triggeredOnStart: false; onTriggered: keepRules.check() }
    Timer { interval: 8000; running: true; onTriggered: keepRules.check() }
}
