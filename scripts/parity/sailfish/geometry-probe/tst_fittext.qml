import QtQuick 2.6
import QtTest 1.1
import "../../../../clients/sailfish/qml/components"

// Every displayed line is a natural-height label (lineHeight 1) placed at its own y, whatever pitch the caller asks for.
// Run: QT_QPA_PLATFORM=minimal qmltestrunner -import clients/sailfish/tests/smoke/stubs -input scripts/parity/sailfish/geometry-probe/tst_fittext.qml
TestCase {
    name: "FitTextNaturalLines"
    when: windowShown
    visible: true
    width: 300; height: 300

    Component {
        id: fitComponent
        FitText {
            width: 120
            wrapMode: Text.WordWrap
            font.pixelSize: 14
            color: "black"
            text: "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu"
        }
    }

    function labelsOf(fit) {
        var col = null
        for (var i = 0; i < fit.children.length; ++i) if (fit.children[i].spacing !== undefined) col = fit.children[i]
        var out = []
        for (var j = 0; j < col.children.length; ++j) if (col.children[j].lineHeight !== undefined) out.push(col.children[j])
        return out
    }

    function check(fit, pitch) {
        waitForRendering(fit)
        var labels = labelsOf(fit)
        verify(labels.length >= 3)
        for (var i = 0; i < labels.length; ++i) {
            compare(labels[i].lineHeight, 1)
            compare(labels[i].lineHeightMode, Text.ProportionalHeight)
            compare(labels[i].contentHeight, fit.naturalHeight)
            fuzzyCompare(labels[i].y, i * pitch, 0.001)
        }
        return labels.length
    }

    function test_defaultPitchIsTheFontHeight() {
        var fit = createTemporaryObject(fitComponent, this)
        check(fit, fit.naturalHeight)
    }

    function test_proportionalPitchKeepsLinesNatural() {
        var fit = createTemporaryObject(fitComponent, this, { lineHeight: 0.97 })
        var n = check(fit, 0.97 * fit.naturalHeight)
        fuzzyCompare(fit.implicitHeight, n * 0.97 * fit.naturalHeight, 0.001)
    }

    function test_fixedPitchKeepsLinesNatural() {
        var fit = createTemporaryObject(fitComponent, this, { lineHeightMode: Text.FixedHeight, lineHeight: 20 })
        var n = check(fit, 20)
        fuzzyCompare(fit.implicitHeight, n * 20, 0.001)
    }

    function test_blockCanEndAtItsLastLine() {
        var fit = createTemporaryObject(fitComponent, this, { lineHeight: 1.5, endAtLastLine: true })
        var n = check(fit, 1.5 * fit.naturalHeight)
        fuzzyCompare(fit.implicitHeight, (n - 1) * 1.5 * fit.naturalHeight + fit.naturalHeight, 0.001)
    }
}
