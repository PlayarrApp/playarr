import Foundation
import PlayarrKit
import XCTest

final class PlaybackSessionRecoveryTests: XCTestCase {
    func testOnlyAStartedOnDemandHlsSessionIsRecoveredALimitedNumberOfTimes() {
        XCTAssertTrue(PlaybackSessionRecovery.shouldRecover(mode: .hls, isLocalFile: false, hasStarted: true, attemptsSoFar: 0))
        XCTAssertTrue(PlaybackSessionRecovery.shouldRecover(
            mode: .hls, isLocalFile: false, hasStarted: true, attemptsSoFar: PlaybackSessionRecovery.maxAttempts - 1))
        XCTAssertFalse(PlaybackSessionRecovery.shouldRecover(
            mode: .hls, isLocalFile: false, hasStarted: true, attemptsSoFar: PlaybackSessionRecovery.maxAttempts))
        XCTAssertFalse(PlaybackSessionRecovery.shouldRecover(mode: .direct, isLocalFile: false, hasStarted: true, attemptsSoFar: 0))
        XCTAssertFalse(PlaybackSessionRecovery.shouldRecover(mode: nil, isLocalFile: false, hasStarted: true, attemptsSoFar: 0))
        XCTAssertFalse(PlaybackSessionRecovery.shouldRecover(mode: .hls, isLocalFile: true, hasStarted: true, attemptsSoFar: 0))
        XCTAssertFalse(PlaybackSessionRecovery.shouldRecover(mode: .hls, isLocalFile: false, hasStarted: false, attemptsSoFar: 0))
    }

    func testAPausedPlayerStaysPaused() {
        XCTAssertFalse(PlaybackSessionRecovery.startsPlaying(lastState: .paused))
        XCTAssertTrue(PlaybackSessionRecovery.startsPlaying(lastState: .playing))
        XCTAssertTrue(PlaybackSessionRecovery.startsPlaying(lastState: .buffering))
    }

    func testBackOffGrowsThenHolds() {
        XCTAssertEqual(PlaybackSessionRecovery.delay(attemptsSoFar: 0), .milliseconds(1_500))
        XCTAssertEqual(PlaybackSessionRecovery.delay(attemptsSoFar: 1), .milliseconds(3_000))
        XCTAssertEqual(PlaybackSessionRecovery.delay(attemptsSoFar: 2), .milliseconds(6_000))
        XCTAssertEqual(PlaybackSessionRecovery.delay(attemptsSoFar: 9), .milliseconds(6_000))
    }
}
