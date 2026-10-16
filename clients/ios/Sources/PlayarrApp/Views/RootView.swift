import Observation
import PlayarrKit
import SwiftUI
import UIKit

private struct PlayarrChromeHiddenKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

enum ParityScreenLoad: String {
    case loading
    case ready
    case failed
}

struct ParityScreenReadinessKey: PreferenceKey {
    static let defaultValue: ParityScreenLoad? = nil
    static func reduce(value: inout ParityScreenLoad?, nextValue: () -> ParityScreenLoad?) {
        guard let next = nextValue() else { return }
        switch (value, next) {
        case (.some(.failed), _), (_, .failed): value = .failed
        case (.some(.loading), _), (_, .loading): value = .loading
        default: value = .ready
        }
    }
}

@MainActor
@Observable
final class VisibleWorkDetailRoutes {
    private(set) var workKinds: [UUID: WorkKind] = [:]
    private(set) var activationOrder: [UUID] = []

    var activeKind: WorkKind? {
        activationOrder.reversed().compactMap { workKinds[$0] }.first
    }

    func activate(id: UUID, kind: WorkKind) {
        workKinds[id] = kind
        activationOrder.removeAll { $0 == id }
        activationOrder.append(id)
    }

    func deactivate(id: UUID) {
        workKinds[id] = nil
        activationOrder.removeAll { $0 == id }
    }
}

extension View {
    func playarrChromeHidden(_ hidden: Bool = true) -> some View {
        preference(key: PlayarrChromeHiddenKey.self, value: hidden)
    }

    func parityScreenLoad(_ state: ParityScreenLoad?) -> some View {
        #if DEBUG
        preference(key: ParityScreenReadinessKey.self, value: ParityLaunch.isActive ? state : nil)
        #else
        self
        #endif
    }
}

struct RootView: View {
    let environment: AppEnvironment
    @State private var updateViewModel: UpdateViewModel
    #if DEBUG
    @State private var parityIdentityVerified = false
    #endif
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("com.playarr.ios.appearance") private var appearance = "system"

    init(environment: AppEnvironment) {
        self.environment = environment
        #if DEBUG
        if ParityLaunch.isActive { ParityLaunch.resetAcceptanceState() }
        if let theme = ParityLaunch.theme { UserDefaults.standard.set(theme, forKey: "com.playarr.ios.appearance") }
        // Poster mode and artwork size, as Settings > Appearance sets them; always written so a capture never inherits the last one.
        UserDefaults.standard.set(ParityLaunch.covers ? "cover" : "thumbnail", forKey: WMArtwork.homeViewKey)
        UserDefaults.standard.set(ParityLaunch.artworkSize, forKey: WMArtwork.sizeKey)
        #endif
        _updateViewModel = State(initialValue: UpdateViewModel(apiClient: environment.apiClient))
    }

