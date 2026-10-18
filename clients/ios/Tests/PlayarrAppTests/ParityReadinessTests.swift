@testable import PlayarrApp
import XCTest

/// The capture-ready flag must not depend on whether identity or the screen load state arrives first.
final class ParityReadinessTests: XCTestCase {
    func testIdentityAfterReadinessIsReady() {
        var readiness = ParityReadiness()
        readiness.screen = .ready
        XCTAssertFalse(readiness.contentReady)
        readiness.identityVerified = true
        XCTAssertTrue(readiness.contentReady)
    }

    func testReadinessAfterIdentityIsReady() {
        var readiness = ParityReadiness()
        readiness.identityVerified = true
        XCTAssertFalse(readiness.contentReady)
        readiness.screen = .ready
        XCTAssertTrue(readiness.contentReady)
    }

    func testLoadingAndFailedAreNeverReady() {
        for screen: ParityScreenLoad? in [nil, .loading, .failed] {
            XCTAssertFalse(ParityReadiness(identityVerified: true, screen: screen).contentReady)
        }
        XCTAssertTrue(ParityReadiness(identityVerified: true, screen: .failed).failed)
        XCTAssertFalse(ParityReadiness(identityVerified: false, screen: .failed).failed)
    }
}
