@testable import PlayarrApp
import SwiftUI
import XCTest

final class ParityPaintTests: XCTestCase {
    func testTwoDisjointClipsRemoveWhatEachOneAloneWouldKeep() {
        var paint = ParityPaint()
        paint.clips = [CGRect(x: 0, y: 0, width: 100, height: 100), CGRect(x: 200, y: 0, width: 100, height: 100)]
        XCTAssertNil(paint.effective(CGRect(x: 50, y: 10, width: 200, height: 20)))
    }

    func testZeroOpacityAndFullyMaskedItemsAreNotVisible() {
        var paint = ParityPaint()
        paint.opacity = 0
        XCTAssertNil(paint.effective(CGRect(x: 0, y: 0, width: 10, height: 10)))
        paint.opacity = 1
        paint.fades = [ParityFade(rect: CGRect(x: 0, y: 0, width: 100, height: 10), horizontal: true, stops: [SIMD2(0, 1), SIMD2(1, 0.3)])]
        XCTAssertEqual(try XCTUnwrap(paint.effective(CGRect(x: 90, y: 0, width: 10, height: 10))), 0.3 + 0.7 * 0.05, accuracy: 0.01)
    }

    func testMaskAlphaIsSampledInTheVisiblePart() {
        var paint = ParityPaint()
        paint.clips = [CGRect(x: 0, y: 0, width: 50, height: 10)]
        paint.fades = [ParityFade(rect: CGRect(x: 0, y: 0, width: 100, height: 10), horizontal: true, stops: [SIMD2(0, 1), SIMD2(1, 0.5)])]
        // The item spans 0...100 but only 0...50 is visible: alpha at x = 25, not at the centre x = 50.
        XCTAssertEqual(try XCTUnwrap(paint.effective(CGRect(x: 0, y: 0, width: 100, height: 10))), 0.875, accuracy: 0.001)
    }

    func testGradientBackdropIsSampledAtThePointItIsDrawnAt() {
        var backdrop = ParityBackdrop()
        backdrop.layers = [.gradient(rect: CGRect(x: 0, y: 0, width: 100, height: 10), start: CGPoint(x: 0, y: 0.5), end: CGPoint(x: 1, y: 0.5),
                                     stops: [SIMD4(0, 0, 0, 1), SIMD4(1, 1, 1, 1)], locations: [0, 1])]
        let environment = EnvironmentValues()
        XCTAssertEqual(backdrop.rgb(at: CGPoint(x: 25, y: 5), environment).r, 0.25, accuracy: 0.001)
        XCTAssertEqual(backdrop.rgb(at: CGPoint(x: 75, y: 5), environment).r, 0.75, accuracy: 0.001)
    }

    func testNothingIsDrawnOutsideAMaskedFrame() {
        let fade = ParityFade(rect: CGRect(x: 0, y: 0, width: 100, height: 10), horizontal: true, stops: [SIMD2(0, 1), SIMD2(1, 0.3)])
        XCTAssertEqual(fade.alpha(at: CGPoint(x: 150, y: 5)), 0)
    }

    func testScaleFactorsMultiplyAndNeverMoveAGlobalFrame() {
        var paint = ParityPaint()
        paint.scales = [ParityScale(factor: 1.1), ParityScale(factor: 1.1)]
        XCTAssertEqual(paint.scale, 1.21, accuracy: 0.001)
        // A frame read in the global space already includes the transform: the box is exported as measured.
        let frame = CGRect(x: 40, y: 40, width: 22, height: 22)
        XCTAssertEqual(paint.effective(frame), 1)
    }

    func testAClippedAwayFrameHasNoOpacity() {
        var paint = ParityPaint()
        paint.clips = [CGRect(x: 10, y: 10, width: 100, height: 40)]
        XCTAssertNil(paint.effective(CGRect(x: 120, y: 12, width: 40, height: 40)))
        XCTAssertEqual(paint.effective(CGRect(x: 100, y: 12, width: 40, height: 40)), 1)
    }
}
