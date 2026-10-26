import QtQuick 2.6
import Sailfish.Silica 1.0
import "components"
import "pages"
import "startRoute.js" as StartRoute
import "components/LayoutDump.js" as LayoutDump

ApplicationWindow {
    id: app
    allowedOrientations: Orientation.Portrait
    _defaultPageOrientations: Orientation.Portrait
    cover: Component {
        CoverBackground {
            Label { renderType: Text.NativeRendering;
                anchors.centerIn: parent
                text: "Playarr"
                font.family: Tokens.family
            }
        }
    }

    Component.onCompleted: Tokens.u = Screen.width / 390

    FontMetrics { id: layoutFontMetrics }
    // Parity layout export (docs/parity/LAYOUT.md); only a PLAYARR_STEPS `js:layoutDump()` step calls it.
    function layoutDump() {
        LayoutDump.dump(app.contentItem, Tokens.u, Tokens.weightOfFamily(), function (font) {
            layoutFontMetrics.font = font
            return { ascent: layoutFontMetrics.ascent, descent: layoutFontMetrics.descent,
                advance: function (text) { return layoutFontMetrics.advanceWidth(text) },
                elide: function (text, mode, width) { return layoutFontMetrics.elidedText(text, mode, width) } }
        }, function (line) { console.log(line) })
    }

    Connections {
        target: pageStack.currentPage
        ignoreUnknownSignals: true
        onParityCaptureLayoutDumpRequested: app.layoutDump()
    }

    function showStart() {
        pageStack.replaceAbove(null, startPage(Api.signedIn, Api.profiles.length))
    }

    function startPage(signedIn, profileCount) {
        var route = StartRoute.initialRoute(signedIn, profileCount)
        return route === "profiles" ? profilesPage : route === "main" ? mainPage : linkPage
    }

    initialPage: startPage(Api.signedIn, Api.profiles.length)
    Component { id: linkPage; LinkPage {} }
    Component { id: profilesPage; ProfilesPage {} }
    Component { id: mainPage; MainPage {} }

    DownloadNotices {}
    KeepRules {}

    Connections {
        target: Api
        // The signed-in profile was removed or its refresh token revoked.
        onSessionChanged: if (!Api.signedIn && pageStack.depth > 0 && pageStack.currentPage.objectName !== "link") app.showStart()
    }
}
