import AVKit
import PlayarrKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
#if os(macOS)
import AppKit
#endif

struct TVPlayerView: View {
    @Environment(\.setShellChromeHidden) private var setShellChromeHidden
    let mediaFileID: UUID
    let title: String
    let apiClient: PlayarrAPIClient
    /// Work whose `/similar` results fill the end-of-playback rail.
    let suggestionsWorkID: UUID?
    @State private var viewModel: TVPlayerViewModel
    @State private var suggestions: [Work] = []
    /// Parity route: draw the chrome statically at this position over a black stage.
    let parity: (position: Double, duration: Double, menuOpen: Bool)?
    @State private var interaction = TVPlayerInteraction()
    @FocusState private var focusedControl: TVPlayerControl?
    /// The menu control the last Left/Right walked to (the live focus may have been moved by the focus engine first).
    @State private var menuCursor: TVPlayerControl?
    /// Set by the first remote move or back: the opening focus on Play is then no longer enforced.
    @State private var remoteUsed = false
    #if os(macOS)
    @State private var macBackHandlerID = UUID()
    #endif
    #if os(macOS)
    /// The Mac shows covers as a window layer, not a presentation (macOS/PlatformShims.swift).
    @Environment(\.macCoverDismiss) private var dismiss
    #else
    @Environment(\.dismiss) private var dismiss
    #endif
    @Environment(\.scenePhase) private var scenePhase

    init(
        mediaFileID: UUID,
        title: String,
        apiClient: PlayarrAPIClient,
        suggestionsWorkID: UUID? = nil,
        artworkPath: String? = nil,
        queue: [PlaybackQueueEntry] = [],
        advance: EndOfPlaybackMachine.Advance = .countdown,
        subtitle: String? = nil,
        parity: (position: Double, duration: Double, menuOpen: Bool)? = nil
    ) {
        self.parity = parity
        self.mediaFileID = mediaFileID
        self.title = title
        self.apiClient = apiClient
        self.suggestionsWorkID = suggestionsWorkID
        let model = TVPlayerViewModel(apiClient: apiClient)
        model.endOfPlayback.setQueue(queue, advance: advance)
        model.setSubtitle(subtitle)
        model.artworkPath = artworkPath
        _viewModel = State(initialValue: model)
    }

    var body: some View {
        // The player is full screen like the web's player page: the shell hides its nav and clock.
        screen
            .parityLayerScope() // the player covers the page: only its own items are visible
        .task {
            // The video surface holds the focus when the player opens (web: "video playback surface"), not whichever control the system finds first.
            // The system focuses the first focusable view it finds (the scrubber) and writes that into focusedControl, so a nil check
            // never fires: set the opening control outright, three times, as the chrome may appear after the stream is negotiated.
            #if os(macOS) && DEBUG
            NSLog("PlayarrMacTrace player open focus task started")
            #endif
            for delay in [400, 800, 1500] {
                try? await Task.sleep(for: .milliseconds(delay))
                #if os(macOS) && DEBUG
                NSLog("PlayarrMacTrace player open focus delay=%d remoteUsed=%d", delay, remoteUsed ? 1 : 0)
                #endif
                #if os(macOS)
                // The Mac's focus is the engine's: the first control to register (the scrubber) takes it, so name the surface outright.
                if !remoteUsed { MacFocusEngine.shared.focusNamed("surface"); interaction.focus = .surface }
                #else
                if !remoteUsed, focusedControl != .surface { focusedControl = .surface; interaction.focus = .surface }
                #endif
            }
        }
            .onAppear {
                setShellChromeHidden(true)
                #if os(macOS)
                // Escape runs the same Back sequence whatever has focus: once the controls hide, their disabled buttons drop
                // the focus and the view's onExitCommand would never see the second Back.
                do {
                    MacKeyboard.shared.pushBackHandler(macBackHandlerID) {
                        switch interaction.back() {
                        case .closedMenu: focusedControl = interaction.focus
                        case .hidControls: break
                        case .exit: dismiss()
                        }
                        return true
                    }
                }
                #endif
                #if DEBUG && (os(tvOS) || os(macOS))
                TVParityState.setPlayer(mediaFileID)
                #endif
            }
            .onDisappear {
                setShellChromeHidden(false)
                #if os(macOS)
                MacKeyboard.shared.popBackHandler(macBackHandlerID)
                #endif
                #if DEBUG && (os(tvOS) || os(macOS))
                TVParityState.setPlayer(nil)
                #endif
            }
    }

