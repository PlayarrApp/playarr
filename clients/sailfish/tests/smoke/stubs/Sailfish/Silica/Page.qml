import QtQuick 2.6
Item {
    property int status: 2
    property PaletteStub palette: PaletteStub {}
    property Component background
    Loader { anchors.fill: parent; z: -1; sourceComponent: parent.background }
    property int allowedOrientations
    property bool showNavigationIndicator
    property bool backNavigation
    property var pageContainer
}
