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

    func testProbeCharacterIndex() throws {
        var probe = ""
        let renderer = ImageRenderer(content: Text("abc def ghi")
            .textRenderer(ProbeRenderer { probe = $0 })
            .frame(width: 40, height: 100, alignment: .topLeading))
        XCTAssertNotNil(renderer.uiImage)
        XCTFail(probe)
    }
}

@available(iOS 18.0, *)
private struct ProbeRenderer: TextRenderer {
    let report: (String) -> Void
    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout { context.draw(line) }
        report(layout.map { line in line.flatMap { $0.characterIndices }.map { "\(String(reflecting: $0)) \(Mirror(reflecting: $0).children.map { "\($0.label ?? "-")=\(type(of: $0.value))" })" }.joined(separator: ";") }.joined(separator: " | "))
    }
}
