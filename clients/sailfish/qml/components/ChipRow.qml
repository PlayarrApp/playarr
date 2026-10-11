import QtQuick 2.6
import "."
import Sailfish.Silica 1.0

// Horizontally scrolling single-choice pills.
Flickable {
    id: root
    property var options: []          // [{ id, label }]
    property string value
    signal picked(string id)
    width: parent ? parent.width : 0
    height: 44 * Tokens.u
    contentWidth: row.width + 2 * Tokens.pad
    clip: true
    Row {
        id: row
        x: Tokens.pad
        spacing: 8 * Tokens.u
        Repeater {
            model: root.options
            PillButton {
                text: modelData.label
                primary: root.value === modelData.id
                onClicked: root.picked(modelData.id)
            }
        }
    }
}
