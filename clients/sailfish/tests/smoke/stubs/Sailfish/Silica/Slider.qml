import QtQuick 2.6
Item { property real minimumValue; property real maximumValue: 1; property real value; property bool handleVisible
  property real sliderValue: value; property bool pressed; signal released(real value); height: 40
  Rectangle { anchors.centerIn: parent; width: parent.width; height: 3; color: "#888" } }
