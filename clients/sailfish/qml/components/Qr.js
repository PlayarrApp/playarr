.pragma library
// Minimal QR Code encoder (byte mode, error correction M, versions 1-20), after Project Nayuki's reference
// implementation (MIT). Used for the calendar link; the private URL is never sent to a service to draw it.
var ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26]
var BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]

function rawModules(v) {
    var r = (16 * v + 128) * v + 64
    if (v >= 2) { var n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36 }
    return r
}
function dataCodewords(v) { return Math.floor(rawModules(v) / 8) - ECC[v] * BLOCKS[v] }

function gfMul(x, y) { var z = 0; for (var i = 7; i >= 0; --i) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x } return z & 255 }
function rsDivisor(deg) {
    var r = []; for (var i = 0; i < deg - 1; ++i) r.push(0); r.push(1)
    var root = 1
    for (i = 0; i < deg; ++i) {
        for (var j = 0; j < r.length; ++j) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1] }
        root = gfMul(root, 2)
    }
    return r
}
function rsRemainder(data, div) {
    var r = div.map(function () { return 0 })
    data.forEach(function (b) {
        var f = b ^ r.shift(); r.push(0)
        div.forEach(function (c, i) { r[i] ^= gfMul(c, f) })
    })
    return r
}

function blank(n) { var a = []; for (var i = 0; i < n; ++i) a.push(false); return a }

function utf8(text) {
    var s = unescape(encodeURIComponent(text)), out = []
    for (var i = 0; i < s.length; ++i) out.push(s.charCodeAt(i))
    return out
}

