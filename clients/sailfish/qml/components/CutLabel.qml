import QtQuick 2.6
import "."

// A PLabel that shows `webCut` cut at its width with the ellipsis straight after the last letter, as the web does (Qt's own elision keeps a
// space before it). The label draws exactly the text the layout export reports.
PLabel {
    id: label
    property string webCut: ""
    elide: Text.ElideNone
    FontMetrics { id: cutMetrics; font: label.font }
    text: cutMetrics.elidedText(webCut, Qt.ElideRight, width - leftPadding - rightPadding).replace(/\s+…$/, "…")
}
