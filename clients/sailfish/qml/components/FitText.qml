import QtQuick 2.6
import Sailfish.Silica 1.0

// Text as the web lays it out, one Text item per displayed line. The app breaks the text at spaces into lines that fit `width` (at most
// `maximumLineCount`), and puts the real "…" into the last line when text is left over (or, without wrapping, when the line is too wide):
// no Text here wraps or elides by itself, so the layout export reads each line's own box. Same property names as Text/Label.
Item {
    id: root
    property string text: ""
    property font font
    property color color: Theme.primaryColor
    property int horizontalAlignment: Text.AlignLeft
    property int wrapMode: Text.NoWrap          // anything but NoWrap breaks at spaces
    property int maximumLineCount: 0            // 0: no limit when wrapping, one line otherwise
    property int elide: Text.ElideNone          // how the last line is cut when text is left over
    property real lineHeight: 1.0
    property int lineHeightMode: Text.ProportionalHeight
    property real topPadding: 0
    property real bottomPadding: 0
    property int style: Text.Normal
    property color styleColor: "black"
    property bool endAtLastLine: false          // the block ends at its last line's own bottom; otherwise it spans one `lineHeight` pitch per line
    property int lineRole: 0                    // the accessible role of each line (Accessible.Heading for a title)
    readonly property int lineCount: lines.length
    property var lines: []
    property bool laidOut: false

    // Every line item has its font's own height (so the export reads a natural glyph box); `lineHeight` only sets the pitch between lines.
    readonly property real gap: lineHeightMode === Text.FixedHeight ? lineHeight - fm.height : (lineHeight - 1) * fm.height
    implicitHeight: topPadding + col.height + (endAtLastLine || lines.length === 0 ? 0 : gap) + bottomPadding
    implicitWidth: widest
    property real widest: 0

    readonly property real naturalHeight: fm.height
    FontMetrics { id: fm; font: root.font }

    function cut(s, avail) {
        if (fm.advanceWidth(s) <= avail + 0.01 || elide === Text.ElideNone) return s
        // Qt keeps a space before the ellipsis; the web puts it straight after the last letter
        return fm.elidedText(s, elide, avail).replace(/\s+…$/, "…")
    }
    function relayout() {
        if (!laidOut) return
        var avail = width, all = [], paras = (root.font.capitalization === Font.AllUppercase ? text.toUpperCase() : text).split("\n")
        for (var p = 0; p < paras.length; ++p) {
            if (wrapMode === Text.NoWrap) { all.push(paras[p]); continue }
            var tokens = paras[p].match(/\S+\s*/g) || [""], cur = ""
            for (var i = 0; i < tokens.length; ++i) {
                if (cur === "" || fm.advanceWidth((cur + tokens[i]).replace(/\s+$/, "")) <= avail + 0.01) cur += tokens[i]
                else { all.push(cur); cur = tokens[i] }
            }
            all.push(cur)
        }
        var max = maximumLineCount > 0 ? maximumLineCount : wrapMode === Text.NoWrap ? 1 : all.length
        if (all.length > max) all = all.slice(0, max - 1).concat([all.slice(max - 1).join(" ")])
        var out = [], w = 0
        for (var l = 0; l < all.length; ++l) {
            var line = cut(all[l].replace(/\s+$/, ""), avail)
            out.push(line); w = Math.max(w, fm.advanceWidth(line))
        }
        widest = w
        lines = out
    }
    onTextChanged: relayout()
    onWidthChanged: relayout()
    onFontChanged: relayout()
    onWrapModeChanged: relayout()
    onMaximumLineCountChanged: relayout()
    onElideChanged: relayout()
    Component.onCompleted: { laidOut = true; relayout() }

    Column {
        id: col
        y: root.topPadding
        width: root.width
        spacing: root.gap
        Repeater {
            model: root.lines
            PLabel {
                width: col.width
                text: modelData
                renderType: Text.NativeRendering
                font: root.font
                color: root.color
                horizontalAlignment: root.horizontalAlignment
                Accessible.role: root.lineRole
                style: root.style
                styleColor: root.styleColor
            }
        }
    }
}
