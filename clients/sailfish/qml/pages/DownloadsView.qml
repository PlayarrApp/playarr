import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Download tickets on the server and the offline copies kept on this device, grouped as on the web:
// series, then season, then episode, with the shared controls at every level, then Active, Needs attention and
// Downloaded. The Filters button narrows by kind and status and sorts.
Item {
    id: root
    signal opened(var work)
    signal goHome()
    property var tickets: []
    property bool busy: true
    property bool failed: false
    property var rows: []
    property var expanded: ({})
    property bool filtersOpen: false
    property string fKind: "all"       // all | movies | tv | music
    property string fStatus: "all"     // all | downloading | paused | done | failed
    property string fSort: "recent"    // recent | title | size
    readonly property int filterCount: (fKind !== "all" ? 1 : 0) + (fStatus !== "all" ? 1 : 0) + (fSort !== "recent" ? 1 : 0)

    function localFor(id) {
        var l = Downloads.items
        for (var i = 0; i < l.length; ++i) if (l[i].ticketId === id) return l[i]
        return null
    }
    function metaOf(t) { return JSON.parse(Api.setting("dlmeta-" + t.id, "{}")) }
    function titleOf(t) {
        var l = localFor(t.id)
        return (l && l.title) || metaOf(t).title || Api.setting("dltitle-" + t.id, "") || qsTr("Download %1").arg(t.id.substr(0, 8))
    }
    function mb(n) { return n > 0 ? (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + " MB" : "" }
    // running | paused | failed | done | ready (a ticket that is ready on the server but not saved here)
    function stateOf(t) {
        var l = localFor(t.id)
        if (l && l.state === "done") return "done"
        if (l && l.state === "downloading") return "running"
        if (l && l.state === "paused") return "paused"
        if (l && l.state === "failed") return "failed"
        if (t.status === "failed" || t.status === "expired" || t.status === "canceled") return "failed"
        return t.status === "ready" ? "ready" : "running"
    }
    function statusText(t) {
        var l = localFor(t.id), s = stateOf(t)
        if (s === "done") return qsTr("On this device") + " · " + mb(l.size)
        if (s === "running" && l) return qsTr("Downloading %1 / %2").arg(mb(l.received)).arg(mb(l.size))
        if (s === "paused") return qsTr("Paused") + " · " + mb(l.received) + " / " + mb(l.size)
        if (s === "ready") return qsTr("Ready") + " · " + mb(t.size_bytes)
        return s === "failed" ? (t.status === "expired" ? qsTr("Expired") : t.status === "canceled" ? qsTr("Canceled") : qsTr("Failed")) : qsTr("Preparing")
    }
    function sizeOf(t) { var l = localFor(t.id); return (l && l.size) || t.size_bytes || 0 }
    function kindOf(t) { var k = metaOf(t).kind; return k === "series" || k === "episode" ? "tv" : k === "artist" ? "music" : "movies" }
    function matches(t) {
        var s = stateOf(t)
        if (fKind !== "all" && kindOf(t) !== fKind) return false
        if (fStatus === "downloading") return s === "running"
        if (fStatus === "paused") return s === "paused"
        if (fStatus === "done") return s === "done"
        if (fStatus === "failed") return s === "failed"
        return true
    }
    // Aggregate of a set of tickets: counts and the ids each shared control acts on.
    function aggregate(list) {
        var a = { count: list.length, running: [], paused: [], pending: [], bytes: 0, done: 0 }
        list.forEach(function (t) {
            var s = stateOf(t)
            if (s === "running") a.running.push(t.id)
            if (s === "paused") a.paused.push(t.id)
            if (s === "done") a.done++
            a.bytes += sizeOf(t)
        })
        a.pending = a.running.concat(a.paused)
        return a
    }
    function groupStatus(a) {
        if (a.running.length) return qsTr("%1 downloading").arg(a.running.length)
        if (a.paused.length) return qsTr("%1 paused").arg(a.paused.length)
        return a.done > 0 ? qsTr("%1 on this device").arg(a.done) : qsTr("%1 ready to save").arg(a.count)
    }
    function plural(n, one, many) { return n === 1 ? one.arg(n) : many.arg(n) }
    function rebuild() {
        var list = tickets.filter(matches)
        var bySize = function (a, b) { return sizeOf(b) - sizeOf(a) }
        var byTitle = function (a, b) { return titleOf(a).toLowerCase() < titleOf(b).toLowerCase() ? -1 : 1 }
        var byRecent = function (a, b) { return Date.parse(b.requested_at || 0) - Date.parse(a.requested_at || 0) }
        list.sort(fSort === "size" ? bySize : fSort === "title" ? byTitle : byRecent)
        var out = [], series = {}, order = [], flat = []
        list.forEach(function (t) {
            var m = metaOf(t)
            if (m.kind === "episode" && m.series) {
                if (!series[m.series]) { series[m.series] = { title: m.series, seasons: {}, all: [] }; order.push(m.series) }
                var g = series[m.series], sn = m.season || 0
                if (!g.seasons[sn]) g.seasons[sn] = []
                g.seasons[sn].push(t); g.all.push(t)
            } else flat.push(t)
        })
        order.forEach(function (name) {
            var g = series[name], seasonNos = Object.keys(g.seasons).map(Number).sort(function (a, b) { return a - b })
            var key = "s:" + name, ag = aggregate(g.all)
            out.push({ kind: "group", level: 0, key: key, title: name, ids: g.all.map(function (t) { return t.id }), agg: ag,
                       meta: plural(seasonNos.length, qsTr("%1 season"), qsTr("%1 seasons")) + " · " + plural(g.all.length, qsTr("%1 episode"), qsTr("%1 episodes")) })
            if (!expanded[key]) return
            seasonNos.forEach(function (sn) {
                var eps = g.seasons[sn].slice().sort(function (a, b) { return (metaOf(a).episode || 0) - (metaOf(b).episode || 0) })
                var skey = key + ":" + sn, sa = aggregate(eps)
                out.push({ kind: "group", level: 1, key: skey, title: qsTr("Season %1").arg(sn), ids: eps.map(function (t) { return t.id }), agg: sa,
                           meta: plural(eps.length, qsTr("%1 episode"), qsTr("%1 episodes")) })
                if (!expanded[skey]) return
                eps.forEach(function (t) { out.push({ kind: "item", level: 2, key: t.id, t: t }) })
            })
        })
        var sections = [["Active", qsTr("Active"), ["running", "paused"]], ["Ready", qsTr("Ready to save"), ["ready"]],
                        ["Failed", qsTr("Needs attention"), ["failed"]], ["Done", qsTr("Downloaded"), ["done"]]]
        sections.forEach(function (sec) {
            var l = flat.filter(function (t) { return sec[2].indexOf(stateOf(t)) >= 0 })
            if (!l.length) return
            out.push({ kind: "head", key: "h:" + sec[0], title: sec[1] })
            l.forEach(function (t) { out.push({ kind: "item", level: 0, key: t.id, t: t }) })
        })
        rows = out
    }
    function toggle(key) { var e = expanded; e[key] = !e[key]; expanded = e; rebuild() }
    function load() {
        Api.request("GET", "/api/v1/downloads", null, function (status, data) {
            busy = false
            if (status !== 200 || !data) { failed = true; return }
            failed = false
            tickets = data
            rebuild()
        })
    }
    function removeTicket(t) {
        Downloads.remove(t.id)
        Api.request("DELETE", "/api/v1/downloads/" + t.id, null, function () { load() })
    }
    function removeAll(ids) { ids.forEach(function (id) { removeTicket({ id: id }) }) }
    onFKindChanged: rebuild()
    onFStatusChanged: rebuild()
    onFSortChanged: rebuild()
    Connections { target: Downloads; onChanged: root.rebuild() }
    Component.onCompleted: load()
    Timer { interval: 5000; repeat: true; running: true; onTriggered: root.load() }

    PageTitle {
        id: head
        y: 4 * Tokens.u
        title: qsTr("Downloads")
        onBackClicked: root.goHome()
    }
    MouseArea {
        id: filterBtn
        anchors { right: parent.right; rightMargin: Tokens.pad; verticalCenter: head.verticalCenter }
        width: 43.7 * Tokens.u; height: width
        onClicked: root.filtersOpen = !root.filtersOpen
        Rectangle { anchors.fill: parent; radius: 11 * Tokens.u; color: root.filtersOpen ? Tokens.surfaceStrong : "transparent"; border.width: 1; border.color: Tokens.line }
        Label { renderType: Text.NativeRendering; anchors.centerIn: parent; text: root.filterCount > 0 ? root.filterCount : "☰"; color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 14 * Tokens.u }
    }
    Column {
        id: filters
        visible: root.filtersOpen
        anchors { top: head.bottom; topMargin: 4 * Tokens.u; left: parent.left; right: parent.right }
        spacing: 6 * Tokens.u
        Repeater {
            model: [
                { prop: "fKind", label: qsTr("Type"), opts: [["all", qsTr("All")], ["movies", qsTr("Movies")], ["tv", qsTr("TV")], ["music", qsTr("Music")]] },
                { prop: "fStatus", label: qsTr("Status"), opts: [["all", qsTr("All")], ["downloading", qsTr("Downloading")], ["paused", qsTr("Paused")], ["done", qsTr("Done")], ["failed", qsTr("Failed")]] },
                { prop: "fSort", label: qsTr("Sort"), opts: [["recent", qsTr("Recent")], ["title", qsTr("Title")], ["size", qsTr("Size")]] }
            ]
            Row {
                id: frow
                property var spec: modelData
                x: Tokens.pad
                spacing: 6 * Tokens.u
                Label { renderType: Text.NativeRendering; width: 46 * Tokens.u; anchors.verticalCenter: parent.verticalCenter; text: modelData.label; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 10 * Tokens.u }
                Repeater {
                    model: modelData.opts
                    PillButton {
                        text: modelData[1]
                        primary: root[frow.spec.prop] === modelData[0]
                        fontSize: 9.5 * Tokens.u
                        implicitWidth: 62 * Tokens.u
                        implicitHeight: 30 * Tokens.u
                        onClicked: root[frow.spec.prop] = modelData[0]
                    }
                }
            }
        }
    }
    SilicaListView {
        id: list
        anchors { top: root.filtersOpen ? filters.bottom : head.bottom; topMargin: 6 * Tokens.u; left: parent.left; right: parent.right; bottom: parent.bottom }
        model: root.rows
        spacing: 10 * Tokens.u
        clip: true
        bottomMargin: 100 * Tokens.u
        delegate: Item {
            id: row
            property var r: modelData
            property var t: r.kind === "item" ? r.t : null
            property var local: t ? root.localFor(t.id) : null
            property bool done: !!local && local.state === "done"
            x: Tokens.pad + (r.kind === "head" ? 0 : (r.level || 0) * 14 * Tokens.u)
            width: list.width - 2 * Tokens.pad - (r.kind === "head" ? 0 : (r.level || 0) * 14 * Tokens.u)
            height: r.kind === "head" ? 28 * Tokens.u : r.kind === "group" ? 92 * Tokens.u : 118 * Tokens.u
            Label { renderType: Text.NativeRendering; visible: r.kind === "head"; anchors.bottom: parent.bottom; text: r.title || ""; color: Tokens.ink; font.family: Tokens.family580; font.pixelSize: 15 * Tokens.u }
            Rectangle { visible: r.kind !== "head"; anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line }
            // Group row: caret, title, totals and the controls for everything inside.
            MouseArea {
                visible: r.kind === "group"
                anchors { left: parent.left; top: parent.top; bottom: parent.bottom; right: gActions.left }
                onClicked: root.toggle(r.key)
                Column {
                    anchors { left: parent.left; leftMargin: 16 * Tokens.u; right: parent.right; verticalCenter: parent.verticalCenter }
                    Label { renderType: Text.NativeRendering; width: parent.width; text: (root.expanded[r.key] ? "▾  " : "▸  ") + (r.title || ""); elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 15 * Tokens.u }
                    Label { renderType: Text.NativeRendering; width: parent.width; text: r.meta || ""; elide: Text.ElideRight; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u }
                    Label { renderType: Text.NativeRendering; width: parent.width; text: r.agg ? root.groupStatus(r.agg) : ""; elide: Text.ElideRight; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 11 * Tokens.u }
                }
            }
            Row {
                id: gActions
                visible: r.kind === "group"
                anchors { right: parent.right; rightMargin: 10 * Tokens.u; verticalCenter: parent.verticalCenter }
                spacing: 6 * Tokens.u
                PillButton {
                    visible: !!r.agg && r.agg.running.length > 0
                    text: qsTr("Pause"); implicitWidth: 64 * Tokens.u; height: 34 * Tokens.u; fontSize: 10 * Tokens.u
                    onClicked: r.agg.running.forEach(function (id) { Downloads.pause(id) })
                }
                PillButton {
                    visible: !!r.agg && r.agg.paused.length > 0
                    text: qsTr("Resume"); implicitWidth: 64 * Tokens.u; height: 34 * Tokens.u; fontSize: 10 * Tokens.u
                    onClicked: r.agg.paused.forEach(function (id) { Downloads.resume(id) })
                }
                PillButton {
                    text: "✕"; implicitWidth: 40 * Tokens.u; height: 34 * Tokens.u
                    onClicked: remorse.execute(qsTr("Deleting downloads"), function () { root.removeAll(r.ids) })
                }
            }
            // Item row.
            Rectangle {   // progress of the local copy
                visible: !!row.local && row.local.state !== "done" && row.local.size > 0
                x: 14 * Tokens.u; anchors.bottom: parent.bottom; anchors.bottomMargin: 4 * Tokens.u; height: 3 * Tokens.u; radius: 2
                width: visible ? (parent.width - 28 * Tokens.u) * Math.min(1, row.local.received / row.local.size) : 0
                color: Tokens.brandPink
            }
            Column {
                visible: r.kind === "item"
                anchors { left: parent.left; leftMargin: 16 * Tokens.u; right: parent.right; rightMargin: 12 * Tokens.u; top: parent.top; topMargin: 12 * Tokens.u }
                Label { renderType: Text.NativeRendering; width: parent.width; text: row.t ? root.titleOf(row.t) : ""; elide: Text.ElideRight; color: Tokens.ink; font.family: Tokens.family; font.pixelSize: 16 * Tokens.u }
                Label { renderType: Text.NativeRendering; width: parent.width; text: row.t ? root.statusText(row.t) : ""; elide: Text.ElideRight; color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 13 * Tokens.u }
            }
            Row {
                id: actions
                visible: r.kind === "item"
                anchors { right: parent.right; rightMargin: 10 * Tokens.u; bottom: parent.bottom; bottomMargin: 12 * Tokens.u }
                spacing: 6 * Tokens.u
                PillButton {
                    visible: row.done || (!!row.t && row.t.status === "ready" && (!row.local || row.local.state === "paused" || row.local.state === "failed"))
                    primary: true
                    text: row.done ? qsTr("Play") : qsTr("Save")
                    implicitWidth: 72 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: {
                        if (row.done)
                            pageStack.push(Qt.resolvedUrl("PlayerPage.qml"), { localPath: row.local.path, title: root.titleOf(row.t) })
                        else
                            Downloads.fetch(row.t.id, root.titleOf(row.t), row.t.container, row.t.size_bytes || 0)
                    }
                }
                PillButton {
                    visible: !!row.local && row.local.state === "downloading"
                    text: qsTr("Pause")
                    implicitWidth: 72 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: Downloads.pause(row.t.id)
                }
                PillButton {
                    visible: !!row.t && root.stateOf(row.t) === "failed" && row.t.status === "ready"
                    text: qsTr("Retry")
                    implicitWidth: 72 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: Downloads.resume(row.t.id)
                }
                PillButton {
                    visible: !!row.t && row.t.status === "ready"
                    text: qsTr("Edit")
                    implicitWidth: 60 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: pageStack.push(Qt.resolvedUrl("DownloadPage.qml"), { mediaFileId: row.t.media_file_id, title: root.titleOf(row.t), edit: row.t })
                }
                PillButton {
                    text: "✕"
                    implicitWidth: 40 * Tokens.u
                    height: 36 * Tokens.u
                    onClicked: remorse.execute(qsTr("Deleting download"), function () { root.removeTicket(row.t) })
                }
            }
        }
        EdgeFade { target: list }
        VerticalScrollDecorator {}
    }
    RemorsePopup { id: remorse }
    BusyIndicator { anchors.centerIn: parent; size: BusyIndicatorSize.Large; running: root.busy }
    ViewPlaceholder {
        enabled: !root.busy && root.rows.length === 0
        text: root.failed ? qsTr("Could not load downloads") : root.tickets.length > 0 ? qsTr("Nothing matches the filters") : qsTr("No downloads yet")
        hintText: root.failed || root.tickets.length > 0 ? "" : qsTr("Download a title from its page to watch it offline.")
    }
}
