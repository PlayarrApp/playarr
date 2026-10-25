import QtQuick 2.6
Item {
  property bool running
  property int size
  width: 40
  height: 40
  opacity: running ? 1 : 0
  Behavior on opacity { FadeAnimation {} }
  Rectangle { anchors.fill: parent; visible: parent.opacity > 0; radius: width / 2; color: "transparent"; border.color: "#888"; border.width: 3 }
}
