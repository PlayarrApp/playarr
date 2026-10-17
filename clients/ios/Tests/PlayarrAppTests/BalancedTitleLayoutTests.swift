@testable import PlayarrApp
import UIKit
import XCTest

final class BalancedTitleLayoutTests: XCTestCase {
    func testBalancesWordsWithinTheMeasuredWidth() throws {
        let font = UIFont.monospacedSystemFont(ofSize: 20, weight: .regular)
        let title = "AA BB CC DD"
        let maxWidth = ("AA BB CC" as NSString).size(withAttributes: [.font: font]).width

        let lines = try XCTUnwrap(BalancedTitleLayout.lines(for: title, font: font, tracking: 0, maxWidth: maxWidth))
        XCTAssertEqual(lines, ["AA BB", "CC DD"])
    }

    func testReturnsNilWhenAWordCannotFit() {
        let font = UIFont.monospacedSystemFont(ofSize: 20, weight: .regular)
        XCTAssertNil(BalancedTitleLayout.lines(for: "TOOLONG word", font: font, tracking: 0, maxWidth: 20))
    }

    func testLibraryPreviewFollowsActionsThenFocusThenFirstWork() {
        XCTAssertEqual(LibraryOverlayParity.previewWork(actionsWork: "action", focusedWork: "focus", works: ["first"]), "action")
        XCTAssertEqual(LibraryOverlayParity.previewWork(actionsWork: nil, focusedWork: "focus", works: ["first"]), "focus")
        XCTAssertEqual(LibraryOverlayParity.previewWork(actionsWork: nil, focusedWork: nil, works: ["first"]), "first")
        XCTAssertNil(LibraryOverlayParity.previewWork(actionsWork: nil, focusedWork: nil, works: [String]()))
    }
}
