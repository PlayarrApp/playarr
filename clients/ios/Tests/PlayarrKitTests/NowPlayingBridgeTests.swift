import MediaPlayer
import XCTest
@testable import PlayarrKit

@MainActor
final class NowPlayingBridgeTests: XCTestCase {
    func testTheEntryShowsTheTitleThenTracksPositionAndPlayState() {
        let bridge = NowPlayingBridge()
        var calls: [String] = []
        bridge.begin(title: "A Film", subtitle: "2024", artworkURL: nil, headers: [:], duration: 5_400,
                     handlers: .init(play: { calls.append("play") }, pause: { calls.append("pause") }, seek: { calls.append("seek \($0)") }))
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo
        XCTAssertEqual(info?[MPMediaItemPropertyTitle] as? String, "A Film")
        XCTAssertEqual(info?[MPMediaItemPropertyArtist] as? String, "2024")
        XCTAssertEqual(info?[MPMediaItemPropertyPlaybackDuration] as? Double, 5_400)

        bridge.update(position: 120, duration: 5_400, isPlaying: true, rate: 1)
        info = MPNowPlayingInfoCenter.default().nowPlayingInfo
        XCTAssertEqual(info?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 120)
        XCTAssertEqual(info?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1)

        bridge.update(position: 121, duration: 5_400, isPlaying: false, rate: 1)
        XCTAssertEqual(MPNowPlayingInfoCenter.default().nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0)
    }

    func testEndClearsTheEntry() {
        let bridge = NowPlayingBridge()
        bridge.begin(title: "A Film", subtitle: nil, artworkURL: nil, headers: [:], duration: 60, handlers: .init(play: {}, pause: {}, seek: { _ in }))
        bridge.end()
        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
    }
}
