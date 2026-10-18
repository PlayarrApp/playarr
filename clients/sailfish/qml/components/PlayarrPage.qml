import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Page with the web background colour (an opaque Silica page background) so both web themes hold regardless of the ambience.
Page {
    allowedOrientations: Orientation.Portrait
    showNavigationIndicator: false   // the web has no edge glow for the swipe back hint
    // Silica widgets (search field, busy indicator, menus) follow the app theme, not the ambience.
    palette.colorScheme: Tokens.dark ? Theme.LightOnDark : Theme.DarkOnLight
    // Every child sits inside the safe area; the page background below stays edge to edge.
    default property alias safeContent: safeArea.data
    Item { id: safeArea; anchors { fill: parent; topMargin: Tokens.safeTop; bottomMargin: Tokens.safeBottom } }
    background: Component { Rectangle { color: Tokens.bg } }
}
