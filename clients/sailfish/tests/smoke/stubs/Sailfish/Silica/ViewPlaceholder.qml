import QtQuick 2.6
Item { property bool enabled; property string text; property string hintText; anchors.fill: parent
  Text { visible: parent.enabled; anchors.centerIn: parent; text: parent.text; color: "#888" } }