    var body: some View {
        Group {
            switch environment.sessionState {
            case .restoring:
                PlayarrLoadingView(title: "Opening Playarr…")
            case .signedOut:
                LoginView(environment: environment)
            case .signedIn:
                #if DEBUG
                if ParityLaunch.isActive && !parityIdentityVerified {
                    PlayarrLoadingView(title: "Verifying device-test account…")
                } else {
                    AuthenticatedPlayarrShell(environment: environment)
                        .id("\(environment.serverBaseURL.absoluteString)-\(environment.currentUserName ?? "viewer")")
                }
                #else
                AuthenticatedPlayarrShell(environment: environment)
                    .id("\(environment.serverBaseURL.absoluteString)-\(environment.currentUserName ?? "viewer")")
                #endif
            }
        }
        .transaction { transaction in
            #if DEBUG
            if ParityLaunch.deterministicCapture {
                transaction.disablesAnimations = true
                ParityLaunch.recordAnimationsDisabledAfterRootTransaction()
            }
            #endif
        }
        .preferredColorScheme(preferredColourScheme)
        #if DEBUG
        .statusBarHidden(ParityLaunch.zeroInsets) // the web references have no system status bar
        #endif
        .updateGate(updateViewModel)
        #if DEBUG
        .overlay(alignment: .topLeading) {
            if ParityLaunch.isActive && ParityLaunch.identityVerified {
                VStack {
                    Text("Verified profile")
                        .accessibilityIdentifier("parity.identityVerified")
                        .accessibilityValue(environment.currentUsername ?? "")
                        .font(.system(size: 1))
                        .foregroundStyle(.clear)
                }
                .frame(width: 1, height: 1)
                .accessibilityElement(children: .contain)
                .accessibilityHidden(false)
                .allowsHitTesting(false)
            }
        }
        #endif
        .task {
            #if DEBUG
            ParityLaunch.applyLandscape()
            if ParityLaunch.isActive, let server = ParityLaunch.server, let user = ParityLaunch.user {
                ParityLaunch.configureDeterministicCapture()
                if let frozenNow = ParityLaunch.frozenNow {
                    ParityLaunch.record("frozenNow", ISO8601DateFormatter().string(from: frozenNow))
                }
                do {
                    try await environment.signIn(serverURL: server, username: user, password: ParityLaunch.password ?? "")
                    let profiles = try await environment.apiClient.listProfiles()
                    let currentProfiles = profiles.filter(\.isCurrent)
                    guard currentProfiles.count == 1,
                          currentProfiles[0].username == user,
                          currentProfiles[0].id == environment.currentUserID else {
                        ParityLaunch.record("signedIn", false)
                        ParityLaunch.record("deviceTestIdentityVerified", false)
                        ParityLaunch.record("identityVerified", false)
                        ParityLaunch.record("failure", "identity-mismatch")
                        return
                    }
                    ParityLaunch.record("deviceTestIdentityVerified", true)
                    guard let expected = ParityLaunch.expectedUsername,
                          let actual = environment.currentUsername,
                          actual.caseInsensitiveCompare(expected) == .orderedSame else {
                        ParityLaunch.record("signedIn", false)
                        ParityLaunch.record("identityVerified", false)
                        ParityLaunch.record("failure", "identity-mismatch")
                        return
                    }
                    if ParityLaunch.isPlayerRoute {
                        guard let candidateFile = ParityLaunch.playFile else {
                            ParityLaunch.record("failure", "direct-play-fixture-missing")
                            return
                        }
                        guard let fileID = UUID(uuidString: candidateFile) else {
                            ParityLaunch.record("failure", "direct-play-fixture-invalid")
                            return
                        }
                        let info = try await environment.apiClient.playbackInfo(
                            mediaFileID: fileID,
                            containers: ["mp4", "mov", "m4v"],
                            videoCodecs: ["h264", "hevc"],
                            audioCodecs: ["aac", "ac3", "eac3"],
                            maxBitrateBps: nil,
                            profile: nil
                        )
                        guard info.mode == .direct else {
                            ParityLaunch.record("directPlay", false)
                            ParityLaunch.record("failure", "direct-play-unavailable")
                            return
                        }
                        ParityLaunch.record("directPlay", true)
                        ParityLaunch.record("directPlayFileID", fileID.uuidString)
                    }
                    ParityLaunch.record("signedIn", true)
                    ParityLaunch.record("identityVerified", true)
                    ParityLaunch.record("authenticatedUsername", actual)
                    parityIdentityVerified = true
                    Task { await ParityDownloads.run(environment.downloadRepository) }
                } catch {
                    ParityLaunch.record("identityVerified", false)
                    ParityLaunch.record("failure", "authentication-or-readiness-failed")
                }
                return
            }
            #endif
            await environment.restoreSessionState()
            await updateViewModel.checkForUpdate()
        }
        .onChange(of: scenePhase) { _, newPhase in
            guard newPhase == .active else { return }
            Task { await updateViewModel.checkForUpdate() }
            environment.downloadRepository.sweepExpiredDownloads()
        }
        .onChange(of: environment.serverBaseURL) { _, _ in
            updateViewModel = UpdateViewModel(apiClient: environment.apiClient)
        }
    }

    private var preferredColourScheme: ColorScheme? {
        switch appearance {
        case "light": .light
        case "dark": .dark
        default: nil
        }
    }

}

enum AppDestination: Hashable {
    case downloads
    case search
    case home
    case library(WorkKind)
    case playlists
    case watchlist
    case requests
    case calendar
    case profiles
    case settings
    #if DEBUG
    case detail
    case player
    #endif

