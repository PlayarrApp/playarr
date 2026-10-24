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
            .textRenderer(ParityTextRenderer { measured = $0 })
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
                .textRenderer(ParityTextRenderer { measured = $0 })
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
}
