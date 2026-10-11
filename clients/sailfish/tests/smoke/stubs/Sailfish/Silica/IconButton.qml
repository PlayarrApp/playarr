import QtQuick 2.6
MouseArea { property alias icon: ic; width: 64; height: 64; signal clicked()
  Item { id: ic; property string source } Rectangle { anchors.centerIn: parent; width: 28; height: 28; radius: 14; color: "white"; opacity: 0.8 } }
