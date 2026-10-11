import QtQuick 2.6
Item { property bool running; property int size; width: 40; height: 40
  Rectangle { anchors.fill: parent; visible: parent.running; radius: width / 2; color: "transparent"; border.color: "#888"; border.width: 3 } }