// Returns an array of rows, each an array of booleans (true = dark), without the quiet zone.
function encode(text) {
    var bytes = utf8(text), v, bits = []
    function put(val, len) { for (var i = len - 1; i >= 0; --i) bits.push((val >>> i) & 1) }
    for (v = 1; v <= 20; ++v) {
        if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= dataCodewords(v) * 8) break
    }
    if (v > 20) return []
    put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(function (b) { put(b, 8) })
    var cap = dataCodewords(v) * 8
    put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0)
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8)
    var data = []
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; ++k) b = (b << 1) | bits[i + k]; data.push(b) }

    var nb = BLOCKS[v], el = ECC[v], raw = Math.floor(rawModules(v) / 8), short = nb - raw % nb, sl = Math.floor(raw / nb)
    var blocks = [], div = rsDivisor(el)
    for (i = 0, k = 0; i < nb; ++i) {
        var d = data.slice(k, k + sl - el + (i < short ? 0 : 1)); k += d.length
        var e = rsRemainder(d, div); if (i < short) d.push(0); blocks.push(d.concat(e))
    }
    var all = []
    for (i = 0; i < blocks[0].length; ++i) blocks.forEach(function (bl, j) { if (i !== sl - el || j >= short) all.push(bl[i]) })

    var size = v * 4 + 17, mod = [], fn = []
    for (i = 0; i < size; ++i) { mod.push(blank(size)); fn.push(blank(size)) }
    function setFn(x, y, dark) { mod[y][x] = dark; fn[y][x] = true }
    for (i = 0; i < size; ++i) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0) }
    function finder(cx, cy) {
        for (var dy = -4; dy <= 4; ++dy) for (var dx = -4; dx <= 4; ++dx) {
            var x = cx + dx, y = cy + dy, dist = Math.max(Math.abs(dx), Math.abs(dy))
            if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, dist !== 2 && dist !== 4)
        }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4)
    var pos = []
    if (v > 1) {
        var n = Math.floor(v / 7) + 2, step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2
        pos = [6]; for (i = 0, k = size - 7; i < n - 1; ++i, k -= step) pos.splice(1, 0, k)
    }
    pos.forEach(function (ax, ia) { pos.forEach(function (ay, ib) {
        if ((ia === 0 && ib === 0) || (ia === 0 && ib === pos.length - 1) || (ia === pos.length - 1 && ib === 0)) return
        for (var dy = -2; dy <= 2; ++dy) for (var dx = -2; dx <= 2; ++dx) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }) })
    function format(mask) {
        var f = (0 << 3) | mask   // error correction M has format bits 00
        var rem = f; for (var j = 0; j < 10; ++j) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
        var bitsF = ((f << 10) | rem) ^ 0x5412
        function g(j) { return ((bitsF >>> j) & 1) !== 0 }
        for (j = 0; j <= 5; ++j) setFn(8, j, g(j))
        setFn(8, 7, g(6)); setFn(8, 8, g(7)); setFn(7, 8, g(8))
        for (j = 9; j < 15; ++j) setFn(14 - j, 8, g(j))
        for (j = 0; j < 8; ++j) setFn(size - 1 - j, 8, g(j))
        for (j = 8; j < 15; ++j) setFn(8, size - 15 + j, g(j))
        setFn(8, size - 8, true)
    }
    format(0)
    if (v >= 7) {
        var rem = v; for (i = 0; i < 12; ++i) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25)
        var vb = (v << 12) | rem
        for (i = 0; i < 18; ++i) { var c = ((vb >>> i) & 1) !== 0, a = size - 11 + i % 3, b2 = Math.floor(i / 3); setFn(a, b2, c); setFn(b2, a, c) }
    }
    // zig-zag data placement
    var bi = 0
    for (var right = size - 1; right >= 1; right -= 2) {
        if (right === 6) right = 5
        for (var vert = 0; vert < size; ++vert) for (var j2 = 0; j2 < 2; ++j2) {
            var x = right - j2, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert
            if (!fn[y][x] && bi < all.length * 8) { mod[y][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; ++bi }
        }
    }
    function applyMask(m) {
        for (var y = 0; y < size; ++y) for (var x = 0; x < size; ++x) {
            var inv
            switch (m) {
            case 0: inv = (x + y) % 2 === 0; break
            case 1: inv = y % 2 === 0; break
            case 2: inv = x % 3 === 0; break
            case 3: inv = (x + y) % 3 === 0; break
            case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
            case 5: inv = x * y % 2 + x * y % 3 === 0; break
            case 6: inv = (x * y % 2 + x * y % 3) % 2 === 0; break
            default: inv = ((x + y) % 2 + x * y % 3) % 2 === 0
            }
            if (!fn[y][x] && inv) mod[y][x] = !mod[y][x]
        }
    }
    function penalty() {
        var p = 0, dark = 0, x, y
        function runs(line) {
            var s = 0, run = 1
            for (var i = 1; i <= line.length; ++i) {
                if (i < line.length && line[i] === line[i - 1]) ++run
                else { if (run >= 5) s += 3 + run - 5; run = 1 }
            }
            // finder-like patterns
            var pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]
            for (i = 0; i + 11 <= line.length; ++i) {
                var m1 = true, m2 = true
                for (var q = 0; q < 11; ++q) { var bv = line[i + q] ? 1 : 0; if (bv !== pat1[q]) m1 = false; if (bv !== pat2[q]) m2 = false }
                if (m1) s += 40; if (m2) s += 40
            }
            return s
        }
        for (y = 0; y < size; ++y) p += runs(mod[y])
        for (x = 0; x < size; ++x) { var col = []; for (y = 0; y < size; ++y) col.push(mod[y][x]); p += runs(col) }
        for (y = 0; y < size - 1; ++y) for (x = 0; x < size - 1; ++x) if (mod[y][x] === mod[y][x + 1] && mod[y][x] === mod[y + 1][x] && mod[y][x] === mod[y + 1][x + 1]) p += 3
        for (y = 0; y < size; ++y) for (x = 0; x < size; ++x) if (mod[y][x]) ++dark
        var total = size * size, k2 = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
        return p + k2 * 10
    }
    var best = 0, bestP = 1e9
    for (var m = 0; m < 8; ++m) {
        applyMask(m); format(m); var pn = penalty()
        if (pn < bestP) { bestP = pn; best = m }
        applyMask(m)
    }
    applyMask(best); format(best)
    return mod
}
