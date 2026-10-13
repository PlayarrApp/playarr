import XCTest
@testable import PlayarrTV

final class TVFloatingNavLayoutTests: XCTestCase {
    func testFullHeightRailMatchesMeasuredWebHeaderFooterAndLeftTarget() throws {
        let metrics = TVFloatingNavLayout.metrics(height: 1080)

        XCTAssertEqual(metrics.topInset, 113.12, accuracy: 0.01)
        XCTAssertEqual(metrics.bottomInset, 20.56, accuracy: 0.01)

        // The web rail's first tile and measured ArrowLeft target were y=158.828 and y=546.234.
        let firstTileCenter = try XCTUnwrap(
            TVFloatingNavLayout.tileCenterY(index: 0, groupCounts: [2, 4, 4], height: 1080)
        )
        XCTAssertEqual(firstTileCenter, 158.828, accuracy: 0.5)
        let leftTargetCenter = try XCTUnwrap(
            TVFloatingNavLayout.tileCenterY(index: 5, groupCounts: [2, 4, 4], height: 1080)
        )
        XCTAssertEqual(leftTargetCenter, 546.234, accuracy: 1.0)
    }

    func testInsetsFollowWebClampsAtResponsiveHeights() {
        let compact = TVFloatingNavLayout.metrics(height: 720)
        XCTAssertEqual(compact.topInset, 90.08, accuracy: 0.01)
        XCTAssertEqual(compact.bottomInset, 9.04, accuracy: 0.01)

        let short = TVFloatingNavLayout.metrics(height: 620)
        XCTAssertEqual(short.topInset, 85.44, accuracy: 0.01)
        XCTAssertEqual(short.bottomInset, 8, accuracy: 0.01)

        let tall = TVFloatingNavLayout.metrics(height: 1440)
        XCTAssertEqual(tall.topInset, 124.4, accuracy: 0.01)
        XCTAssertEqual(tall.bottomInset, 32, accuracy: 0.01)
    }

    func testProfileFootRegionAndTileIndexAreBounded() {
        let metrics = TVFloatingNavLayout.metrics(height: 1080)
        XCTAssertEqual(1080 - metrics.bottomInset, 1059.453, accuracy: 0.02)
        XCTAssertNil(TVFloatingNavLayout.tileCenterY(index: -1, groupCounts: [2, 4, 4], height: 1080))
        XCTAssertNil(TVFloatingNavLayout.tileCenterY(index: 10, groupCounts: [2, 4, 4], height: 1080))
    }
}