    @ViewBuilder
    private var screen: some View {
        if let parity {
            // Parity route: the fixture clips are Matroska and the runner cannot transcode, so the video
            // layer is the server's frame of the clip at the paused position, scaled to the stage.
            ZStack(alignment: .topLeading) {
                Color.black.parityBox("container", fill: Color.black)
                parityFrame
                // The frozen frame answers the remote as the web player does: the video holds the opening focus, Back hides the controls first.
                remoteCommands(
                    ZStack(alignment: .topLeading) {
                        playerSurface
                        chrome(
                            state: chromeState(position: parity.position, duration: parity.duration, isPlaying: false, menuOpen: parity.menuOpen),
                            controlsVisible: interaction.controlsVisible,
                            frozen: true,
                            focus: $focusedControl,
                            menuBackdrop: AnyView(parityFrame)
                        )
                    }
                )
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .ignoresSafeArea()
            .task { await viewModel.loadInfo(mediaFileID: mediaFileID) }
        } else {
            playerBody
        }
    }

    /// What the chrome shows, from the player's own state: the parity route passes its fixed position and menu state.
    private func chromeState(position: Double, duration: Double, isPlaying: Bool, menuOpen: Bool) -> TVPlayerChromeState {
        var state = TVPlayerChromeState(
            position: position,
            duration: duration,
            isPlaying: isPlaying,
            qualityLabel: viewModel.qualityLabel,
            selectedQualityID: viewModel.selectedQualityID,
            menuOpen: menuOpen
        )
        state.isMuted = viewModel.isMuted
        state.audioTracks = viewModel.audioTracks
        state.subtitleTracks = viewModel.subtitleTracks
        state.selectedAudioID = viewModel.selectedAudioID
        state.selectedSubtitleID = viewModel.selectedSubtitleID
        state.hasPrevious = viewModel.hasPrevious
        state.hasNext = viewModel.hasNext
        state.upcoming = viewModel.upcoming
        state.currentTitle = viewModel.currentTitle.isEmpty ? title : viewModel.currentTitle
        state.healthLines = viewModel.healthLines
        state.panel = interaction.panel
        return state
    }

    /// The chrome's actions, shared by playback and the parity route.
    private func chrome(state: TVPlayerChromeState, controlsVisible: Bool = true, frozen: Bool = false, focus: FocusState<TVPlayerControl?>.Binding? = nil, menuBackdrop: AnyView? = nil) -> TVPlayerChrome {
        var chrome = TVPlayerChrome(state: state, controlsVisible: controlsVisible, focus: focus, frozen: frozen, menuBackdrop: menuBackdrop)
        chrome.onClose = { dismiss() }
        chrome.onMinimise = { dismiss() } // there is no mini player: minimising leaves playback, as Back does
        chrome.onTogglePlay = { handleSelect() }
        chrome.onToggleQualityMenu = { handleSelect() }
        chrome.onOpenPanel = { title, control in
            interaction.panel = interaction.panel == nil ? title : nil
            if let control { interaction.focus = control }
            interaction.reveal()
        }
        chrome.onPrevious = { viewModel.playPrevious() }
        chrome.onNext = { viewModel.playNext() }
        chrome.onMute = { viewModel.toggleMute() }
        chrome.onSelectAudio = { viewModel.selectAudio($0) }
        chrome.onSelectSubtitle = { viewModel.selectSubtitle($0) }
        chrome.onPlayEntry = { entry in
            Task { await viewModel.play(mediaFileID: entry.mediaFileID, title: entry.title) }
        }
        chrome.onSeek = { viewModel.seek(to: $0) }
        #if os(macOS)
        chrome.onFullscreen = { NSApp.keyWindow?.toggleFullScreen(nil) }
        #endif
        return chrome
    }

    /// The server's frame of the clip at the paused position.
    private var parityFrame: some View {
        TVAuthedImage(load: {
            try await apiClient.fetchMediaThumbnail(mediaFileID: mediaFileID, positionMs: Int((parity?.position ?? 0) * 1000))
        }) { Color.black }
            .frame(width: 1920, height: 1080)
            .clipped()
            .parityBox("image") // a still of the clip: this is an image, not a playing video
    }

    /// Web: Select on the video toggles play and hands the focus to the Play button.
    private func selectSurface() {
        if interaction.controlsVisible { viewModel.togglePlay() }
        interaction.reveal()
        interaction.focus = .play
        focusedControl = .play
        #if os(macOS)
        MacFocusEngine.shared.focusNamed("play")
        #endif
    }

    /// While the controls are hidden this catches SELECT and moves to reveal them again; it is the player's opening focus.
    private var playerSurface: some View {
        Color.clear
            .ignoresSafeArea()
            .parityFocusTag("video playback surface") // inside the focusable: isFocused reaches only the descendants of the focus target
            .modifier(TVPlayerSurfaceFocus(focus: $focusedControl, activate: selectSurface))
            .accessibilityLabel("Video playback surface")
            .onTapGesture(perform: selectSurface)
    }

    /// Moves the focus after the focus engine's own move for the same press has landed, so the explicit order wins.
    private func settle(_ target: TVPlayerControl) {
        menuCursor = TVPlayerControl.menuRow.contains(target) ? target : nil
        focusedControl = target
        interaction.focus = target
        DispatchQueue.main.async { focusedControl = target; interaction.focus = target }
    }

    /// The remote's behaviour shared by playback and the parity frame.
    private func remoteCommands<Content: View>(_ content: Content) -> some View {
        content
            .onPlayPauseCommand { viewModel.togglePlay(); interaction.reveal() }
            .onExitCommand {
                remoteUsed = true
                switch interaction.back() {
                case .closedMenu: focusedControl = interaction.focus
                case .hidControls: break
                case .exit: dismiss()
                }
            }
            .onMoveCommand { direction in
                remoteUsed = true
                interaction.reveal()
                // Web: from the video, left reaches Play/Pause, right the first menu control, up the seek bar.
                if focusedControl == .surface {
                    switch direction {
                    case .left: focusedControl = .play
                    case .right: focusedControl = .audio; menuCursor = .audio
                    case .up: focusedControl = .scrubber
                    default: break
                    }
                    if let next = focusedControl { interaction.focus = next }
                    return
                }
                if let current = focusedControl, TVPlayerControl.menuRow.contains(current), direction == .left || direction == .right {
                    // The menu row walks in the web's order; the focus engine's own move would pick by geometry and may
                    // already have landed (so the cursor is the last explicit target, not the live focus).
                    let row = TVPlayerControl.menuRow
                    let from = menuCursor.flatMap { row.contains($0) ? $0 : nil } ?? current
                    guard let at = row.firstIndex(of: from) else { return }
                    let target = direction == .right ? row[min(at + 1, row.count - 1)] : (at == 0 ? .play : row[at - 1])
                    settle(target)
                    return
                }
                switch (focusedControl, direction) {
                case (.scrubber, .left):
                    viewModel.seek(by: -10)
                    interaction.seeked()
                    focusedControl = .scrubber // a seek never moves focus
                case (.scrubber, .right):
                    viewModel.seek(by: 10)
                    interaction.seeked()
                    focusedControl = .scrubber
                case (.scrubber, .down):
                    settle(.play)
                    return
                case (_, .up) where focusedControl != .scrubber:
                    focusedControl = .scrubber
                default: break
                }
                if let next = focusedControl { interaction.focus = next }
            }
            .onChange(of: focusedControl) { _, control in
                if let control { interaction.focus = control }
                #if DEBUG && os(tvOS)
                // The surface and the seek bar are bare focus targets: name them from the focus state the player owns.
                if control == .surface { TVParityState.setFocus("video playback surface", true) }
                if control == .scrubber { TVParityState.setFocus("Seek", true) }
                #endif
            }
            #if DEBUG && (os(tvOS) || os(macOS))
            .onChange(of: interaction.panel) { _, open in TVParityState.setPanel(open != nil) }
            #endif
            #if os(tvOS)
            .defaultFocus($focusedControl, .surface)
            #endif
    }

    private var playerBody: some View {
        ZStack {
            // The stage is black behind the video, as on the web.
            Color.black.ignoresSafeArea()

            // Play opens the player directly: a black stage with the normal chrome and at most a small
            // buffering spinner while the session and stream are negotiated. No interstitial page.
            switch TVPlayerStage.resolve(viewModel.state) {
            case .chrome(let videoAttached, let spinner):
                if videoAttached {
                    TVVideoSurface(player: viewModel.player)
                        .ignoresSafeArea()
                }
                remoteCommands(
                    ZStack {
                        playerSurface
                        chrome(
                            state: chromeState(position: viewModel.position, duration: viewModel.duration, isPlaying: viewModel.isPlaying, menuOpen: interaction.menuOpen),
                            controlsVisible: interaction.controlsVisible,
                            focus: $focusedControl
                        )
                    }
                )
                if spinner {
                    ProgressView().tint(.white).controlSize(.large)
                }
            case .failed(let message):
                TVErrorView(title: "Playback failed", message: message, retry: viewModel.canRetryFailure ? {
                    Task { await viewModel.play(mediaFileID: mediaFileID, title: title) }
                } : nil)
            }

            if viewModel.endOfPlayback.phase != .playing {
                TVEndOfPlaybackView(
                    controller: viewModel.endOfPlayback,
                    title: viewModel.currentTitle.isEmpty ? title : viewModel.currentTitle,
                    subtitle: viewModel.currentSubtitle,
                    suggestions: suggestions,
                    apiClient: apiClient
                )
                .transition(.opacity)
            }
        }
        .parityAnimation(.easeInOut(duration: 0.25), value: viewModel.endOfPlayback.phase)
        .task {
            // A parity run plays no stream: the audio and subtitle choices come from the server's playback info.
            if parity == nil, TVParityLaunch.isParityRun { await viewModel.loadInfo(mediaFileID: mediaFileID) }
        }
        .task {
            viewModel.onExit = { dismiss() }
            // Returning from a suggestion must not restart a finished item.
            if viewModel.state == .idle, viewModel.endOfPlayback.phase == .playing {
                await viewModel.play(mediaFileID: mediaFileID, title: title)
            }
        }
        .task(id: viewModel.endOfPlayback.phase == .playing) { @MainActor in
            guard viewModel.endOfPlayback.phase != .playing, suggestions.isEmpty, let suggestionsWorkID else { return }
            let similar = (try? await apiClient.fetchSimilarWorks(id: suggestionsWorkID, limit: 13)) ?? []
            suggestions = Array(similar.filter { $0.id != suggestionsWorkID }.prefix(12))
        }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { viewModel.didEnterBackground() }
            if phase == .active { viewModel.endOfPlayback.resumeTimer() } else { viewModel.endOfPlayback.stopTimer() }
        }
        // Hold the screen awake while the end card or countdown is up; release
        // after 60 s idle on a plain end card, and on exit.
        .task(id: viewModel.endOfPlayback.phase) { @MainActor in
            let phase = viewModel.endOfPlayback.phase
            UIApplication.shared.isIdleTimerDisabled = phase != .playing
            if phase == .endCard {
                try? await Task.sleep(for: .seconds(60))
                if !Task.isCancelled { UIApplication.shared.isIdleTimerDisabled = false }
            }
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
            viewModel.stop()
        }
    }

    /// SELECT: the scrubber and Play toggle play/pause only; Quality opens its panel.
    private func handleSelect() {
        interaction.focus = focusedControl ?? interaction.focus
        switch interaction.select() {
        case .togglePlayPause: viewModel.togglePlay()
        case .openQualityMenu: break
        case .close: dismiss()
        case nil: break
        }
    }
}

/// tvOS: a SwiftUI focus target bound to the surface. Mac: an engine target with the routes of the web's D-pad order.
private struct TVPlayerSurfaceFocus: ViewModifier {
    let focus: FocusState<TVPlayerControl?>.Binding
    let activate: () -> Void

    func body(content: Content) -> some View {
        #if os(macOS)
        content.macPlayerSurfaceTarget(activate: activate)
        #else
        // Only a target while it or nothing holds the focus: otherwise a native Right/Down from a control lands on this
        // full-screen view (web: the video is only reached by Back), undoing the explicit move.
        content.focusable(focus.wrappedValue == nil || focus.wrappedValue == .surface).focused(focus, equals: .surface)
        #endif
    }
}
