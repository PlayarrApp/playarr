import QtQuick 2.6
import "."
import Sailfish.Silica 1.0
import QtQuick.Window 2.2

// Page with the web background colour (an opaque Silica page background) so both web themes hold regardless of the ambience.
Page {
    id: page
    property alias navigation: navigation
    allowedOrientations: Orientation.Portrait
    // Silica widgets (search field, busy indicator, menus) follow the app theme, not the ambience.
    palette.colorScheme: Tokens.dark ? Theme.LightOnDark : Theme.DarkOnLight
    // Every child sits inside the safe area; the page background below stays edge to edge.
    default property alias safeContent: safeArea.data
    DpadNavigation { id: navigation; page: page }
    Keys.priority: Keys.BeforeItem
    Keys.onPressed: {
        if (!navigation.handleBack(event)) navigation.handlePressed(event)
    }
    Keys.onReleased: navigation.handleReleased(event)
    Item { id: safeArea; anchors { fill: parent; topMargin: Tokens.safeTop; bottomMargin: Tokens.safeBottom } }
    background: Component { Rectangle { color: Tokens.bg } }
}
