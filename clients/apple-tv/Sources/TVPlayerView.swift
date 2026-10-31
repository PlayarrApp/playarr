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
            .onAppear {
                setShellChromeHidden(true)
                #if os(macOS)
                // Escape runs the same Back sequence whatever has focus: once the controls hide, their disabled buttons drop
                // the focus and the view's onExitCommand would never see the second Back.
                if parity == nil {
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
                chrome(
                    state: chromeState(position: parity.position, duration: parity.duration, isPlaying: false, menuOpen: parity.menuOpen),
                    frozen: true,
                    menuBackdrop: AnyView(parityFrame)
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
        return state
    }

    /// The chrome's actions, shared by playback and the parity route.
    private func chrome(state: TVPlayerChromeState, controlsVisible: Bool = true, frozen: Bool = false, focus: FocusState<TVPlayerControl?>.Binding? = nil, menuBackdrop: AnyView? = nil) -> TVPlayerChrome {
        var chrome = TVPlayerChrome(state: state, controlsVisible: controlsVisible, focus: focus, frozen: frozen, menuBackdrop: menuBackdrop)
        chrome.onClose = { dismiss() }
        chrome.onMinimise = { dismiss() } // there is no mini player: minimising leaves playback, as Back does
        chrome.onTogglePlay = { handleSelect() }
        chrome.onToggleQualityMenu = { handleSelect() }
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
                ZStack {
                // While the controls are hidden this catches SELECT and moves to reveal them again.
                Color.clear
                    .ignoresSafeArea()
                    .modifier(TVPlayerSurfaceFocus(focus: $focusedControl))
                    .accessibilityLabel("Video playback surface")
                    .parityFocusTag("video playback surface")
                    .onTapGesture {
                        interaction.reveal()
                        focusedControl = interaction.focus
                    }
                chrome(
                    state: chromeState(position: viewModel.position, duration: viewModel.duration, isPlaying: viewModel.isPlaying, menuOpen: interaction.menuOpen),
                    controlsVisible: interaction.controlsVisible,
                    focus: $focusedControl
                )
                }
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
                        case .right: focusedControl = .subtitles
                        case .up: focusedControl = .scrubber
                        default: break
                        }
                        if let next = focusedControl { interaction.focus = next }
                        return
                    }
                    switch direction {
                    case .left:
                        viewModel.seek(by: -10)
                        interaction.seeked()
                    case .right:
                        viewModel.seek(by: 10)
                        interaction.seeked()
                    default: break
                    }
                    // A seek never moves focus: keep it on the control the user left it on.
                    if focusedControl != interaction.focus { focusedControl = interaction.focus }
                }
                .onChange(of: focusedControl) { _, control in
                    if let control { interaction.focus = control }
                }
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
        .animation(.easeInOut(duration: 0.25), value: viewModel.endOfPlayback.phase)
        .task {
            // The video surface holds the focus when the player opens (web: "video playback surface"), not whichever control the system finds first.
            // The system focuses the first focusable view it finds (the scrubber) and writes that into focusedControl, so a nil check
            // never fires: set the opening control outright, three times, as the chrome may appear after the stream is negotiated.
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

    func body(content: Content) -> some View {
        #if os(macOS)
        content.macPlayerSurfaceTarget()
        #else
        content.focusable().focused(focus, equals: .surface)
        #endif
    }
}
