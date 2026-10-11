import Foundation

#if canImport(AVFoundation)
import AVFoundation
#endif
#if canImport(VideoToolbox)
import CoreMedia
import VideoToolbox
#endif

/// What this device can really decode and output, sent on every playback negotiation so the server copies what plays
/// and converts the rest (PR 802; CLIENT-NOTES in the media-caps notes). Unknown stays unconstrained: a field we cannot
/// detect is omitted, except HDR, which is sent empty alongside the bit depth so the server tone-maps.
public struct DeviceMediaCaps: Equatable, Sendable {
    /// `hdr10`, `hlg`, `dolby_vision`: what the display and the player can render.
    public var hdr: [String]
    /// Dolby Vision profiles rendered natively (5 only when it really is; the server tone-maps profile 5 otherwise).
    public var dvProfiles: [Int]
    /// 10 when hardware HEVC decode is available, else 8.
    public var maxBitDepth: Int
    public var videoProfiles: [String]
    /// 2, 6 or 8; nil when the platform cannot say.
    public var maxChannels: Int?

    public static let forceDirectVideoKey = "com.playarr.player.forceDirectVideo"
    public static let forceDirectAudioKey = "com.playarr.player.forceDirectAudio"

    public init(hdr: [String], dvProfiles: [Int], maxBitDepth: Int, videoProfiles: [String], maxChannels: Int?) {
        self.hdr = hdr
        self.dvProfiles = dvProfiles
        self.maxBitDepth = maxBitDepth
        self.videoProfiles = videoProfiles
        self.maxChannels = maxChannels
    }

    /// The capability set from what the system reports (pure, so it is testable): DV profiles are only claimed when the
    /// display renders Dolby Vision.
    public static func build(hdrModes: Set<String>, hevcHardware: Bool, outputChannels: Int?) -> DeviceMediaCaps {
        let order = ["hdr10", "hlg", "dolby_vision"]
        let hdr = order.filter { hdrModes.contains($0) }
        let channels = outputChannels.map { $0 >= 8 ? 8 : ($0 >= 6 ? 6 : 2) }
        return DeviceMediaCaps(
            hdr: hdr,
            dvProfiles: hdr.contains("dolby_vision") ? [5, 8] : [],
            maxBitDepth: hevcHardware ? 10 : 8,
            videoProfiles: hevcHardware ? ["hevc:main 10"] : [],
            maxChannels: channels
        )
    }

    /// The playback query items; the force flags are per axis and only sent when on.
    public func queryItems(forceDirectVideo: Bool, forceDirectAudio: Bool) -> [URLQueryItem] {
        var items = [
            URLQueryItem(name: "hdr", value: hdr.joined(separator: ",")),
            URLQueryItem(name: "max_bit_depth", value: String(maxBitDepth)),
        ]
        if !dvProfiles.isEmpty { items.append(URLQueryItem(name: "dv_profiles", value: dvProfiles.map(String.init).joined(separator: ","))) }
        if !videoProfiles.isEmpty { items.append(URLQueryItem(name: "video_profiles", value: videoProfiles.joined(separator: ","))) }
        if let maxChannels { items.append(URLQueryItem(name: "max_channels", value: String(maxChannels))) }
        if forceDirectVideo { items.append(URLQueryItem(name: "force_direct_video", value: "true")) }
        if forceDirectAudio { items.append(URLQueryItem(name: "force_direct_audio", value: "true")) }
        return items
    }

    /// This device, now, with the force settings stored per device in `defaults`.
    public static func currentQueryItems(defaults: UserDefaults = .standard) -> [URLQueryItem] {
        detect().queryItems(
            forceDirectVideo: defaults.bool(forKey: forceDirectVideoKey),
            forceDirectAudio: defaults.bool(forKey: forceDirectAudioKey)
        )
    }

    public static func detect() -> DeviceMediaCaps {
        var modes = Set<String>()
        var hevc = false
        var channels: Int?
        #if canImport(AVFoundation)
        // `availableHDRModes` does not exist on macOS: the Mac reports no HDR modes until it reads the display's EDR.
        #if !os(macOS)
        let available = AVPlayer.availableHDRModes
        if available.contains(.hdr10) { modes.insert("hdr10") }
        if available.contains(.hlg) { modes.insert("hlg") }
        if available.contains(.dolbyVision) { modes.insert("dolby_vision") }
        #endif
        #if os(iOS) || os(tvOS)
        channels = AVAudioSession.sharedInstance().maximumOutputNumberOfChannels
        #endif
        #endif
        #if canImport(VideoToolbox)
        hevc = VTIsHardwareDecodeSupported(kCMVideoCodecType_HEVC)
        #endif
        return build(hdrModes: modes, hevcHardware: hevc, outputChannels: channels)
    }
}

public extension APIError {
    /// 422 `unsupported_colour_format`: the server cannot convert this title's colour format for this device. Show the
    /// server's message; do not retry (nothing a retry changes).
    var isUnsupportedColourFormat: Bool {
        if case .unprocessableEntity(let body) = self { return body?.error == "unsupported_colour_format" }
        return false
    }
}
