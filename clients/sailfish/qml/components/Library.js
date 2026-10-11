.pragma library
// Web's library order: natural title order (digits compare as numbers), or date added.
function order(list, sort, dir) {
    var d = dir === "asc" ? 1 : -1
    var key = function (w) { return String((w.sort_title && w.sort_title.length) ? w.sort_title : w.title).toLowerCase() }
    var chunks = function (t) { return t.match(/[0-9]+|[^0-9]+/g) || [] }
    var cmp = function (a, b) {
        var l = chunks(key(a)), r = chunks(key(b)), n = Math.min(l.length, r.length)
        for (var i = 0; i < n; ++i) {
            var x = l[i], y = r[i], dx = /^[0-9]+$/.test(x), dy = /^[0-9]+$/.test(y)
            if (dx && dy) { var df = Number(x) - Number(y); if (df !== 0) return df < 0 ? -1 : 1 }
            else if (x !== y) return x < y ? -1 : 1
        }
        return l.length - r.length
    }
    if (sort === "date_added")
        return list.slice().sort(function (a, b) { return (Date.parse(a.added_at) - Date.parse(b.added_at)) * d })
    return list.slice().sort(function (a, b) { return cmp(a, b) * d })
}
