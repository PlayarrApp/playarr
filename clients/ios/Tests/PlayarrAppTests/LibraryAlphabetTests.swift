import Foundation
import PlayarrKit
@testable import PlayarrApp
import XCTest

@MainActor
final class LibraryAlphabetTests: XCTestCase {
    func testAlphabetUsesSortTitleAndMatchesWebCompatibilityNormalization() {
        let work = Work(
            id: UUID(),
            kind: .artist,
            title: "Sample Work",
            sortTitle: " Éclair",
            addedAt: Date(),
            monitored: true,
            availability: .available
        )

        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: work), "E")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "  Ｓample"), "S")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "  ７Sample"), "#")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "  ﬀoo"), "F")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "   42 Sample"), "#")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: ""), "#")
    }
}
