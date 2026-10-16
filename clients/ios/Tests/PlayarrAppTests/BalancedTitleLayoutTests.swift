@testable import PlayarrApp
import UIKit
import XCTest

final class BalancedTitleLayoutTests: XCTestCase {
    func testBalancesWordsWithinTheExistingMeasure() throws {
        let font = UIFont.monospacedSystemFont(ofSize: 20, weight: .regular)
        let tracking: CGFloat = 0
        let title = "AA BB CC DD"
        let maxWidth = ("AA BB CC" as NSString).size(withAttributes: [.font: font]).width

        let lines = try XCTUnwrap(BalancedTitleLayout.lines(for: title, font: font, tracking: tracking, maxWidth: maxWidth))
        XCTAssertEqual(lines, ["AA BB", "CC DD"])
    }

    func testOversizedUnbrokenWordFallsBackForNativeWrapping() throws {
        let font = try XCTUnwrap(DesignFont.uiFont(
            family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName,
            size: 40, weight: 560, fixedAxes: DesignFont.nunitoAxes
        ))
        let width = ("000000000" as NSString).size(withAttributes: [.font: font]).width

        XCTAssertNil(BalancedTitleLayout.lines(for: "ExtraordinarilyLongToken Sample", font: font, tracking: -2.88, maxWidth: width))
    }
}
