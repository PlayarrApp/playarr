import QtQuick 2.6
TextInput { property string placeholderText; property var EnterKey: QtObject { property string iconSource; signal clicked() }
  height: 48; color: "white"; Text { visible: !parent.text; text: parent.placeholderText; color: "#888" } }
