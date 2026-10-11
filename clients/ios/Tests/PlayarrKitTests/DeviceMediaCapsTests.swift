import XCTest
@testable import PlayarrKit

final class DeviceMediaCapsTests: XCTestCase {
    private func query(_ items: [URLQueryItem]) -> [String: String] {
        Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
    }

    func testAnHDRDisplayReportsItsModesAndDolbyVisionProfiles() {
        let caps = DeviceMediaCaps.build(hdrModes: ["hdr10", "hlg", "dolby_vision"], hevcHardware: true, outputChannels: 8)
        let q = query(caps.queryItems(forceDirectVideo: false, forceDirectAudio: false))
        XCTAssertEqual(q["hdr"], "hdr10,hlg,dolby_vision")
        XCTAssertEqual(q["dv_profiles"], "5,8")
        XCTAssertEqual(q["max_bit_depth"], "10")
        XCTAssertEqual(q["video_profiles"], "hevc:main 10")
        XCTAssertEqual(q["max_channels"], "8")
    }

    func testAnSDRDisplaySendsEmptyHDRWithTheBitDepthAndNoDolbyVisionProfiles() {
        let caps = DeviceMediaCaps.build(hdrModes: [], hevcHardware: false, outputChannels: 2)
        let q = query(caps.queryItems(forceDirectVideo: false, forceDirectAudio: false))
        XCTAssertEqual(q["hdr"], "")
        XCTAssertEqual(q["max_bit_depth"], "8")
        XCTAssertNil(q["dv_profiles"])
        XCTAssertNil(q["video_profiles"])
    }

    func testProfile5IsOnlyListedWhenDolbyVisionRenders() {
        XCTAssertEqual(DeviceMediaCaps.build(hdrModes: ["hdr10"], hevcHardware: true, outputChannels: nil).dvProfiles, [])
        XCTAssertEqual(DeviceMediaCaps.build(hdrModes: ["dolby_vision"], hevcHardware: true, outputChannels: nil).dvProfiles, [5, 8])
    }

    func testUnknownChannelsAreOmittedAndCountsSnapToTwoSixOrEight() {
        let none = DeviceMediaCaps.build(hdrModes: [], hevcHardware: true, outputChannels: nil)
        XCTAssertNil(query(none.queryItems(forceDirectVideo: false, forceDirectAudio: false))["max_channels"])
        XCTAssertEqual(DeviceMediaCaps.build(hdrModes: [], hevcHardware: true, outputChannels: 6).maxChannels, 6)
        XCTAssertEqual(DeviceMediaCaps.build(hdrModes: [], hevcHardware: true, outputChannels: 10).maxChannels, 8)
        XCTAssertEqual(DeviceMediaCaps.build(hdrModes: [], hevcHardware: true, outputChannels: 4).maxChannels, 2)
    }

    func testTheForceFlagsAreSentOnlyWhenOnAndOnePerAxis() {
        let caps = DeviceMediaCaps.build(hdrModes: [], hevcHardware: true, outputChannels: 2)
        let off = query(caps.queryItems(forceDirectVideo: false, forceDirectAudio: false))
        XCTAssertNil(off["force_direct_video"]); XCTAssertNil(off["force_direct_audio"])
        let video = query(caps.queryItems(forceDirectVideo: true, forceDirectAudio: false))
        XCTAssertEqual(video["force_direct_video"], "true"); XCTAssertNil(video["force_direct_audio"])
        let audio = query(caps.queryItems(forceDirectVideo: false, forceDirectAudio: true))
        XCTAssertNil(audio["force_direct_video"]); XCTAssertEqual(audio["force_direct_audio"], "true")
    }

    func testTheForceSwitchesDefaultOffInDefaults() {
        let defaults = UserDefaults(suiteName: "device-caps-tests")!
        defaults.removePersistentDomain(forName: "device-caps-tests")
        XCTAssertFalse(defaults.bool(forKey: DeviceMediaCaps.forceDirectVideoKey))
        XCTAssertFalse(defaults.bool(forKey: DeviceMediaCaps.forceDirectAudioKey))
        XCTAssertNil(query(DeviceMediaCaps.currentQueryItems(defaults: defaults))["force_direct_video"])
        defaults.set(true, forKey: DeviceMediaCaps.forceDirectVideoKey)
        XCTAssertEqual(query(DeviceMediaCaps.currentQueryItems(defaults: defaults))["force_direct_video"], "true")
    }

    func testTheUnsupportedColourFormatRefusalShowsTheServerMessageAndIsNotRetryable() {
        let body = APIErrorBody(error: "unsupported_colour_format", message: "This title's colour format can't be converted for this device.")
        let refusal = APIError.unprocessableEntity(body)
        XCTAssertTrue(refusal.isUnsupportedColourFormat)
        XCTAssertEqual(refusal.displayMessage, "This title's colour format can't be converted for this device.")
        XCTAssertFalse(APIError.unprocessableEntity(APIErrorBody(error: "other", message: "x")).isUnsupportedColourFormat)
        XCTAssertFalse(APIError.serviceUnavailable(nil).isUnsupportedColourFormat)
    }
}
