import QtQuick 2.6
import "."
import Sailfish.Silica 1.0
import QtQuick.Window 2.2

// Page with the web background colour (an opaque Silica page background) so both web themes hold regardless of the ambience.
Page {
    id: page
    property alias navigation: navigation
    property real contentTop: 0      // where the web's scroll area starts (Home: below its 72 px header)
    property bool shellLayer: true   // false where the web draws no shell behind the page (the actions drawer)
    allowedOrientations: Orientation.Portrait
    showNavigationIndicator: false   // the web has no edge glow for the swipe back hint
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
    // The web paints the shell, the app frame and the page one over another; each is a full-window surface here too.
    background: Component {
        Item {
            // shell, app frame and page: each a surface inside the one before, as the web nests them
            Rectangle { anchors.fill: parent; color: page.shellLayer ? Tokens.shell : Tokens.bg
                Rectangle { anchors.fill: parent; color: Tokens.bg
                    Rectangle { anchors.fill: parent; color: Tokens.bg
                        Rectangle { visible: page.contentTop > 0; y: page.contentTop; width: parent.width; height: parent.height - y; color: Tokens.bg }
                    }
                }
            }
        }
    }
}
