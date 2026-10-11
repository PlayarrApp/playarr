import QtQuick 2.6
Item { property string source; property color color: "white"; property size sourceSize
  width: sourceSize.width; height: sourceSize.height
  Rectangle { anchors.fill: parent; radius: 4; color: "transparent"; border.color: parent.color; border.width: 2 } }
