@testable import PlayarrApp
import SwiftUI
import XCTest

@available(iOS 18.0, *)
@MainActor
final class ParityTextRendererTests: XCTestCase {
    func testMeasuredTextDoesNotExpandToItsContainer() throws {
        var measured: [CGRect] = []
        let renderer = ImageRenderer(content: Text("Sample")
            .font(.system(size: 20))
            .textRenderer(ParityTextRenderer { measured = $0.map(\.rect) })
            .frame(width: 300, height: 100))
        XCTAssertNotNil(renderer.uiImage)
        let bounds = try XCTUnwrap(measured.first)
        XCTAssertEqual(measured.count, 1)
        XCTAssertGreaterThan(bounds.width, 0)
        XCTAssertLessThan(bounds.width, 200)
        XCTAssertGreaterThan(bounds.height, 0)
        XCTAssertLessThan(bounds.height, 50)
    }

    func testMeasuredBoundsFollowTheTruncatedDrawing() throws {
        func measure(width: CGFloat) throws -> CGRect {
            var measured: [CGRect] = []
            let renderer = ImageRenderer(content: Text("A longer sample label")
                .font(.system(size: 20))
                .lineLimit(1)
                .truncationMode(.tail)
                .textRenderer(ParityTextRenderer { measured = $0.map(\.rect) })
                .frame(width: width, height: 60))
            XCTAssertNotNil(renderer.uiImage)
            return try XCTUnwrap(measured.first)
        }
        let full = try measure(width: 400)
        let truncated = try measure(width: 70)
        XCTAssertGreaterThan(full.width, truncated.width)
        XCTAssertLessThanOrEqual(truncated.width, 70)
        XCTAssertEqual(truncated.height, full.height, accuracy: 1)
    }

    func testWrappedTextReportsOneLineEachWithItsOwnString() throws {
        let text = "alpha beta gamma delta epsilon zeta eta theta"
        var lines: [ParityRenderedLine] = []
        let renderer = ImageRenderer(content: Text(text)
            .font(.system(size: 20))
            .textRenderer(ParityTextRenderer { lines = $0 })
            .frame(width: 140, height: 300, alignment: .topLeading))
        XCTAssertNotNil(renderer.uiImage)
        XCTAssertGreaterThan(lines.count, 1)
        let shown = parityDisplayedLines(text, lines)
        XCTAssertEqual(shown.count, lines.count)
        XCTAssertEqual(shown.joined(separator: " "), text)
    }

    func testTruncatedTextReportsTheEllipsis() throws {
        let text = "A longer sample label that cannot fit"
        var lines: [ParityRenderedLine] = []
        let renderer = ImageRenderer(content: Text(text)
            .font(.system(size: 20))
            .lineLimit(1)
            .textRenderer(ParityTextRenderer { lines = $0 })
            .frame(width: 120, height: 60, alignment: .topLeading))
        XCTAssertNotNil(renderer.uiImage)
        let shown = parityDisplayedLines(text, lines)
        XCTAssertEqual(shown.count, 1)
        XCTAssertTrue(shown[0].hasSuffix("\u{2026}"), shown[0])
    }
}
