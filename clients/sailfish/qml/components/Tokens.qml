pragma Singleton
import QtQuick 2.6
import Sailfish.Silica 1.0

// Web design tokens (clients/tv-web), dark and light. `dark` follows the in-app theme setting, else the ambience.
QtObject {
    readonly property bool dark: Api.themeMode === "dark" || (Api.themeMode !== "light" && Theme.colorScheme === Theme.LightOnDark)
    // CSS px of the 390 px web mobile layout, scaled to this screen (set by the application window).
    property real u: 1

    readonly property color bg: dark ? "#151315" : "#f5f3f2"
    readonly property color surface: dark ? "#1b181b" : "#fbfaf9"
    readonly property color surfaceStrong: dark ? "#211d21" : "#ffffff"
    readonly property color surfaceSoft: dark ? "#312a30" : "#dfdcdd"
    readonly property color ink: dark ? "#f4f0f1" : "#382621"
    readonly property color inkSoft: dark ? "#c5b8bd" : "#675961"
    readonly property color inkMuted: dark ? "#887a82" : "#a5969e"
    readonly property color line: dark ? Qt.rgba(223/255, 220/255, 221/255, 0.11) : Qt.rgba(56/255, 38/255, 33/255, 0.14)
    readonly property color lineStrong: dark ? Qt.rgba(223/255, 220/255, 221/255, 0.23) : Qt.rgba(56/255, 38/255, 33/255, 0.28)
    readonly property color accent: dark ? "#dfdcdd" : "#675961"
    readonly property color onAccent: dark ? "#211d21" : "#ffffff"
    readonly property color danger: dark ? "#ee9297" : "#a8464c"
    readonly property color brandPink: "#cf3157"
    readonly property color brandPinkSoft: "#eaa6b6"
    // The web's primary "Play" button is the near-white ink on dark.
    readonly property color primary: dark ? "#f4f0f1" : "#382621"
    readonly property color onPrimary: dark ? "#211d21" : "#ffffff"

    readonly property string family: nunito.name
    property FontLoader nunito: FontLoader { source: Qt.resolvedUrl("../../fonts/NunitoSans-wght-web.ttf") }
    readonly property real pad: 16 * u
    readonly property real radius: 10 * u
}
