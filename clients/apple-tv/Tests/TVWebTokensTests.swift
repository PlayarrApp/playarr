import XCTest
@testable import PlayarrTV

/// The token layer evaluates the web stylesheet at 1920 x 1080; these are the values Blink reports for the stylesheet.
final class TVWebTokensTests: XCTestCase {
    func testCardGeometryMatchesTheStylesheet() {
        XCTAssertEqual(TVWeb.railLeft, 729.609375, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.cardWidthMedium, 327.171875, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.cardPitch(), 353.078125, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.gridColumnLeft(2), 1489.515625, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.cardRadius, 12.48, accuracy: 0.0001)
    }

    func testSnappedColumnRemainderRestoresTheLayoutUnit() {
        let gap = TVWeb.layoutUnit(TVWeb.cardGap)
        XCTAssertEqual(TVWeb.fractionalColumnOffset(column: 2, width: TVWeb.cardWidthMedium, gap: gap), 0.515625, accuracy: 0.0001)
    }

    func testDetailsPanelTypeAndInk() {
        XCTAssertEqual(TVWeb.detailsMetaSize, 13.056, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.detailsOverviewSize, 13.824, accuracy: 0.0001)
        // `--dp-soft` in the dark theme is #dad6d7.
        XCTAssertEqual(TVWeb.mix(0xf4f0f1, 88, 0x1b181b), 0xdad6d7)
    }

    func testDetailAndRailTypeFollowTheStylesheet() {
        XCTAssertEqual(TVWeb.titleSize, 69.12, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.titleTracking, -4.97664, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.episodeTitleSize, 21.12, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.detailMetaLineSize, 10.56, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.synopsisSize, 12.864, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.railHeadingSize, 17.664, accuracy: 0.0001)
        XCTAssertEqual(TVWeb.railHeadingWeight, 610)
    }
}
