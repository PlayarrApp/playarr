import AVKit
import PlayarrKit
import SwiftUI
import UIKit

struct PlayerView: View {
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    let mediaFileID: UUID?
    let title: String
    /// `true` for `DownloadsView`'s completed-download row -- a sandboxed
    /// `file://` URL is unreachable from a real Chromecast device, so the
    /// cast affordance is hidden rather than left to silently fail. Also
    /// backstopped by `viewModel.isPlayingLocalFile`, which catches the
    /// same case if it's ever reached some other way.
    let isOfflinePlayback: Bool

    /// Work whose `/similar` results fill the end-of-playback suggestions
    /// rail; `nil` hides the rail (for example offline downloads).
    let suggestionsWorkID: UUID?
    /// Items that follow this one (next episodes, album tracks).
    let queue: [PlaybackQueueEntry]
    /// `.immediate` for music queues (tracks chain with no card).
    let advance: EndOfPlaybackMachine.Advance
    /// Series and `S{n}:E{m}` line for the first item.
    let subtitle: String?

    private enum PlayerMenu: Equatable { case quality, audio, subtitles, queue, info }

    @State private var viewModel: PlayerViewModel?
    @State private var suggestions: [Work] = []
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var controlsVisible = true
    @State private var activeMenu: PlayerMenu?
    /// Bumped by every interaction so the idle timer restarts.
    @State private var activity = 0
    @State private var scrubTime: Double?
    @State private var buffered: [ClosedRange<Double>] = []
    @State private var isMuted = false
    @State private var fillsScreen = false
    private let castCoordinator = CastSessionCoordinator.shared

