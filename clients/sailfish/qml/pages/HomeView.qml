import QtQuick 2.6
import Sailfish.Silica 1.0
import QtGraphicalEffects 1.0
import "../components"

// Home: "Start watching" (resume) followed by the server-curated rails.
SilicaFlickable {
    id: root
    signal opened(var work)
    signal held(var work)
    property var rails: []
    property bool busy: true
    property bool failed: false
    contentHeight: column.height + 120 * Tokens.u

    function load() {
        busy = true
        failed = false
        Api.request("GET", "/api/v1/home/rails", null, function (status, data) {
            busy = false
            if (status !== 200 || !data) { failed = true; return }
            var list = []
            for (var i = 0; i < data.rails.length; ++i)
                list.push({ title: data.rails[i].title, items: data.rails[i].items })
            rails = list
            loadResume()
        })
    }

    // On deck, as the web builds it: part-watched rows newest first (one per title, ten at most), each resolved to its
    // title; a series shows the episode its resume plan leads with (else the last one played), and a series that needs
    // a Resume choice but has no part-watched row is added after them.
    function episodeOf(detail, fileId) {
        var seasons = detail.children && detail.children.Series ? detail.children.Series : []
        for (var s = 0; s < seasons.length; ++s)
            for (var e = 0; e < seasons[s].episodes.length; ++e)
                if (seasons[s].episodes[e].media_file_id === fileId) return { ep: seasons[s].episodes[e], season: seasons[s].season.season_number }
        return null
    }
    function deckItem(detail, fileId, progressFile) {
        var w = detail.work, copy = {}
        for (var k in w) copy[k] = w[k]
        if (w.kind === "series" || w.kind === "site") {
            var hit = episodeOf(detail, fileId)
            if (!hit) return null
            var n = hit.ep.episode.episode_number
            copy.deckFile = fileId
            copy.deckTitle = hit.ep.episode.title || qsTr("Episode %1").arg(n)
            copy.deckSub = w.title + " \u00B7 S" + ("0" + hit.season).slice(-2) + " E" + ("0" + n).slice(-2)
        } else if (w.kind === "artist" && progressFile) copy.deckFile = progressFile
        return copy
    }
    function loadResume() {
        var gen = ++deckGen
        Api.request("GET", "/api/v1/playback/resume-plans", null, function (pst, plans) {
            var stacked = {}, stackedList = []
            if (pst === 200 && plans) plans.forEach(function (p) { if (p.needs_choice && p.options && p.options.length > 1) { stacked[p.series_work_id] = p; stackedList.push(p) } })
            Api.request("GET", "/api/v1/playback/progress", null, function (status, data) {
                if (status !== 200 || !data || gen !== deckGen) return
                var entries = data.filter(function (p) { return p.state === "part_watched" })
                entries.sort(function (a, b) { return (b.updated_at || "").localeCompare(a.updated_at || "") })
                var seen = {}, rows = []
                for (var i = 0; i < entries.length && rows.length < 10; ++i)
                    if (!seen[entries[i].work_id]) { seen[entries[i].work_id] = true; rows.push({ id: entries[i].work_id, file: entries[i].media_file_id, progress: true }) }
                var have = rows.length
                stackedList.forEach(function (p) {
                    if (!seen[p.series_work_id] && rows.length < 10 && p.target) { seen[p.series_work_id] = true; rows.push({ id: p.series_work_id, file: p.target.media_file_id, progress: false }) }
                })
                var works = [], left = rows.length
                if (left === 0) return
                rows.forEach(function (r, idx) {
                    Api.request("GET", "/api/v1/catalog/" + r.id, null, function (st, detail) {
                        if (st === 200 && detail) {
                            var lead = r.progress && stacked[r.id] && stacked[r.id].target ? stacked[r.id].target.media_file_id : r.file
                            works[idx] = deckItem(detail, lead, r.file)
                        }
                        if (--left === 0 && gen === deckGen) {
                            var items = works.filter(function (w) { return w })
                            var rest = rails.filter(function (x) { return !x.onDeck })
                            if (items.length > 0) rails = [{ title: qsTr("On deck"), items: items, onDeck: true }].concat(rest)
                        }
                    })
                })
            })
        })
    }
    property int deckGen: 0

    Component.onCompleted: load()

    // Soft grey key art from the first title, behind the first rail (web home).
    HeroArt {
        visible: root.rails.length > 0 && root.rails[0].items.length > 0
        work: root.rails.length > 0 && root.rails[0].items.length > 0 ? root.rails[0].items[0] : null
        boxH: 124 * Tokens.u; imgH: 375 * Tokens.u; fadeFrom: 0.3; fadeTo: 1
    }
    Column {
        id: column
        width: parent.width
        spacing: 37.2 * Tokens.u
        Item { width: 1; height: 55.8 * Tokens.u }
        Repeater {
            model: root.rails
            Rail {
                title: modelData.title
                items: modelData.items
                showUnwatched: !modelData.onDeck
                restRing: index === 0   // web focuses the first Home card at rest
                onOpened: root.opened(work)
                onHeld: root.held(work)
            }
        }
    }
    ViewPlaceholder {
        enabled: root.failed
        text: qsTr("Could not load Home")
        hintText: qsTr("Pull down to retry")
    }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
    EdgeFade { target: root }
    VerticalScrollDecorator {}
}
