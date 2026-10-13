@testable import PlayarrApp
import PlayarrKit
import XCTest

final class RootNavigationSelectionTests: XCTestCase {
    func testDetailStageSelectionUsesTheMatchingLibraryKind() {
        XCTAssertEqual(
            AuthenticatedPlayarrShell.Destination.detail(.movie).stageNavigationSelection,
            .library(.movie)
        )
        XCTAssertEqual(
            AuthenticatedPlayarrShell.Destination.detail(.series).stageNavigationSelection,
            .library(.series)
        )
    }

    func testNonDetailStageSelectionIsPreserved() {
        XCTAssertEqual(
            AuthenticatedPlayarrShell.Destination.search.stageNavigationSelection,
            .search
        )
    }
}
