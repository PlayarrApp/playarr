import XCTest
import PlayarrKit
@testable import PlayarrTV

#if os(macOS) && DEBUG
final class MacAutomationIdentityTests: XCTestCase {
    private let expectedID = UUID(uuidString: "00000000-0000-4000-8000-000000000001")!

    func testAcceptsOnlyTheCurrentDeviceTestProfileMatchingTokenSubject() {
        let profile = AvailableProfile(
            id: expectedID,
            username: "fixture",
            displayName: "Device Test",
            pinLocked: false,
            isCurrent: true
        )

        XCTAssertTrue(TVParityLaunch.hasVerifiedDeviceTestProfile([profile], currentUserID: expectedID.uuidString))
    }

    func testRejectsWrongProfileName() {
        let profile = AvailableProfile(
            id: expectedID,
            username: "fixture",
            displayName: "Other Profile",
            pinLocked: false,
            isCurrent: true
        )

        XCTAssertFalse(TVParityLaunch.hasVerifiedDeviceTestProfile([profile], currentUserID: expectedID.uuidString))
    }

    func testRejectsMissingOrAmbiguousCurrentProfile() {
        let current = AvailableProfile(
            id: expectedID,
            username: "fixture",
            displayName: "Device Test",
            pinLocked: false,
            isCurrent: true
        )
        let other = AvailableProfile(
            id: UUID(),
            username: "other",
            displayName: "Other Profile",
            pinLocked: false,
            isCurrent: true
        )

        XCTAssertFalse(TVParityLaunch.hasVerifiedDeviceTestProfile([], currentUserID: expectedID.uuidString))
        XCTAssertFalse(TVParityLaunch.hasVerifiedDeviceTestProfile([current, other], currentUserID: expectedID.uuidString))
        XCTAssertFalse(TVParityLaunch.hasVerifiedDeviceTestProfile([current], currentUserID: UUID().uuidString))
        XCTAssertFalse(TVParityLaunch.hasVerifiedDeviceTestProfile([current], currentUserID: ""))
    }
}
#endif