    init(
        apiClient: PlayarrAPIClient,
        downloadRepository: DownloadRepository,
        initialMediaFileID: String = "",
        initialTitle: String = "",
        isOfflinePlayback: Bool = false,
        suggestionsWorkID: UUID? = nil,
        queue: [PlaybackQueueEntry] = [],
        advance: EndOfPlaybackMachine.Advance = .countdown,
        subtitle: String? = nil
    ) {
        self.suggestionsWorkID = suggestionsWorkID
        self.queue = queue
        self.advance = advance
        self.subtitle = subtitle
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.mediaFileID = UUID(uuidString: initialMediaFileID)
        self.title = initialTitle
        self.isOfflinePlayback = isOfflinePlayback
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                Color.black
                content(size: proxy.size)
                if let viewModel, viewModel.endOfPlayback.phase != .playing {
                    EndOfPlaybackView(
                        controller: viewModel.endOfPlayback,
                        title: viewModel.currentTitle.isEmpty ? title : viewModel.currentTitle,
                        subtitle: viewModel.currentSubtitle,
                        suggestions: suggestions,
                        apiClient: apiClient,
                        downloadRepository: downloadRepository
                    )
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .transition(.opacity)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .ignoresSafeArea()
        .background(Color.black.ignoresSafeArea())
        .animation(.easeInOut(duration: 0.25), value: viewModel?.endOfPlayback.phase)
        .toolbar(.hidden, for: .navigationBar)
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .playarrChromeHidden()
        // The player is always dark, whatever the app theme.
        .environment(\.colorScheme, .dark)
        .task {
            if viewModel == nil {
                let model = PlayerViewModel(engine: AVPlayerEngine(), apiClient: apiClient, downloadRepository: downloadRepository, castCoordinator: castCoordinator)
                model.setQueue(queue, advance: advance, subtitle: subtitle)
                model.onExit = { dismiss() }
                viewModel = model
            }
            // Returning from a suggestion's detail page must not restart a
            // finished item behind the end card.
            if case .idle = viewModel?.loadState, viewModel?.endOfPlayback.phase == .playing { startPlayback() }
        }
        .task(id: viewModel?.endOfPlayback.phase == .playing) { @MainActor in
            guard viewModel?.endOfPlayback.phase != .playing, suggestions.isEmpty, let suggestionsWorkID else { return }
            let similar = (try? await apiClient.fetchSimilarWorks(id: suggestionsWorkID, limit: 13)) ?? []
            suggestions = Array(similar.filter { $0.id != suggestionsWorkID }.prefix(12))
        }
        // Countdown pauses (does not reset) while the app is backgrounded.
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { viewModel?.didEnterBackground() }
            guard let controller = viewModel?.endOfPlayback else { return }
            if phase == .active { controller.resumeTimer() } else { controller.stopTimer() }
        }
        // Keep the screen awake while the end card or countdown is up so the
        // countdown is not cut by the screensaver; released after 60 s idle
        // on a plain end card, and on exit.
        .task(id: viewModel?.endOfPlayback.phase) { @MainActor in
            let phase = viewModel?.endOfPlayback.phase ?? .playing
            UIApplication.shared.isIdleTimerDisabled = phase != .playing
            if phase == .endCard {
                try? await Task.sleep(for: .seconds(60))
                if !Task.isCancelled { UIApplication.shared.isIdleTimerDisabled = false }
            }
        }
        // Buffered ranges for the seek track.
        .task(id: viewModel?.loadState) { @MainActor in
            guard case .playing = viewModel?.loadState else { return }
            while !Task.isCancelled {
                buffered = (viewModel?.avPlayer?.currentItem?.loadedTimeRanges ?? []).compactMap { value in
                    let range = value.timeRangeValue
                    let start = CMTimeGetSeconds(range.start), length = CMTimeGetSeconds(range.duration)
                    guard start.isFinite, length.isFinite, length > 0 else { return nil }
                    return start...(start + length)
                }
                isMuted = viewModel?.avPlayer?.isMuted ?? false
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        // Controls fade after a few seconds of playing with no interaction.
        .task(id: activity) { @MainActor in
            guard controlsVisible else { return }
            try? await Task.sleep(for: .seconds(3.5))
            guard !Task.isCancelled, viewModel?.engineState == .playing, activeMenu == nil else { return }
            withAnimation(.easeInOut(duration: 0.24)) { controlsVisible = false }
        }
        #if DEBUG
        .task(id: ParityLaunch.playFile) { @MainActor in
            // Suite playback cases: publish the engine state and position for the simulator driver.
            guard ParityLaunch.playFile != nil else { return }
            while !Task.isCancelled {
                if let viewModel {
                    var playback: [String: Any] = ["position": viewModel.currentTime]
                    switch (viewModel.loadState, viewModel.engineState) {
                    case (.failed(let message), _), (_, .failed(let message)): playback["state"] = "failed"; playback["detail"] = message
                    case (_, .playing): playback["state"] = "playing"
                    default: playback["state"] = "loading"
                    }
                    ParityLaunch.record("playback", playback)
                }
                try? await Task.sleep(for: .milliseconds(500))
            }
        }
        .task(id: viewModel?.loadState) { @MainActor in
            guard ParityLaunch.isPlayerRoute, let viewModel, case .playing = viewModel.loadState else { return }
            // Parity capture: the fixture clip paused at 2.0 s, controls up.
            // The engine state reaches the view model asynchronously: wait for
            // playing, pause, then seek so the frame stays at exactly 2.0 s.
            for _ in 0..<100 where viewModel.engineState != .playing {
                try? await Task.sleep(for: .milliseconds(100))
            }
            if viewModel.engineState == .playing { viewModel.togglePlayPause() }
            await viewModel.seek(to: 2.0)
            controlsVisible = true
            activeMenu = ParityLaunch.screen == "player-quality" ? .quality : nil
        }
        #endif
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            viewModel?.viewDidDisappear()
        }
    }

    private var showsCastAffordance: Bool {
        CastSessionCoordinator.isConfigured && !isOfflinePlayback && viewModel?.isPlayingLocalFile != true
    }

    private func reveal() {
        activity += 1
        if !controlsVisible { withAnimation(.easeInOut(duration: 0.24)) { controlsVisible = true } }
    }

    // MARK: - Layers

    @ViewBuilder
    private func content(size: CGSize) -> some View {
        // Play opens the player directly: a black stage with at most the small buffering spinner.
        switch PlayerStagePhase.resolve(viewModel?.loadState) {
        case .stage:
            ProgressView().tint(.white).controlSize(.large)
                .frame(width: size.width, height: size.height)
            topButtons(size: size)
        case .failed(let message):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.largeTitle)
                    .foregroundStyle(PlayarrStyle.pink)
                Text("Playback failed").font(.title2.bold())
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.65))
                    .multilineTextAlignment(.center)
                if mediaFileID != nil {
                    Button("Try again") { startPlayback() }
                        .buttonStyle(PlayarrPrimaryButtonStyle())
                }
            }
            .foregroundStyle(.white)
            .padding(30)
            .frame(width: size.width, height: size.height)
            topButtons(size: size)
        case .playing:
            if let viewModel {
                if castCoordinator.isCasting {
                    nowCastingCard.frame(width: size.width, height: size.height)
                } else {
                    PlayerLayerView(player: viewModel.avPlayer, fillsScreen: fillsScreen)
                        .frame(width: size.width, height: size.height)
                }
                // A tap on the video only reveals the controls; it never pauses.
                Color.clear
                    .frame(width: size.width, height: size.height)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        activeMenu = nil
                        reveal()
                    }
                scrim(size: size)
                controls(viewModel, size: size)
                    .opacity(controlsVisible ? 1 : 0)
                    .offset(y: controlsVisible ? 0 : 12)
                    .allowsHitTesting(controlsVisible)
                topButtons(size: size)
                    .opacity(controlsVisible ? 1 : 0)
                    .offset(y: controlsVisible ? 0 : -10)
                    .allowsHitTesting(controlsVisible)
                if let menu = activeMenu, controlsVisible {
                    menuPanel(menu, viewModel, size: size)
                }
            }
        }
    }

    private func scrim(size: CGSize) -> some View {
        LinearGradient(colors: [.black.opacity(0.92), .clear], startPoint: .bottom, endPoint: .top)
            .frame(width: size.width, height: size.height * 0.48)
            .frame(width: size.width, height: size.height, alignment: .bottom)
            .opacity(controlsVisible ? 1 : 0)
            .allowsHitTesting(false)
    }

    private var topInset: CGFloat { WM.topInset }

    private var bottomInset: CGFloat {
        #if DEBUG
        if ParityLaunch.zeroInsets { return 14 }
        #endif
        return max(14, WM.safeArea.bottom)
    }

    /// Tablet widths use the web's wide player: a labelled Minimise pill beside the close button, both inset from the top right.
    private func isTablet(_ size: CGSize) -> Bool { !PlayarrLayout.isPhone(size) }

    private func topButtons(size: CGSize) -> some View {
        if isTablet(size) {
            let s = size.width / 1366
            return AnyView(ZStack(alignment: .topTrailing) {
                HStack(spacing: 10 * s) {
                    Button { dismiss() } label: {
                        HStack(spacing: 9 * s) {
                            PlayerGlyphView(glyph: .minimise, size: 17 * s)
                            WMText("Minimise", 11 * s + 2, 600, color: .white, lh: 16)
                        }
                        .padding(.horizontal, 18 * s).frame(height: 48 * s)
                        .background(Color(red: 12 / 255, green: 10 / 255, blue: 11 / 255).opacity(0.58), in: Capsule())
                        .overlay(Capsule().strokeBorder(.white.opacity(0.28), lineWidth: 1))
                    }
                    .buttonStyle(.plain).accessibilityLabel("Minimise")
                    Button { dismiss() } label: {
                        PlayerGlyphView(glyph: .close, size: 15 * s)
                            .frame(width: 48 * s, height: 48 * s)
                            .background(Color(red: 12 / 255, green: 10 / 255, blue: 11 / 255).opacity(0.58), in: Circle())
                            .overlay(Circle().strokeBorder(.white.opacity(0.28), lineWidth: 1))
                    }
                    .buttonStyle(.plain).accessibilityLabel("Close")
                }
                .padding(.top, 36 * s).padding(.trailing, max(53 * s, WM.trailingInset))
            }
            .frame(width: size.width, height: size.height, alignment: .topTrailing))
        }
        return AnyView(phoneTopButtons(size: size))
    }

    private func phoneTopButtons(size: CGSize) -> some View {
        ZStack(alignment: .topLeading) {
            circleButton(.minimise, size: 20, label: "Minimise") { dismiss() }
                .offset(x: size.width - max(16, WM.trailingInset) - 44 - 8 - 44, y: topInset)
            circleButton(.close, size: 22, label: "Close") { dismiss() }
                .offset(x: size.width - max(16, WM.trailingInset) - 44, y: topInset)
            if showsCastAffordance {
                CastButton(tintColor: .white)
                    .frame(width: 32, height: 32)
                    .offset(x: max(16, WM.leadingInset), y: topInset + 6)
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    private func circleButton(_ glyph: PlayerGlyph, size: CGFloat, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            PlayerGlyphView(glyph: glyph, size: size)
                .frame(width: 44, height: 44)
                .background(Color(red: 12 / 255, green: 10 / 255, blue: 11 / 255).opacity(0.58), in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.28), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    // MARK: - Controls

    private func controls(_ viewModel: PlayerViewModel, size: CGSize) -> some View {
        let queueEntries = viewModel.endOfPlayback.machine.queue
        let isPlaying = viewModel.engineState == .playing
        let shownTime = scrubTime ?? viewModel.currentTime
        let selectedQuality = viewModel.qualityOptions.first { $0.id == viewModel.selectedQualityID } ?? viewModel.qualityOptions.first
        if isTablet(size) {
            return AnyView(tabletControls(viewModel, size: size, isPlaying: isPlaying, shownTime: shownTime, selectedQuality: selectedQuality, queueEmpty: queueEntries.isEmpty))
        }
        return AnyView(VStack(spacing: 10) {
            seekTrack(viewModel, width: size.width - max(12, WM.leadingInset) - max(12, WM.trailingInset))
            VStack(spacing: 2) {
                HStack(spacing: 5.6) {
                    Text(playerTimeString(shownTime))
                    Text("/").foregroundStyle(Color(red: 119 / 255, green: 107 / 255, blue: 113 / 255))
                    Text(playerTimeString(viewModel.duration))
                }
                .font(WM.font(9.92).monospacedDigit())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 14.88)
                .padding(.bottom, 2)

                HStack(spacing: 2) {
                    iconButton(.previous, disabled: true, label: "Previous") {}
                    iconButton(isPlaying ? .pause : .play, primary: true, label: isPlaying ? "Pause" : "Play") {
                        viewModel.togglePlayPause()
                        reveal()
                    }
                    iconButton(.next, disabled: queueEntries.isEmpty, label: "Next") {
                        playQueueEntry(at: 0, viewModel)
                    }
                    iconButton(isMuted ? .volumeMuted : .volumeHigh, label: isMuted ? "Unmute" : "Mute") {
                        viewModel.avPlayer?.isMuted.toggle()
                        isMuted = viewModel.avPlayer?.isMuted ?? false
                        reveal()
                    }
                    // NB: while casting these menus still list the options negotiated
                    // locally before the handoff; the selection itself is routed to the
                    // receiver by `PlayerViewModel`. A known, scoped-out gap.
                    iconButton(.audio, disabled: viewModel.audioTracks.isEmpty, active: activeMenu == .audio, label: "Audio") {
                        toggle(.audio)
                    }
                    iconButton(.subtitles, active: activeMenu == .subtitles, label: "Subtitles") { toggle(.subtitles) }
                    iconButton(.playlist, active: activeMenu == .queue, label: "Queue") { toggle(.queue) }
                    qualityButton(selectedQuality, disabled: viewModel.qualityOptions.isEmpty)
                }
                HStack(spacing: 2) {
                    iconButton(.info, active: activeMenu == .info, label: "Playback info") { toggle(.info) }
                    ZStack {
                        iconButton(.castDevices, label: "Cast to a device") {}
                        if showsCastAffordance {
                            CastButton(tintColor: .clear)
                                .frame(width: 42, height: 42)
                                .opacity(0.02)
                        }
                    }
                    iconButton(fillsScreen ? .fullscreenExit : .fullscreenEnter, label: "Fill screen") {
                        fillsScreen.toggle()
                        reveal()
                    }
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.leading, max(12, WM.leadingInset))
        .padding(.trailing, max(12, WM.trailingInset))
        .padding(.bottom, bottomInset)
        .frame(width: size.width, height: size.height, alignment: .bottom))
    }

    /// Web wide player controls: the seek bar, then one row with previous, a ringed play button, next and the time on the
    /// left, and volume, subtitles, queue, quality, info and cast on the right (no audio or fill-screen buttons).
    private func tabletControls(
        _ viewModel: PlayerViewModel, size: CGSize, isPlaying: Bool, shownTime: Double,
        selectedQuality: PlaybackQualityOption?, queueEmpty: Bool
    ) -> some View {
        let s = size.width / 1366
        let edge = max(55 * s, WM.leadingInset)
        return VStack(spacing: 14 * s) {
            seekTrack(viewModel, width: size.width - edge - max(60 * s, WM.trailingInset))
            HStack(spacing: 0) {
                iconButton(.previous, disabled: true, label: "Previous") {}
                Button {
                    viewModel.togglePlayPause()
                    reveal()
                } label: {
                    PlayerGlyphView(glyph: isPlaying ? .pause : .play, size: 22 * s + 4)
                        .frame(width: 60 * s, height: 60 * s)
                        .background(Circle().fill(.white.opacity(0.14)))
                        .overlay(Circle().strokeBorder(.white, lineWidth: 2).padding(-3))
                }
                .buttonStyle(.plain).accessibilityLabel(isPlaying ? "Pause" : "Play")
                .padding(.horizontal, 12 * s)
                iconButton(.next, disabled: queueEmpty, label: "Next") { playQueueEntry(at: 0, viewModel) }
                HStack(spacing: 5.6) {
                    Text(playerTimeString(shownTime))
                    Text("/").foregroundStyle(Color(red: 119 / 255, green: 107 / 255, blue: 113 / 255))
                    Text(playerTimeString(viewModel.duration))
                }
                .font(WM.font(9.92 + 1).monospacedDigit()).foregroundStyle(.white)
                .padding(.leading, 28 * s)
                Spacer(minLength: 24)
                iconButton(isMuted ? .volumeMuted : .volumeHigh, label: isMuted ? "Unmute" : "Mute") {
                    viewModel.avPlayer?.isMuted.toggle()
                    isMuted = viewModel.avPlayer?.isMuted ?? false
                    reveal()
                }
                iconButton(.subtitles, active: activeMenu == .subtitles, label: "Subtitles") { toggle(.subtitles) }
                iconButton(.playlist, active: activeMenu == .queue, label: "Queue") { toggle(.queue) }
                Button { toggle(.quality) } label: {
                    HStack(spacing: 10) {
                        WMText(PlayerQuality.badge(selectedQuality), 7.68, 650, color: .white, lh: 20, ls: 0.3072)
                        WMText(PlayerQuality.displayLabel(selectedQuality), 11, 650, color: .white, lh: 16, ls: 0.1)
                    }
                    .padding(.horizontal, 12)
                }
                .buttonStyle(.plain).disabled(viewModel.qualityOptions.isEmpty)
                iconButton(.info, active: activeMenu == .info, label: "Playback info") { toggle(.info) }
                ZStack {
                    iconButton(.castDevices, label: "Cast to a device") {}
                    if showsCastAffordance { CastButton(tintColor: .clear).frame(width: 42, height: 42).opacity(0.02) }
                }
            }
        }
        .padding(.leading, edge)
        .padding(.trailing, max(60 * s, WM.trailingInset))
        .padding(.bottom, max(34 * s + 5, bottomInset)) // the web row sits about 5 pt higher
        .frame(width: size.width, height: size.height, alignment: .bottom)
    }

    private func toggle(_ menu: PlayerMenu) {
        activeMenu = activeMenu == menu ? nil : menu
        reveal()
    }

    private func iconButton(
        _ glyph: PlayerGlyph, primary: Bool = false, disabled: Bool = false, active: Bool = false,
        label: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            PlayerGlyphView(glyph: glyph, size: 20)
                .frame(width: 42, height: 42)
                .background {
                    if primary {
                        Circle().fill(.white.opacity(0.14))
                    } else if active {
                        Circle().fill(WM.pink.opacity(0.28)).scaleEffect(1.1)
                    }
                }
                .scaleEffect(active ? 1.1 : 1)
                .opacity(disabled ? 0.28 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(label)
    }

    private func qualityButton(_ option: PlaybackQualityOption?, disabled: Bool) -> some View {
        let expanded = activeMenu == .quality
        return Button { toggle(.quality) } label: {
            // The web button is 42pt wide on phones, so its label wraps and overflows evenly.
            HStack(spacing: 8.8) {
                WMText(PlayerQuality.badge(option), 7.68, 650, color: .white, lh: 20, ls: 0.3072)
                    .frame(minWidth: 22)
                VStack(spacing: 0) {
                    ForEach(Array(PlayerQuality.lines(PlayerQuality.displayLabel(option)).enumerated()), id: \.offset) { _, line in
                        WMText(line, 10.56, 650, color: .white, lh: 15.84, ls: 0.1056)
                    }
                }
            }
            .fixedSize()
            .frame(width: 42, height: 42)
            .background {
                if expanded { Circle().fill(.white.opacity(0.15)) }
            }
            .scaleEffect(expanded ? 1.08 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel("Quality \(PlayerQuality.displayLabel(option))")
    }

    private func seekTrack(_ viewModel: PlayerViewModel, width: CGFloat) -> some View {
        let duration = max(viewModel.duration, 0)
        let position = scrubTime ?? viewModel.currentTime
        let playedFraction = duration > 0 ? min(1, max(0, position / duration)) : 0
        return ZStack(alignment: .leading) {
            Rectangle().fill(.white.opacity(0.2)).frame(width: width, height: 6)
            ForEach(Array(buffered.enumerated()), id: \.offset) { _, range in
                if duration > 0 {
                    Rectangle().fill(.white.opacity(0.34))
                        .frame(width: max(0, width * (min(range.upperBound, duration) - range.lowerBound) / duration), height: 6)
                        .offset(x: width * range.lowerBound / duration)
                }
            }
            Rectangle().fill(WM.pink).frame(width: width * playedFraction, height: 6)
        }
        .overlay(alignment: .leading) {
            Circle().fill(WM.pink)
                .frame(width: 15, height: 15)
                .overlay(Circle().stroke(WM.pink.opacity(0.2), lineWidth: 4))
                .offset(x: width * playedFraction - 7.5)
                .opacity(scrubTime != nil ? 1 : 0)
        }
        .frame(width: width, height: 6)
        .contentShape(Rectangle().inset(by: -18))
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    guard duration > 0 else { return }
                    scrubTime = min(duration, max(0, value.location.x / width * duration))
                    activity += 1
                }
                .onEnded { value in
                    guard duration > 0 else { return }
                    let target = min(duration, max(0, value.location.x / width * duration))
                    scrubTime = nil
                    Task { await viewModel.seek(to: target) }
                    reveal()
                }
        )
        .accessibilityElement()
        .accessibilityLabel("Seek")
        .accessibilityValue("\(playerTimeString(position)) of \(playerTimeString(duration))")
        .accessibilityAdjustableAction { direction in
            let step: Double = direction == .increment ? 10 : -10
            Task { await viewModel.seek(to: min(duration, max(0, position + step))) }
        }
    }

    // MARK: - Menus

    @ViewBuilder
    private func menuPanel(_ menu: PlayerMenu, _ viewModel: PlayerViewModel, size: CGSize) -> some View {
        let panelWidth = min(size.width - max(12, WM.leadingInset) - max(12, WM.trailingInset), 620)
        let bottom = 96 + safeBottomForPanel
        Group {
            switch menu {
            case .quality:
                PlayerPanel(heading: "Quality") {
                    PlayerQualityMatrix(
                        options: viewModel.qualityOptions,
                        selectedID: viewModel.selectedQualityID,
                        innerWidth: panelWidth - 19.6
                    ) { id in
                        activeMenu = nil
                        Task { await viewModel.selectQuality(id) }
                    }
                }
            case .audio:
                PlayerPanel(heading: "Audio") {
                    ForEach(viewModel.audioTracks) { track in
                        PlayerOptionRow(
                            title: track.label,
                            detail: [track.language, track.codec].compactMap { $0 }.joined(separator: " · "),
                            selected: track.id == (viewModel.selectedAudioTrackID ?? viewModel.audioTracks.first?.id)
                        ) {
                            activeMenu = nil
                            Task { await viewModel.selectAudioTrack(track.id) }
                        }
                    }
                }
            case .subtitles:
                PlayerPanel(heading: "Subtitles") {
                    PlayerOptionRow(title: "Off", detail: "No subtitles", selected: viewModel.selectedSubtitleTrackID == nil) {
                        activeMenu = nil
                        Task { await viewModel.selectSubtitleTrack(nil) }
                    }
                    ForEach(viewModel.subtitleTracks) { track in
                        PlayerOptionRow(title: track.label, detail: track.language, selected: track.id == viewModel.selectedSubtitleTrackID) {
                            activeMenu = nil
                            Task { await viewModel.selectSubtitleTrack(track.id) }
                        }
                    }
                }
            case .queue:
                PlayerPanel(heading: "Queue") {
                    PlayerOptionRow(
                        title: viewModel.currentTitle.isEmpty ? (title.isEmpty ? "Now playing" : title) : viewModel.currentTitle,
                        detail: viewModel.currentSubtitle ?? "Now playing",
                        selected: true
                    ) { activeMenu = nil }
                    ForEach(Array(viewModel.endOfPlayback.machine.queue.enumerated()), id: \.element.id) { index, entry in
                        PlayerOptionRow(title: entry.title, detail: entry.subtitle, selected: false) {
                            activeMenu = nil
                            playQueueEntry(at: index, viewModel)
                        }
                    }
                }
            case .info:
                PlayerPanel(heading: "Playback") {
                    if let mode = viewModel.playbackMode {
                        PlayerOptionRow(
                            title: mode == .direct ? "Direct play" : "Adaptive stream",
                            detail: PlayerQuality.displayLabel(viewModel.qualityOptions.first { $0.id == viewModel.selectedQualityID }),
                            selected: false
                        ) {}
                    }
                    ForEach(viewModel.chapters) { chapter in
                        let start = Double(chapter.startMS) / 1_000
                        PlayerOptionRow(title: chapter.title ?? playerTimeString(start), detail: playerTimeString(start), selected: false) {
                            activeMenu = nil
                            Task { await viewModel.seek(to: start) }
                        }
                    }
                }
            }
        }
        .frame(width: panelWidth)
        .frame(maxHeight: size.height * 0.58 + 40, alignment: .bottom)
        .padding(.bottom, bottom)
        .frame(width: size.width, height: size.height, alignment: .bottom)
        .transition(.opacity)
    }

    private var safeBottomForPanel: CGFloat {
        #if DEBUG
        if ParityLaunch.zeroInsets { return 0 }
        #endif
        return WM.safeArea.bottom
    }

    /// Starts `queue[index]`; the entries before it are dropped from the queue.
    private func playQueueEntry(at index: Int, _ viewModel: PlayerViewModel) {
        let entries = viewModel.endOfPlayback.machine.queue
        guard entries.indices.contains(index) else { return }
        let entry = entries[index]
        viewModel.setQueue(Array(entries.dropFirst(index + 1)), advance: advance, subtitle: entry.subtitle)
        Task { await viewModel.play(mediaFileID: entry.mediaFileID, title: entry.title) }
        reveal()
    }

    private var nowCastingCard: some View {
        VStack(spacing: 18) {
            Image(systemName: "tv.badge.wifi")
                .font(.system(size: 54, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text("Now casting")
                .font(.custom("Avenir Next", fixedSize: 13).weight(.bold))
                .foregroundStyle(.white.opacity(0.6))
                .textCase(.uppercase)
            Text(title.isEmpty ? "Playarr" : title)
                .font(.title2.bold())
                .multilineTextAlignment(.center)
            if case .connected(let deviceName) = castCoordinator.connectionState {
                Text("Playing on \(deviceName)")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.65))
            }
            Button("Stop casting") {
                castCoordinator.endSession(reason: .userStopped)
            }
            .buttonStyle(.bordered)
            .tint(.white)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.white)
    }

    private func startPlayback() {
        guard let mediaFileID, let viewModel else { return }
        Task { await viewModel.play(mediaFileID: mediaFileID, title: title) }
    }
}

/// What the player stage shows for a load state. There is no interstitial: every
/// state before playback is the black stage (with the buffering spinner).
enum PlayerStagePhase: Equatable {
    case stage
    case failed(String)
    case playing

    static func resolve(_ loadState: PlayerViewModel.LoadState?) -> PlayerStagePhase {
        switch loadState {
        case nil, .idle?, .loadingPlaybackInfo?: return .stage
        case .failed(let message)?: return .failed(message)
        case .playing?: return .playing
        }
    }

    /// The controls card rises from the bottom edge and recedes downward (web: 240 ms ease).
    static let controlsTransition: AnyTransition = .move(edge: .bottom).combined(with: .opacity)
    static let controlsAnimation: Animation = .timingCurve(0.25, 0.1, 0.25, 1, duration: 0.24)
}
