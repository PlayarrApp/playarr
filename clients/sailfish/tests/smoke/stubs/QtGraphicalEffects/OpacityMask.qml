import QtQuick 2.6
// Smoke stub: shows the source unmasked.
Item { property var source; property var maskSource
  ShaderEffectSource { anchors.fill: parent; sourceItem: parent.source; hideSource: true } }