    var phoneAccessibilityIdentifier: String {
        switch self {
        case .home: "phone-tab-home"
        case .search: "phone-tab-search"
        case .library(.series): "phone-tab-series"
        case .library(.movie): "phone-tab-movies"
        default: "phone-tab-\(title.lowercased().replacingOccurrences(of: " ", with: "-"))"
        }
    }

    var title: String {
        switch self {
        case .downloads: "Downloads"
        case .search: "Search"
        case .home: "Home"
        case .library(let kind): kind.displayName
        case .playlists: "Playlists"
        case .watchlist: "Watchlist"
        case .requests: "Requests"
        case .calendar: "Calendar"
        case .profiles: "Profiles"
        case .settings: "Profile"
        #if DEBUG
        case .detail: "Title"
        case .player: "Player"
        #endif
        }
    }

    var webIcon: WMIcon {
        switch self {
        case .downloads: .downloads
        case .search: .search
        case .home: .home
        case .library(let kind):
            switch kind {
            case .movie: .movies
            case .series: .series
            case .site: .sites
            case .artist, .author: .music
            }
        case .playlists: .playlists
        case .watchlist, .requests: .watchlist
        case .calendar: .calendar
        case .profiles, .settings: .home
        #if DEBUG
        case .detail: .movies
        case .player: .movies
        #endif
        }
    }

    var icon: String {
        switch self {
        case .downloads: "arrow.down.circle"
        case .search: "magnifyingglass"
        case .home: "house"
        case .library(let kind): kind.symbolName
        case .playlists: "music.note.list"
        case .watchlist: "bookmark"
        case .requests: "tray.and.arrow.down"
        case .calendar: "calendar"
        case .profiles: "person.2"
        case .settings: "person.crop.circle"
        #if DEBUG
        case .detail: "play.rectangle"
        case .player: "play.rectangle"
        #endif
        }
    }

    func phoneNavigationSelection(visibleDetailKind: WorkKind?, debugDetailKind: WorkKind?) -> Self {
        if let visibleDetailKind { return .library(visibleDetailKind) }
        #if DEBUG
        if case .detail = self, let debugDetailKind {
            return .library(debugDetailKind)
        }
        #endif
        return self
    }

    static func debugDetailKind(for screen: String?) -> WorkKind? {
        #if DEBUG
        switch screen {
        case "detail-series": .series
        case "detail-film": .movie
        default: nil
        }
        #else
        nil
        #endif
    }
}

private struct AuthenticatedPlayarrShell: View {
    typealias Destination = AppDestination

    let environment: AppEnvironment
    @State private var selected: Destination = .home
    @State private var availableKinds: Set<WorkKind> = []
    @State private var visibleDetailRoutes = VisibleWorkDetailRoutes()
    @State private var homeViewModel: HomeViewModel
    @State private var chromeHidden = false
    @State private var household: HouseholdViewModel
    @State private var routeTransitionTitle: String?
    /// App-wide, so "Casting to <device>" stays visible while browsing
    /// anywhere in the app, not only inside `PlayerView` -- the same
    /// singleton `PlayerView` also reads for its own now-casting card.
    private let castCoordinator = CastSessionCoordinator.shared
    #if DEBUG
    @State private var demoDetailViewModel: WorkDetailViewModel
    @State private var screenContentReady = false
    #endif

    init(environment: AppEnvironment) {
        self.environment = environment
        _homeViewModel = State(initialValue: HomeViewModel(apiClient: environment.apiClient))
        _household = State(initialValue: HouseholdViewModel(apiClient: environment.apiClient))
        #if DEBUG
        _demoDetailViewModel = State(initialValue: WorkDetailViewModel(
            apiClient: environment.apiClient,
            workID: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!
        ))
        if let screen = ParityLaunch.screen {
            switch screen {
            case "music": _selected = State(initialValue: .library(.artist))
            case "filters", "actions": _selected = State(initialValue: .library(.movie))
            case "play": _selected = State(initialValue: .player)
            case "movies": _selected = State(initialValue: .library(.movie))
            case "series": _selected = State(initialValue: .library(.series))
            case "search": _selected = State(initialValue: .search)
            case "calendar": _selected = State(initialValue: .calendar)
            case "settings": _selected = State(initialValue: .settings)
            case "downloads": _selected = State(initialValue: .downloads)
            case "watchlist": _selected = State(initialValue: .watchlist)
            case "requests": _selected = State(initialValue: .requests)
            case "profiles": _selected = State(initialValue: .profiles)
            case "detail-film", "detail-series": _selected = State(initialValue: .detail)
            case "player", "player-quality": _selected = State(initialValue: .player)
            default: break
            }
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-profiles") {
            _selected = State(initialValue: .profiles)
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-library") {
            _selected = State(initialValue: .library(.movie))
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-playlists") {
            _selected = State(initialValue: .playlists)
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-settings") {
            _selected = State(initialValue: .settings)
        } else if ProcessInfo.processInfo.arguments.contains("--playarr-demo-detail") {
            _selected = State(initialValue: .detail)
        }
        #endif
    }

