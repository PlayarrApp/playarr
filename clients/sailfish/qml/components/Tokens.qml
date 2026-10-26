pragma Singleton
import QtQuick 2.6
import Sailfish.Silica 1.0

// Web design tokens (clients/tv-web), dark and light. `dark` follows the in-app theme setting, else the ambience.
QtObject {
    readonly property bool dark: Api.themeMode === "dark" || (Api.themeMode !== "light" && Theme.colorScheme === Theme.LightOnDark)
    // CSS px of the 390 px web mobile layout, scaled to this screen (set by the application window).
    property real u: 1
    // Safe area: content sits below a notch or camera cutout and above the bottom gesture area; backgrounds still bleed.
    property real testTop: 0       // emulator smoke scripts set this to simulate a cutout
    property real testBottom: 0
    // Web (#1314) uses max(base, inset): the layout already carries the 14 px top and 8 px bottom base, so only the excess is added.
    readonly property real safeTop: Math.max(0, Math.max(testTop, Screen.topCutout && Screen.topCutout.height ? Screen.topCutout.height : 0) - 14 * u)
    readonly property real safeBottom: Math.max(0, Math.max(testBottom, Screen.bottomCutout && Screen.bottomCutout.height ? Screen.bottomCutout.height : 0) - 8 * u)

    // Pages sit on the web's surface colour (the web token `bg` is only the outer shell).
    // The web `bg` token: the outer shell behind the app frame.
    readonly property color shell: dark ? "#151315" : "#f5f3f2"
    readonly property color bg: dark ? "#1b181b" : "#fbfaf9"
    readonly property color surface: dark ? "#1b181b" : "#fbfaf9"
    readonly property color surfaceStrong: dark ? "#211d21" : "#ffffff"
    readonly property color surfaceSoft: dark ? "#312a30" : "#dfdcdd"
    readonly property color ink: dark ? "#f4f0f1" : "#382621"
    readonly property color inkSoft: dark ? "#c5b8bd" : "#4d4248"
    readonly property color inkMuted: dark ? "#c2b5bb" : "#4d4248"
    readonly property color line: dark ? Qt.rgba(223/255, 220/255, 221/255, 0.11) : Qt.rgba(56/255, 38/255, 33/255, 0.14)
    readonly property color lineStrong: dark ? Qt.rgba(223/255, 220/255, 221/255, 0.23) : Qt.rgba(56/255, 38/255, 33/255, 0.28)
    readonly property color accent: dark ? "#dfdcdd" : "#675961"
    readonly property color accentInk: dark ? "#211d21" : "#ffffff"
    readonly property color success: dark ? "#7fc09d" : "#347559"
    readonly property color danger: dark ? "#ee9297" : "#a8464c"
    readonly property color brandPink: "#cf3157"
    readonly property color brandPinkSoft: "#eaa6b6"
    readonly property color brandInk: dark ? brandPinkSoft : "#821e36"
    // The web's primary "Play" button is the near-white ink on dark.
    readonly property color primary: dark ? "#f4f0f1" : "#382621"
    readonly property color primaryInk: dark ? "#151315" : "#f5f3f2"

    readonly property string family: nunito.name
    property FontLoader nunito: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-wght-web.ttf") }
    // Static weights the web phone layout uses (Qt 5.6 cannot pick weights from a variable font).
    property FontLoader nunito400: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-400.ttf") }
    property FontLoader nunito580: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-580.ttf") }
    property FontLoader nunito610: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-610.ttf") }
    property FontLoader nunito820: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-820.ttf") }
    // Further static weights the web phone layout uses; `fam(w)` returns the family of weight w, `weightOfFamily` is the reverse map.
    property FontLoader nunito300: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-300.ttf") }
    property FontLoader nunito560: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-560.ttf") }
    property FontLoader nunito480: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-480.ttf") }
    property FontLoader nunito640: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-640.ttf") }
    property FontLoader nunito680: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-680.ttf") }
    property FontLoader nunito700: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-700.ttf") }
    property FontLoader nunito720: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-720.ttf") }
    property FontLoader nunito760: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-760.ttf") }
    property FontLoader nunito900: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-900.ttf") }
    readonly property var loaders: ({ 300: nunito300, 400: nunito400, 480: nunito480, 560: nunito560, 580: nunito580, 610: nunito610, 640: nunito640, 680: nunito680,
                                      700: nunito700, 720: nunito720, 760: nunito760, 820: nunito820, 900: nunito900 })
    function fam(w) { return loaders[w].name }
    function weightOfFamily() { var m = {}; for (var k in loaders) m[loaders[k].name] = Number(k); return m }
    readonly property string family400: nunito400.name
    readonly property string family580: nunito580.name
    readonly property string family610: nunito610.name
    readonly property string family820: nunito820.name
    // Device-pixel snapping like the browser: edges land on whole pixels so art is not resampled by a half pixel.
    // A css font size as whole device pixels: Chromium lays text out at the fractional size, Qt 5.6 only takes an int.
    // fsFit: Qt rounds the ascent and descent of a pixel size up, so the nearest size can give a taller text box than the web's (which rounds each
    // to the nearest). Of the sizes within half a css px of the web's, take the one whose box is closest to the web's (Nunito Sans metrics).
    function fs(css) { return Math.round(css * u) }
    function fsFit(css) {
        var p0 = Math.round(css * u), best = p0, bestCost = 1e9
        var aw = Math.round(1.011 * css), dw = Math.round(0.353 * css)
        for (var p = p0 - 1; p <= p0 + 1; ++p) {
            if (Math.abs(p / u - css) > 0.5) continue
            var ea = Math.abs(Math.ceil(1.011 * p - 0.01) / u - aw), ed = Math.abs(Math.ceil(0.353 * p - 0.01) / u - dw)
            var cost = (Math.max(ea, ed) > 0.9 ? 10 : 0) + ea + ed + Math.abs(p / u - css) / 10
            if (cost < bestCost) { bestCost = cost; best = p }
        }
        return best
    }
    function fsDown(css) { return Math.floor(css * u) }
    function px(v) { return Math.round(v * u) }
    readonly property real pad: 16 * u
    readonly property real radius: 10 * u
}
