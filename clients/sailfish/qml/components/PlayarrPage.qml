import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Page with the web background colour (an opaque Silica page background) so both web themes hold regardless of the ambience.
Page {
    allowedOrientations: Orientation.Portrait
    // Silica widgets (search field, busy indicator, menus) follow the app theme, not the ambience.
    palette.colorScheme: Tokens.dark ? Theme.LightOnDark : Theme.DarkOnLight
    background: Component { Rectangle { color: Tokens.bg } }
}