    var body: some View {
        ZStack {
            selectedContent
            householdOverlay
            if !chromeHidden { chrome }
            if castCoordinator.isCasting { castMiniBar }
            if let routeTransitionTitle {
                PlayarrLoadingView(title: "Opening \(routeTransitionTitle.lowercased())…")
                    .transition(.opacity)
                    .zIndex(20)
            }
        }
        .background(PlayarrStyle.background.ignoresSafeArea())
        .environment(visibleDetailRoutes)
        .onAppear {
            #if DEBUG
            screenContentReady = false
            #endif
        }
        #if DEBUG
        .overlay(alignment: .topLeading) {
            if ParityLaunch.isActive {
                VStack {
                    Text("Playback negotiation")
                        .accessibilityIdentifier("parity.directPlay")
                        .accessibilityValue(ParityLaunch.recordedBool("directPlay").map { String($0) } ?? "pending")
                        .font(.system(size: 1))
                        .foregroundStyle(.clear)
                    Text("Requested route ready")
                        .accessibilityIdentifier("parity.screenContentReady")
                        .accessibilityValue(screenContentReady ? "true" : "false")
                        .font(.system(size: 1))
                        .foregroundStyle(.clear)
                }
                .frame(width: 1, height: 1)
                .accessibilityElement(children: .contain)
                .accessibilityHidden(false)
                .allowsHitTesting(false)
            }
        }
        #endif
        .task {
            #if DEBUG
            // `detail:movie:id=<work id>` opens that exact title (the suite pins film-detail and series-detail by id).
            if let title = ParityLaunch.title, title.hasPrefix("id="), let id = UUID(uuidString: String(title.dropFirst(3))) {
                demoDetailViewModel = WorkDetailViewModel(apiClient: environment.apiClient, workID: id)
            } else if let title = ParityLaunch.title {
                let kind: WorkKind = ParityLaunch.screen == "detail-series" ? .series : .movie
                let page = try? await environment.apiClient.browseCatalog(
                    kind: kind, genre: nil, tag: nil, sort: nil, limit: 100, offset: nil
                )
                if let match = page?.items.first(where: { $0.title == title || title == "@first" }) {
                    demoDetailViewModel = WorkDetailViewModel(apiClient: environment.apiClient, workID: match.id)
                }
            }
            #endif
            availableKinds = Set((try? await environment.apiClient.listCatalogKinds()) ?? [])
        }
        #if DEBUG
        .onPreferenceChange(ParityScreenReadinessKey.self) { state in
            guard ParityLaunch.isActive, ParityLaunch.identityVerified else { return }
            switch state {
            case .ready:
                screenContentReady = true
                ParityLaunch.record("screenContentReady", true)
            case .failed:
                screenContentReady = false
                ParityLaunch.record("screenContentReady", false)
                ParityLaunch.record("failure", "requested-screen-load-failed")
            case .loading, .none:
                screenContentReady = false
                ParityLaunch.record("screenContentReady", false)
            }
        }
        #endif
        .onPreferenceChange(PlayarrChromeHiddenKey.self) { chromeHidden = $0 }
        .task { await household.poll() }
    }

    @ViewBuilder
    private var householdOverlay: some View {
        if let block = household.block, selected != .profiles {
            HouseholdBlockedView(
                block: block,
                requestState: household.requestState,
                onAskGuardian: { Task { await household.askGuardian() } },
                onSwitchProfile: { select(.profiles) }
            )
            .ignoresSafeArea(edges: .vertical)
            .webGutter()
        } else if let minutes = household.remainingMinutes {
            VStack {
                HouseholdRemainingBadge(minutes: minutes)
                Spacer()
            }
            .allowsHitTesting(false)
            .zIndex(14)
        }
    }

