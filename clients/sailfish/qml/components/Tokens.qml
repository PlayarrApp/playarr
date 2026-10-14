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
    readonly property real safeTop: Math.max(testTop, Screen.topCutout && Screen.topCutout.height ? Screen.topCutout.height : 0)
    readonly property real safeBottom: Math.max(testBottom, Screen.bottomCutout && Screen.bottomCutout.height ? Screen.bottomCutout.height : 0)

    // Pages sit on the web's surface colour (the web token `bg` is only the outer shell).
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
    readonly property color primaryInk: dark ? "#211d21" : "#ffffff"

    readonly property string family: nunito.name
    property FontLoader nunito: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-wght-web.ttf") }
    // Static weights the web phone layout uses (Qt 5.6 cannot pick weights from a variable font).
    property FontLoader nunito580: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-580.ttf") }
    property FontLoader nunito610: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-610.ttf") }
    property FontLoader nunito820: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-820.ttf") }
    readonly property string family580: nunito580.name
    readonly property string family610: nunito610.name
    readonly property string family820: nunito820.name
    // Device-pixel snapping like the browser: edges land on whole pixels so art is not resampled by a half pixel.
    function px(v) { return Math.round(v * u) }
    readonly property real pad: Math.round(16 * u)
    readonly property real radius: 10 * u
}
