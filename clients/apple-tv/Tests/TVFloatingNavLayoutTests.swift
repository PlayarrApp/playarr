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

    func testPriorityNavVectorsMatchWebViewBoxGeometry() throws {
        XCTAssertEqual(TVNavIconVector.viewBoxSize, 24, accuracy: 0.01)
        XCTAssertEqual(TVNavIconVector.strokeWidth, 1.8, accuracy: 0.01)
        XCTAssertEqual(TVNavIconVector.renderedSize, 20, accuracy: 0.01)

        for tab in TVNavTab.allCases {
            guard let vector = TVNavIconVector.forTab(tab) else { continue }
            XCTAssertFalse(vector.strokes.isEmpty, "Expected web path data for a rendered tab")
            for path in vector.strokes + vector.fills {
                let bounds = path.boundingRect
                XCTAssertGreaterThanOrEqual(bounds.minX, 0)
                XCTAssertGreaterThanOrEqual(bounds.minY, 0)
                XCTAssertLessThanOrEqual(bounds.maxX, TVNavIconVector.viewBoxSize)
                XCTAssertLessThanOrEqual(bounds.maxY, TVNavIconVector.viewBoxSize)
            }
        }

        let series = try XCTUnwrap(TVNavIconVector.forTab(.series))
        XCTAssertEqual(series.bounds.minX, 4, accuracy: 0.01)
        XCTAssertEqual(series.bounds.minY, 1, accuracy: 0.01)
        XCTAssertEqual(series.bounds.maxX, 20, accuracy: 0.01)
        XCTAssertEqual(series.bounds.maxY, 20, accuracy: 0.01)

        let movies = try XCTUnwrap(TVNavIconVector.forTab(.movies))
        XCTAssertEqual(movies.bounds.minX, 3, accuracy: 0.01)
        XCTAssertEqual(movies.bounds.minY, 2, accuracy: 0.01)
        XCTAssertEqual(movies.bounds.maxX, 21, accuracy: 0.01)
        XCTAssertEqual(movies.bounds.maxY, 19, accuracy: 0.01)
        XCTAssertEqual(movies.fills.count, 1, "The web movie icon has a filled play triangle")

        let playlists = try XCTUnwrap(TVNavIconVector.forTab(.playlists))
        XCTAssertEqual(playlists.bounds.minX, 5, accuracy: 0.01)
        XCTAssertEqual(playlists.bounds.minY, 6, accuracy: 0.01)
        XCTAssertEqual(playlists.bounds.maxX, 21, accuracy: 0.01)
        XCTAssertEqual(playlists.bounds.maxY, 21, accuracy: 0.01)

        let requests = try XCTUnwrap(TVNavIconVector.forTab(.requests))
        let watchlist = try XCTUnwrap(TVNavIconVector.forTab(.watchlist))
        XCTAssertEqual(requests.bounds, watchlist.bounds, "Web maps Requests to WatchlistIcon")
        XCTAssertEqual(requests.strokes.count, watchlist.strokes.count)
        XCTAssertEqual(requests.fills.count, watchlist.fills.count)
        XCTAssertNil(TVNavIconVector.forTab(.settings), "Settings keeps the platform symbol fallback")
    }
}