    @ViewBuilder
    private var selectedContent: some View {
        selectedScreen
            .environment(\.playarrGoHome, { select(.home) })
    }

    @ViewBuilder
    private var selectedScreen: some View {
        switch selected {
        case .downloads:
            NavigationStack {
                DownloadsView(repository: environment.downloadRepository, apiClient: environment.apiClient)
            }
        case .home:
            NavigationStack {
                HomeView(viewModel: homeViewModel, apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .search:
            NavigationStack {
                LibraryView(kind: nil, apiClient: environment.apiClient, downloadRepository: environment.downloadRepository, title: "Search", initialQuery: parityQuery)
            }
        case .library(let kind):
            NavigationStack {
                LibraryView(kind: kind, apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .playlists:
            NavigationStack {
                PlaylistsView(apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .watchlist:
            NavigationStack {
                WatchlistView(apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .requests:
            NavigationStack {
                RequestsView(apiClient: environment.apiClient)
            }
        case .calendar:
            NavigationStack {
                CalendarView(apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
            }
        case .profiles:
            NavigationStack {
                ProfilesView(
                    environment: environment,
                    onOpenSettings: { select(.settings) },
                    onHome: { select(.home) }
                )
            }
        case .settings:
            NavigationStack {
                SettingsView(environment: environment)
            }
        #if DEBUG
        case .detail:
            NavigationStack {
                WorkDetailView(
                    viewModel: demoDetailViewModel,
                    apiClient: environment.apiClient,
                    downloadRepository: environment.downloadRepository
                )
                .id(demoDetailViewModel.workID)
            }
        case .player:
            ParityPlayerHost(apiClient: environment.apiClient, downloadRepository: environment.downloadRepository)
        #endif
        }
    }

    private var parityQuery: String? {
        #if DEBUG
        ParityLaunch.query
        #else
        nil
        #endif
    }

    private var chrome: some View {
        GeometryReader { proxy in
            if selected == .profiles {
                EmptyView()
            } else if PlayarrLayout.isPhone(proxy.size) {
                phoneChrome(proxy: proxy)
            } else {
                stageChrome(proxy: proxy)
            }
        }
        .ignoresSafeArea(edges: UIDevice.current.userInterfaceIdiom == .phone ? .vertical : [])
        .webGutter(base: 10)
        .allowsHitTesting(true)
    }

    /// Persistent "Casting to <device>" pill, visible from anywhere in the
    /// app while a Cast session is active -- there is no shared SwiftUI
    /// toolbar in this app's chrome to hang a mini-controller off, so this
    /// sits as its own top overlay instead, alongside (not replacing)
    /// `chrome`'s own tab navigation. Offers only "Stop" here -- full
    /// transport controls live in `PlayerView`'s own now-casting card, the
    /// same way most Cast-enabled apps split a lightweight persistent
    /// affordance from the full player screen's controls.
    private var castMiniBar: some View {
        VStack {
            if case .connected(let deviceName) = castCoordinator.connectionState {
                HStack(spacing: 10) {
                    Image(systemName: "tv.badge.wifi")
                        .foregroundStyle(PlayarrStyle.pink)
                    Text("Casting to \(deviceName)")
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
                        .lineLimit(1)
                    Spacer()
                    Button("Stop") { castCoordinator.endSession(reason: .userStopped) }
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.bold))
                }
                .foregroundStyle(PlayarrStyle.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(PlayarrStyle.surfaceStrong.opacity(0.92), in: Capsule())
                .overlay { Capsule().stroke(PlayarrStyle.line.opacity(0.6), lineWidth: 1) }
                .shadow(color: PlayarrStyle.ink.opacity(0.12), radius: 14, y: 6)
                .padding(.horizontal, 14)
                .padding(.top, 8)
            }
            Spacer()
        }
        .zIndex(15)
        .allowsHitTesting(true)
    }

    /// Web mobile chrome: round profile button at the top right and the floating
    /// 58pt nav pill 10pt from each side (`app-nav` and `app-user-identity`).
    private func phoneChrome(proxy: GeometryProxy) -> some View {
        ZStack(alignment: .topLeading) {
            VStack {
                Spacer()
                ScrollView(.horizontal) {
                    HStack(spacing: 2) {
                        // The web phone nav starts with the profile avatar (there is no avatar at the top right).
                        profileButton(size: 44, avatarSize: 21, ring: false).frame(width: 44, height: 46)
                        ForEach(destinations, id: \.self) { destination in
                            Button { select(destination) } label: {
                                WMIconView(
                                    icon: destination.webIcon,
                                    color: phoneSelectedDestination == destination ? WM.shell : WM.inkSoft
                                )
                                .frame(width: 44, height: 46)
                                .background(
                                    phoneSelectedDestination == destination ? WM.ink : .clear,
                                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(destination.title)
                            .accessibilityIdentifier(destination.phoneAccessibilityIdentifier)
                            .accessibilityAddTraits(phoneSelectedDestination == destination ? .isSelected : [])
                        }
                    }
                    .padding(5)
                }
                .scrollIndicators(.hidden)
                .frame(height: 58)
                .background(
                    PlayarrStyle.surfaceStrong.opacity(0.88),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                )
                .shadow(color: Color(red: 31 / 255, green: 14 / 255, blue: 20 / 255).opacity(0.2), radius: 20, y: 14)
                .padding(.horizontal, 10)
                .padding(.bottom, WM.bottomInset)
            }
        }
        .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
    }

    private func stageChrome(proxy: GeometryProxy) -> some View {
        let navEdge = min(44, max(18, proxy.size.width * 0.022))
        let chromeTop = min(66, max(34, proxy.size.height * 0.052))

        return ZStack(alignment: .topLeading) {
            // The web hides the clock at tablet widths (761 to 1100 pt) on pages with a header.
            if proxy.size.width > 1100 || selected == .home {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                #if DEBUG
                let clockDate = ParityLaunch.isActive ? (ParityLaunch.frozenNow ?? context.date) : context.date
                #else
                let clockDate = context.date
                #endif
                HStack(alignment: .firstTextBaseline, spacing: 11) {
                    Text(clockDate.formatted(headerTimeStyle))
                        .font(WM.font(12.5, 800))
                    Text(clockDate.formatted(headerDateStyle).uppercased())
                        .font(WM.font(8, 700)).tracking(0.6)
                        .foregroundStyle(PlayarrStyle.inkSoft)
                }
                .foregroundStyle(PlayarrStyle.ink)
                .offset(x: proxy.size.width * 0.24, y: chromeTop + 14)
            }
            }

            PlayarrLogo(size: 30)
                .offset(x: navEdge + 24.4, y: chromeTop)

            // Web rail: Downloads and Search, then the four browse tabs, then the four personal tabs, each in its own pill.
            VStack(spacing: 15) {
                navGroup(Array(destinations.prefix(2)))
                if destinations.count > 2 {
                    navGroup(Array(destinations.dropFirst(2).prefix(4)))
                }
                if destinations.count > 6 {
                    navGroup(Array(destinations.dropFirst(6)))
                }
            }
            .offset(x: navEdge, y: 110 * proxy.size.height / 1024)

            profileTile
                .offset(x: navEdge, y: proxy.size.height - max(0, proxy.safeAreaInsets.bottom) - 121 * proxy.size.height / 1024)
        }
    }

    private var headerTimeStyle: Date.FormatStyle {
        var style = Date.FormatStyle().hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)
        #if DEBUG
        if ParityLaunch.isActive {
            style.locale = Locale(identifier: "en_GB")
            style.timeZone = ParityLaunch.captureTimeZone
        }
        #endif
        return style
    }

    private var headerDateStyle: Date.FormatStyle {
        var style = Date.FormatStyle().weekday(.abbreviated).day().month(.wide)
        #if DEBUG
        if ParityLaunch.isActive {
            style.locale = Locale(identifier: "en_GB")
            style.timeZone = ParityLaunch.captureTimeZone
        }
        #endif
        return style
    }

    private func navGroup(_ group: [Destination]) -> some View {
        VStack(spacing: 4) {
            ForEach(group, id: \.self) { destination in
                Button { select(destination) } label: {
                    VStack(spacing: 6) {
                        WMIconView(icon: destination.webIcon, color: selected == destination ? PlayarrStyle.ink : PlayarrStyle.inkSoft, size: 18)
                        Text(destination.title)
                            .font(WM.font(8.5, 700))
                            .lineLimit(1)
                    }
                    .foregroundStyle(selected == destination ? PlayarrStyle.ink : PlayarrStyle.inkSoft)
                    .frame(width: 64, height: 64)
                    .background(
                        selected == destination ? PlayarrStyle.ink.opacity(0.09) : .clear,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityLabel(destination.title)
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 6)
        // Web rail pills are solid surface-strong with a 1 px line border (the art never shows through).
        .background(
            PlayarrStyle.surfaceStrong,
            in: RoundedRectangle(cornerRadius: 22, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(PlayarrStyle.line, lineWidth: 1)
        }
        .shadow(color: PlayarrStyle.ink.opacity(0.1), radius: 21, y: 14)
    }

    /// The web rail's profile tile: avatar over the profile name in its own pill, 78 x 75 pt at 1366 wide.
    private var profileTile: some View {
        Button { select(.profiles) } label: {
            VStack(spacing: 4) {
                currentAvatar(size: 28)
                Text((environment.currentUserName ?? "").split(separator: " ").first.map(String.init) ?? "Profile")
                    .font(WM.font(8.5, 700))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineLimit(1)
            }
            .frame(width: 76, height: 75)
            .background(PlayarrStyle.surfaceStrong, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(PlayarrStyle.line, lineWidth: 1) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open profile and settings")
    }

    private func profileButton(size: CGFloat, avatarSize: CGFloat, ring: Bool = true) -> some View {
        Button { select(.profiles) } label: {
            ZStack {
                currentAvatar(size: avatarSize)
            }
            .frame(width: avatarSize, height: avatarSize)
            .frame(width: size, height: size)
            .background(ring ? PlayarrStyle.surfaceStrong.opacity(0.66) : .clear, in: Circle())
            .overlay { if ring { Circle().stroke(PlayarrStyle.line.opacity(0.7), lineWidth: 1) } }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open profile and settings")
    }

    @ViewBuilder
    private func currentAvatar(size: CGFloat) -> some View {
        PlayarrProfileAvatar(
            preference: environment.currentAvatar,
            userID: environment.currentUserID,
            userName: environment.currentUserName,
            size: size
        )
    }

    private func select(_ destination: Destination) {
        guard destination != selected else { return }
        routeTransitionTitle = destination.title
        selected = destination
        Task {
            await Task.yield()
            try? await Task.sleep(for: .milliseconds(180))
            withAnimation(.easeOut(duration: 0.14)) { routeTransitionTitle = nil }
        }
    }

    private var stageNavigationHeight: CGFloat {
        let first = min(2, destinations.count)
        let second = max(0, destinations.count - 2)
        let firstHeight = CGFloat(first) * 64 + CGFloat(max(0, first - 1)) * 4 + 12
        let secondHeight = second > 0 ? CGFloat(second) * 64 + CGFloat(max(0, second - 1)) * 4 + 12 : 0
        return firstHeight + secondHeight + (second > 0 ? 18 : 0)
    }

    private var destinations: [Destination] {
        var result: [Destination] = [.downloads, .search, .home]
        for kind in [WorkKind.series, .movie, .site, .artist] where availableKinds.contains(kind) {
            result.append(.library(kind))
        }
        result.append(.playlists)
        result.append(.watchlist)
        result.append(.requests)
        result.append(.calendar)
        return result
    }

    private var phoneSelectedDestination: Destination {
        let visibleKind = visibleDetailRoutes.activeKind
        #if DEBUG
        // Only these direct debug routes have a deterministic kind before detail data loads.
        let routeKind = Destination.debugDetailKind(for: ParityLaunch.screen)
        let debugKind = demoDetailViewModel.detail?.work.kind ?? routeKind
        return selected.phoneNavigationSelection(visibleDetailKind: visibleKind, debugDetailKind: debugKind)
        #else
        return selected.phoneNavigationSelection(visibleDetailKind: visibleKind, debugDetailKind: nil)
        #endif
    }
}
