import QtQuick 2.6
import Sailfish.Silica 1.0
import "../components"

// Web's "Resume <series>" chooser: where to pick up when the server's resume plan found an ambiguity.
PlayarrPage {
    id: page
    property string seriesTitle
    property var plan
    signal chosen(var option)

    function caption(kind) {
        return kind === "unfinished" ? qsTr("Unfinished") : kind === "missed_episode" ? qsTr("Missed episode")
             : kind === "continue_from_last_watched" ? qsTr("Continue from last watched") : kind === "next_in_series" ? qsTr("Next in series") : qsTr("Start over")
    }
    SilicaFlickable {
        anchors.fill: parent
        contentHeight: col.height + 40 * Tokens.u
        Column {
            id: col
            width: parent.width
            spacing: 10 * Tokens.u
            Item { width: 1; height: 24 * Tokens.u }
            Label { x: Tokens.pad; text: qsTr("CHOOSE WHERE TO PICK UP."); color: Tokens.dark ? Tokens.brandPinkSoft : "#8c2344"; font.family: Tokens.family820; font.letterSpacing: 1.2 * Tokens.u; font.pixelSize: 8 * Tokens.u }
            Label { x: Tokens.pad; width: parent.width - 2 * Tokens.pad; text: qsTr("Resume %1").arg(page.seriesTitle); wrapMode: Text.Wrap; color: Tokens.ink; font.family: Tokens.family580; font.pixelSize: 22 * Tokens.u }
            Repeater {
                model: page.plan ? page.plan.options : []
                MouseArea {
                    x: Tokens.pad; width: col.width - 2 * Tokens.pad; height: info.height + 24 * Tokens.u
                    onClicked: { page.chosen(modelData); pageStack.pop() }
                    Rectangle { anchors.fill: parent; radius: 12 * Tokens.u; color: Tokens.surfaceStrong; border.width: 1; border.color: Tokens.line; opacity: parent.pressed ? 0.7 : 1 }
                    Column {
                        id: info
                        x: 14 * Tokens.u; y: 12 * Tokens.u; width: parent.width - 28 * Tokens.u
                        spacing: 3 * Tokens.u
                        Label { text: page.caption(modelData.kind); color: Tokens.inkMuted; font.family: Tokens.family; font.pixelSize: 8.5 * Tokens.u }
                        Label { width: parent.width; text: modelData.label + (modelData.title ? " · " + modelData.title : ""); wrapMode: Text.Wrap; color: Tokens.ink; font.family: Tokens.family610; font.pixelSize: 11.5 * Tokens.u }
                        Label { visible: !!modelData.last_watched_at; text: qsTr("Last watched %1").arg(modelData.last_watched_at ? Qt.formatDate(new Date(modelData.last_watched_at), "d MMM yyyy") : ""); color: Tokens.inkSoft; font.family: Tokens.family; font.pixelSize: 8.5 * Tokens.u }
                        Rectangle {
                            visible: modelData.kind === "unfinished"
                            width: parent.width; height: 3 * Tokens.u; radius: height / 2; color: Tokens.surfaceSoft
                            Rectangle { width: parent.width * (modelData.progress_percent || 0) / 100; height: parent.height; radius: height / 2; color: Tokens.brandPink }
                        }
                    }
                }
            }
            PillButton { x: Tokens.pad; text: qsTr("Cancel"); implicitWidth: 100 * Tokens.u; fontSize: 10 * Tokens.u; onClicked: pageStack.pop() }
        }
        VerticalScrollDecorator {}
    }
}
