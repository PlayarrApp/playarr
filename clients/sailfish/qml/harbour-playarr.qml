import QtQuick 2.6
import Sailfish.Silica 1.0
import "components"
import "pages"

ApplicationWindow {
    id: app
    allowedOrientations: Orientation.Portrait
    _defaultPageOrientations: Orientation.Portrait
    cover: Component {
        CoverBackground {
            Label {
                anchors.centerIn: parent
                text: "Playarr"
                font.family: Tokens.family
            }
        }
    }

    Component.onCompleted: Tokens.u = Screen.width / 390

    function showStart() {
        pageStack.replaceAbove(null, Api.signedIn ? (Api.profiles.length > 1 ? Qt.resolvedUrl("pages/ProfilesPage.qml")
                                                                         : Qt.resolvedUrl("pages/MainPage.qml"))
                                                  : Qt.resolvedUrl("pages/LinkPage.qml"))
    }

    initialPage: Api.signedIn ? (Api.profiles.length > 1 ? profilesPage : mainPage) : linkPage
    Component { id: linkPage; LinkPage {} }
    Component { id: profilesPage; ProfilesPage {} }
    Component { id: mainPage; MainPage {} }

    Connections {
        target: Api
        // The signed-in profile was removed or its refresh token revoked.
        onSessionChanged: if (!Api.signedIn && pageStack.depth > 0 && pageStack.currentPage.objectName !== "link") app.showStart()
    }
}
