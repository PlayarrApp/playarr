import Foundation
import MediaPlayer

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

/// Publishes the playing title to the system's now-playing surface (lock screen and Control Center on iOS and iPadOS, the
/// Siri Remote and Apple TV Control Center on tvOS, Now Playing in the menu bar on macOS) and routes its Play, Pause, Seek
/// and skip buttons back to the player. Title, optional subtitle and artwork, position, duration and rate.
@MainActor
final class NowPlayingBridge {
    struct Handlers {
        var play: () -> Void
        var pause: () -> Void
        var seek: (Double) -> Void
    }

    private var targets: [(MPRemoteCommand, Any)] = []
    private var info: [String: Any] = [:]
    private var artworkTask: Task<Void, Never>?
    private var handlers: Handlers?
    private var isPlaying = false
    private var position = 0.0

    func begin(title: String, subtitle: String?, artworkURL: URL?, headers: [String: String], duration: Double, handlers: Handlers) {
        end()
        self.handlers = handlers
        info = [
            MPMediaItemPropertyTitle: title,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
            MPNowPlayingInfoPropertyDefaultPlaybackRate: 1.0,
        ]
        if let subtitle { info[MPMediaItemPropertyArtist] = subtitle }
        if duration.isFinite, duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        publish()
        installCommands()
        if let artworkURL { loadArtwork(artworkURL, headers: headers) }
    }

    func update(position: Double, duration: Double, isPlaying: Bool, rate: Float) {
        guard handlers != nil else { return }
        self.position = position
        self.isPlaying = isPlaying
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? Double(rate) : 0.0
        if duration.isFinite, duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }
        publish()
    }

    func end() {
        artworkTask?.cancel()
        artworkTask = nil
        let center = MPRemoteCommandCenter.shared()
        for (command, token) in targets { command.removeTarget(token) }
        targets = []
        for command in [center.playCommand, center.pauseCommand, center.togglePlayPauseCommand, center.changePlaybackPositionCommand,
                        center.skipForwardCommand, center.skipBackwardCommand] { command.isEnabled = false }
        handlers = nil
        info = [:]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    private func publish() {
        let center = MPNowPlayingInfoCenter.default()
        center.nowPlayingInfo = info
        center.playbackState = isPlaying ? .playing : .paused
    }

    private func installCommands() {
        let center = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, _ body: @escaping @MainActor (MPRemoteCommandEvent) -> Void) {
            command.isEnabled = true
            let token = command.addTarget { event in
                DispatchQueue.main.async { MainActor.assumeIsolated { body(event) } }
                return .success
            }
            targets.append((command, token))
        }
        add(center.playCommand) { [weak self] _ in self?.handlers?.play() }
        add(center.pauseCommand) { [weak self] _ in self?.handlers?.pause() }
        add(center.togglePlayPauseCommand) { [weak self] _ in
            guard let self else { return }
            if self.isPlaying { self.handlers?.pause() } else { self.handlers?.play() }
        }
        center.skipForwardCommand.preferredIntervals = [15]
        center.skipBackwardCommand.preferredIntervals = [15]
        add(center.skipForwardCommand) { [weak self] _ in guard let self else { return }; self.handlers?.seek(self.position + 15) }
        add(center.skipBackwardCommand) { [weak self] _ in guard let self else { return }; self.handlers?.seek(max(0, self.position - 15)) }
        add(center.changePlaybackPositionCommand) { [weak self] event in
            if let event = event as? MPChangePlaybackPositionCommandEvent { self?.handlers?.seek(event.positionTime) }
        }
    }

    private func loadArtwork(_ url: URL, headers: [String: String]) {
        artworkTask = Task { [weak self] in
            var request = URLRequest(url: url)
            for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
            guard let (data, _) = try? await URLSession.shared.data(for: request), !Task.isCancelled else { return }
            #if canImport(UIKit)
            guard let image = UIImage(data: data) else { return }
            #else
            guard let image = NSImage(data: data) else { return }
            #endif
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            await MainActor.run {
                guard let self, self.handlers != nil else { return }
                self.info[MPMediaItemPropertyArtwork] = artwork
                self.publish()
            }
        }
    }
}
