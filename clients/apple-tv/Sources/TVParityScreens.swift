import PlayarrKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Deterministic fixture screens for the visual parity suite.
/// Activated with launch argument:
///   `-PlayarrParityScreen <id>`
/// where `<id>` is one of the suite screen ids (see `scripts/appletv-parity-suite.mjs`).
enum TVParityScreenID: String, CaseIterable {
    case deviceCodePairing = "device-code-pairing"
    case homeRecentlyAdded = "home-recently-added"
    case search
    case detailMovie = "detail-movie"
    case detailEpisode = "detail-episode"
    case detailTrack = "detail-track"
    case detailBook = "detail-book"
    case player
    case settings
}

enum TVParityLaunch {
    static let argument = "-PlayarrParityScreen"

    static var disablesAnimations: Bool {
        ProcessInfo.processInfo.arguments.contains("-PlayarrDisableAnimations")
    }

    static var fixedNowArgument: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.firstIndex(of: "-PlayarrParityNow"), args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }

    /// When set, production SwiftUI mounts deterministic fixture state for
    /// honest simctl captures. Apple platforms never use WebView/WKWebView
    /// (or web-ref paint) for parity — native SwiftUI only.
    static var requestedScreen: TVParityScreenID? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: argument), args.indices.contains(idx + 1) else {
            return nil
        }
        return TVParityScreenID(rawValue: args[idx + 1])
    }
}

extension TVParityLaunch {
    static let routeArgument = "-PlayarrParityRoute"

    /// Live parity route (`home`, `movies`, `series`, `music`, `playlists`, `settings`,
    /// `search:<query>`, `detail:<kind>:<title>`). Unlike `-PlayarrParityScreen`
    /// this uses the real server catalogue and artwork (the fixture environment), so
    /// it never injects fixture data; it only picks the screen to show.
    static var route: String? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: routeArgument), args.indices.contains(idx + 1) else {
            return nil
        }
        return args[idx + 1]
    }

    static var isLive: Bool { route != nil }

    /// `-PlayarrPlayFile <media file id>`: plays that file at once (suite playback cases a and b); the player reports to parity-state.json.
    static var playFile: UUID? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: "-PlayarrPlayFile"), args.indices.contains(idx + 1) else { return nil }
        return UUID(uuidString: args[idx + 1])
    }

    /// `home-scrolled:<cards>:<scrollLeft>`: Home with the first rail moved right by `cards` focus steps and its track
    /// scrolled `scrollLeft` points (the web capture's own offset, so both sit at the same position).
    static var homeScroll: (cards: Int, offset: CGFloat)? {
        guard let route, route.hasPrefix("home-scrolled") else { return nil }
        let parts = route.split(separator: ":").map(String.init)
        let cards = parts.count > 1 ? Int(parts[1]) ?? 4 : 4
        let offset = parts.count > 2 ? Double(parts[2]).map { CGFloat($0) } ?? 0 : 0
        return (cards, offset)
    }

    /// `-PlayarrTheme light|dark`: forces the appearance for parity captures.
    static var theme: ColorScheme? {
        let args = ProcessInfo.processInfo.arguments
        guard let idx = args.firstIndex(of: "-PlayarrTheme"), args.indices.contains(idx + 1) else { return nil }
        switch args[idx + 1] {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
    }

    /// The instant the web references freeze their clock at. The capture script passes the fixture clock
    /// (`FIXTURE_CLOCK` in `scripts/fixtures/catalog.mjs`) as `-PlayarrParityNow <ISO 8601>`; without it the
    /// default is 2026-10-07 12:00 UTC.
    static var frozenNow: Date {
        let args = ProcessInfo.processInfo.arguments
        if let idx = args.firstIndex(of: "-PlayarrParityNow"), args.indices.contains(idx + 1) {
            let plain = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = plain.date(from: args[idx + 1]) ?? fractional.date(from: args[idx + 1]) { return date }
        }
        return Date(timeIntervalSince1970: 1_791_374_400)
    }

    /// Static chrome (floating nav, no focus effects, frozen clock): fixture screens and live routes.
    static var frozen: Bool { requestedScreen != nil || isLive }

    static var liveTab: TVNavTab? {
        guard let route else { return nil }
        switch route.split(separator: ":", maxSplits: 1).first.map(String.init) ?? route {
        case "home", "home-scrolled": return .home
        case "movies": return .movies
        case "series": return .series
        case "music": return .music
        case "playlists": return .playlists
        case "settings": return .settings
        case "search": return .search
        case "calendar": return .calendar
        case "downloads": return .downloads
        case "watchlist": return .watchlist
        case "requests": return .requests
        case "detail": return liveDetail?.kind == .series ? .series : .movies
        default: return nil
        }
    }

    /// Section index for `settings:<key>` (avatar, language, player, server, lock, invite, latency, remote, your-data).
    static var liveSettingsSection: Int? {
        guard let route, route.hasPrefix("settings:") else { return nil }
        let keys = ["appearance", "avatar", "language", "player", "server", "lock", "invite", "latency", "remote", "your-data"]
        return keys.firstIndex(of: String(route.dropFirst("settings:".count)))
    }

    /// `(kind, title)` for `detail:<kind>:<title>`.
    static var liveDetail: (kind: WorkKind, title: String)? {
        guard let route, route.hasPrefix("detail:") else { return nil }
        let parts = route.split(separator: ":", maxSplits: 2).map(String.init)
        guard parts.count == 3 else { return nil }
        let kind: WorkKind = parts[1] == "series" ? .series : .movie
        return (kind, parts[2])
    }

    /// `(title, menuOpen)` for `player:<title>` and `player:<title>:quality`.
    static var livePlayer: (title: String, menuOpen: Bool)? {
        guard let route, route.hasPrefix("player:") else { return nil }
        var rest = String(route.dropFirst("player:".count))
        var menu = false
        if rest.hasSuffix(":quality") {
            menu = true
            rest = String(rest.dropLast(":quality".count))
        }
        return (rest, menu)
    }

    static var liveQuery: String? {
        guard let route, route.hasPrefix("search:") else { return nil }
        return String(route.dropFirst("search:".count))
    }
}

/// Resolves `detail:<kind>:<title>` against the live catalogue, then shows the
/// production detail screen for it.
struct TVParityLiveDetailView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var work: Work?

    var body: some View {
        Group {
            if let work {
                TVWorkDetailView(work: work, apiClient: environment.apiClient)
            } else {
                TVStageBackground()
            }
        }
        .task {
            guard let want = TVParityLaunch.liveDetail else { return }
            if let page = try? await environment.apiClient.browseCatalog(
                kind: want.kind, genre: nil, tag: nil, sort: "title", limit: 100, offset: 0
            ) {
                work = page.items.first { $0.title == want.title }
            }
        }
    }
}

/// Resolves `player:<title>` to the film's media file and shows the player chrome at the frozen
/// position (2.0 s of 6 s) over a black stage, as the web reference does with the video hidden.
struct TVParityLivePlayerView: View {
    @Environment(TVAppEnvironment.self) private var environment
    @State private var mediaFileID: UUID?

    var body: some View {
        Group {
            if let mediaFileID, let target = TVParityLaunch.livePlayer {
                TVPlayerView(
                    mediaFileID: mediaFileID,
                    title: target.title,
                    apiClient: environment.apiClient,
                    parity: (position: 2, duration: 60, menuOpen: target.menuOpen)
                )
            } else {
                Color.black.ignoresSafeArea()
            }
        }
        .task {
            guard let target = TVParityLaunch.livePlayer else { return }
            if let page = try? await environment.apiClient.browseCatalog(
                kind: .movie, genre: nil, tag: nil, sort: "title", limit: 100, offset: 0
            ), let work = page.items.first(where: { $0.title == target.title }),
               let detail = try? await environment.apiClient.fetchWork(id: work.id) {
                mediaFileID = detail.mediaFileID
            }
        }
    }
}

/// Static fixture data so pixel diffs are not poisoned by live catalogue churn.
enum TVParityFixtures {
    static let movieTitle = "Parity Movie"
    static let seriesTitle = "Parity Series"
    static let trackTitle = "Parity Track"
    static let bookTitle = "Parity Book"
    static let userCode = "ABCD-2345"
    static let verificationURI = "https://playarr.app/link"
    static let overview =
        "A fixed synopsis used by the Apple TV visual parity suite so native and web captures share identical copy."

    /// Deterministic catalogue for production-SwiftUI parity captures (no network).
    /// All titles are neutral placeholders.
    static func sampleWorks() -> [Work] {
        let titles: [(String, WorkKind, String, String)] = [
            ("Sample Series 1", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
            ("Sample Series 2", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
            ("Sample Movie 1", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 2", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 3", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 4", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 5", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 6", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 7", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
            ("Sample Movie 8", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ]
        return makeWorks(titles, idBase: 1)
    }

    /// Library-directory fixtures (series first for the default library; artists for music).
    static func libraryWorks(kind: WorkKind?) -> [Work] {
        switch kind {
        case .artist:
            return makeWorks(musicTitles, idBase: 100)
        case .series, .author, .none:
            // `/library` redirects to series; detail-book shares that frame.
            return makeWorks(seriesTitles, idBase: 200)
        case .movie:
            return makeWorks(movieTitles, idBase: 300)
        case .site:
            return makeWorks(seriesTitles, idBase: 400)
        }
    }

    private static let seriesTitles: [(String, WorkKind, String, String)] = [
        ("Sample Series 1", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 2", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 3", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 4", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 5", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 6", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 7", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 8", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 9", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 10", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 11", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
        ("Sample Series 12", .series, "A placeholder synopsis used by the parity suite.", "Drama"),
    ]

    private static let musicTitles: [(String, WorkKind, String, String)] = [
        ("Sample Artist 1", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 2", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 3", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 4", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 5", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 6", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 7", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 8", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 9", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 10", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 11", .artist, "A placeholder biography used by the parity suite.", "Rock"),
        ("Sample Artist 12", .artist, "A placeholder biography used by the parity suite.", "Rock"),
    ]

    private static let movieTitles: [(String, WorkKind, String, String)] = [
        ("Sample Movie 1", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 2", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 3", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 4", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 5", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 6", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 7", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 8", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 9", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 10", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 11", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
        ("Sample Movie 12", .movie, "A placeholder synopsis used by the parity suite.", "Action"),
    ]

    private static func makeWorks(
        _ titles: [(String, WorkKind, String, String)],
        idBase: Int
    ) -> [Work] {
        titles.enumerated().map { index, item in
            Work(
                id: UUID(uuidString: String(format: "00000000-0000-4000-8000-%012d", idBase + index))!,
                kind: item.1,
                title: item.0,
                sortTitle: item.0.lowercased(),
                overview: item.2,
                images: [],
                genres: item.3.split(separator: "|").map(String.init),
                tags: [],
                // 2026-01-15 + index days — matches SPA suite year labels.
                addedAt: Date(timeIntervalSince1970: 1_768_435_200 + Double(index) * 86_400),
                monitored: true,
                availability: .available
            )
        }
    }
}

// TVParityRootView + plain-shelf homeFixture deleted (honest parity always
// mounts TVRootView → TVHomeView with hero + dual rails). Pairing/player
// fixtures below are still used from TVRootView for offline chrome.

/// Deterministic device-code pairing chrome for parity captures (no network).
/// Shares `TVDeviceLoginChrome` with live pairing so AE geometry cannot drift.
struct TVParityPairingFixtureView: View {
    var body: some View {
        TVDeviceLoginChrome(
            phase: .awaitingApproval(
                userCode: TVParityFixtures.userCode,
                verificationURI: TVParityFixtures.verificationURI,
                qr: AnyView(TVParityQRModules()),
                secondsRemaining: 5 * 60
            ),
            onRetry: nil
        )
        .environment(TVDisplayPreferences())
    }
}

/// Deterministic player chrome for parity captures (ui-tv PlayerScreen layout).
/// SPA tokens: padding spacing.xl=32, gap spacing.md=16, title 24/700,
/// progress h=6 raised track, buttons pad sm/lg=8/24 radius 8 border 3.
/// Measured full30 REF: title y≈912, progress y≈956 w≈650 x≈32,
/// buttons y≈978–1013 (Back 109 / Play 94 / Forward 133 / Exit 90).
struct TVParityPlayerFixtureView: View {
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .bottomLeading) {
                DesignTokens.Color.backgroundBase
                // Soft brand radial — match SPA glow mean (dimmer than prior native).
                RadialGradient(
                    colors: [
                        Color(red: 0.38, green: 0.16, blue: 0.24).opacity(0.42),
                        Color(red: 0.22, green: 0.11, blue: 0.16).opacity(0.22),
                        DesignTokens.Color.backgroundBase.opacity(0.04),
                        DesignTokens.Color.backgroundBase,
                    ],
                    center: UnitPoint(x: 0.45, y: 0.30),
                    startRadius: 30,
                    endRadius: geo.size.width * 0.52
                )

                // full38: progress was 1px high (NAT y955–960 vs REF y956–961).
                // bottom pad 32 drops chrome 1px; title.padding.bottom 5 restores title y912.
                // Track colour matched to SPA sample (44,42,44) not pure #333.
                VStack(alignment: .leading, spacing: 16) {
                    Text("Sample Movie 1")
                        .font(.system(size: 24, weight: .bold))
                        .tracking(-0.4)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .padding(.bottom, 5)
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color(red: 44 / 255, green: 42 / 255, blue: 44 / 255))
                        Capsule()
                            .fill(DesignTokens.Color.brandPrimary)
                            .frame(width: 650)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 6)
                    HStack(spacing: 16) {
                        chromeButton("< Back")
                        chromeButton("Play", primary: true)
                        chromeButton("Forward >")
                        chromeButton("Exit")
                    }
                    Text("paused")
                        .font(.system(size: 12, weight: .regular))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .ignoresSafeArea()
    }

    private func chromeButton(_ label: String, primary: Bool = false) -> some View {
        // full44 best player AE 0.16%: pad 30 + clear border box.
        // frame(height:) / fixed widths regressed to ~0.5%.
        Text(label)
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(DesignTokens.Color.textPrimary)
            .padding(.horizontal, 30)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(
                        primary
                            ? DesignTokens.Color.brandPrimary
                            : Color(red: 44 / 255, green: 42 / 255, blue: 44 / 255)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.clear, lineWidth: 3)
            )
            .padding(3)
    }
}



/// Stage for web destinations the Apple TV client does not implement yet (Downloads, Watchlist,
/// Requests, Calendar). Honest empty state rather than a missing nav entry.
struct TVNotYetOnTVView: View {
    let title: String

    var body: some View {
        ZStack {
            TVStageBackground()
            VStack(spacing: 12) {
                Text(title)
                    .font(TVTheme.font(size: 34, weight: .medium))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                Text("This screen is not available on Apple TV yet.")
                    .font(TVTheme.font(size: 16, weight: .regular))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            }
        }
    }
}

#if DEBUG && (os(tvOS) || os(macOS))
import Foundation
#if os(tvOS)
import UIKit
#endif

/// Debug-only state for the shared parity suite's driver (docs/parity/SUITE.md): the current route in web terms and the
/// focused item's label, written as JSON to `parity-state.json` in the app's Documents folder after every focus or route
/// change. A driver reads it with `xcrun simctl get_app_container <udid> <bundle> data`. Compiled out of release builds.
@MainActor
enum TVParityState {
    private static var base = "/"
    private static var query: [String: String] = [:]
    private static var started = false
    private static var heartbeat: Timer?
    /// Diagnosis for readiness stalls: the last library-load events, shown in the driver's timeout error.
    private static var trace: [String] = []
    static func leaseDescription(_ lease: TVParityReadinessLease?) -> String {
        "lease=\(lease.map { "\($0.generation)@\($0.routeKey)" } ?? "nil") held=\(contentLease.map { "\($0.generation)@\($0.routeKey)" } ?? "nil") key=\(contentRouteKey)"
    }
    static func note(_ event: String) {
        trace.append("\(contentGeneration):\(event)")
        if trace.count > 14 { trace.removeFirst() }
    }
    private static var currentUserID = ""

    /// The route in web terms: the base path plus the suite's query items (`view` on the Calendar, `panel=filters`).
    private static var route: String {
        base + (query.isEmpty ? "" : "?" + query.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&"))
    }

    private static var tag: String?
    private static var tagID: String?
    private static var position: [String: Any]?
    private static var playback: [String: Any]?
    private static var items: Int?
    private static var contentState = "loading"
    private static var panelContentState: String?
    private static var contentGeneration = 0
    private static var panelGeneration = 0
    private static var contentLease: TVParityReadinessLease?
    private static var panelLease: TVParityReadinessLease?

    private static var contentRouteKey: String {
        base + (query.filter { $0.key != "panel" }.isEmpty ? "" : "?" + query.filter { $0.key != "panel" }.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&"))
    }

    private static var panelRouteKey: String {
        base + (query.isEmpty ? "" : "?" + query.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: "&"))
    }

    private static func routeWillChange() -> (content: String, panel: String) {
        (contentRouteKey, panelRouteKey)
    }

    private static func routeDidChange(from previous: (content: String, panel: String)) {
        if previous.content != contentRouteKey {
            contentGeneration &+= 1
            contentLease = nil
            items = nil
            contentState = "loading"
        }
        if previous.panel != panelRouteKey {
            panelGeneration &+= 1
            panelLease = nil
            panelContentState = nil
        }
    }

    /// The count and load state of the current route, used to refuse empty or failed parity captures.
    static func beginContent(expectedBase: String) -> TVParityReadinessLease? {
        guard base == expectedBase else { return nil }
        contentGeneration &+= 1
        let lease = TVParityReadinessLease(routeKey: contentRouteKey, generation: contentGeneration)
        contentLease = lease
        items = nil
        contentState = "loading"
        write()
        return lease
    }

    static func claimContent(expectedBase: String) -> TVParityReadinessLease? {
        guard base == expectedBase else { return nil }
        if let contentLease, contentLease.routeKey == contentRouteKey { return contentLease }
        return beginContent(expectedBase: expectedBase)
    }

    static func waitForContent(expectedBase: String) async -> TVParityReadinessLease? {
        for _ in 0..<100 {
            if Task.isCancelled { return nil }
            if let lease = claimContent(expectedBase: expectedBase) { return lease }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return nil
    }

    static func waitForContentLoad(expectedBase: String) async -> TVParityReadinessLease? {
        for _ in 0..<100 {
            if Task.isCancelled { return nil }
            if let lease = beginContent(expectedBase: expectedBase) { return lease }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return nil
    }

    static func isCurrent(_ lease: TVParityReadinessLease) -> Bool {
        contentLease == lease && lease.routeKey == contentRouteKey
    }

    static func canContinueProductLoad(activeCapture: Bool, lease: TVParityReadinessLease?) -> Bool {
        guard activeCapture else { return true }
        guard let lease else { return false }
        return isCurrent(lease)
    }

    static func releaseContent(_ lease: TVParityReadinessLease) {
        guard isCurrent(lease) else { return }
        contentGeneration &+= 1
        contentLease = nil
        items = nil
        contentState = "loading"
        write()
    }

    @discardableResult
    static func setContent(_ count: Int?, state: String, lease: TVParityReadinessLease) -> Bool {
        guard isCurrent(lease) else { return false }
        items = count
        contentState = state
        write()
        return true
    }

    static func beginPanel(expectedBase: String) -> TVParityReadinessLease? {
        guard base == expectedBase, query["panel"] == "filters" else { return nil }
        panelGeneration &+= 1
        let lease = TVParityReadinessLease(routeKey: panelRouteKey, generation: panelGeneration)
        panelLease = lease
        panelContentState = "loading"
        write()
        return lease
    }

    static func waitForPanel(expectedBase: String) async -> TVParityReadinessLease? {
        for _ in 0..<100 {
            if Task.isCancelled { return nil }
            if base == expectedBase, query["panel"] == "filters" { return beginPanel(expectedBase: expectedBase) }
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
        return nil
    }

    static func isCurrentPanel(_ lease: TVParityReadinessLease) -> Bool {
        panelLease == lease && lease.routeKey == panelRouteKey
    }

    static func setPanelContentState(_ state: String?, lease: TVParityReadinessLease) {
        guard isCurrentPanel(lease) else { return }
        panelContentState = state
        write()
    }

    /// The authenticated account identity for capture guards. This is a user ID only, never a token.
    static func setCurrentUserID(_ userID: String) { currentUserID = userID; write() }

    /// The player's state for the driver's playback cases: `playing`, `buffering` or `failed`, and the position.
    static func setPlayback(playing: Bool, position: Double, failed: String?) {
        playback = ["state": failed != nil ? "failed" : playing ? "playing" : "buffering", "position": position, "detail": failed ?? ""]
        write()
    }

    /// The focused card or nav tile's title, set by the tile itself: SwiftUI's focus item is not a view, so the
    /// accessibility tree cannot name it reliably.
    /// `id` tells tiles apart when titles repeat (two films called "Brothers"): only the tile that set the tag clears it.
    static func setFocus(_ title: String, _ focused: Bool, id: String? = nil, rail: Any? = nil, index: Int? = nil,
                         gridPosition: TVParityGridPosition? = nil) {
        let key = id ?? title
        if focused {
            tag = title
            tagID = key
            if let gridPosition {
                position = ["rail": gridPosition.row, "index": gridPosition.column,
                            "row": gridPosition.row, "column": gridPosition.column, "kind": "grid"]
            } else {
                position = rail.flatMap { r in index.map { ["rail": r, "index": $0] } }
            }
        }
        else if tagID == key { tag = nil; tagID = nil; position = nil }
        write()
    }

    static func setCalendarView(_ mode: String?) {
        let previous = routeWillChange()
        query["view"] = mode
        routeDidChange(from: previous)
        write()
    }

    /// An open drawer: `filters` for the Filters drawer, `actions` for any other.
    static func setPanel(_ title: String?) {
        let previous = routeWillChange()
        query["panel"] = title.map { $0.lowercased() == "filters" ? "filters" : "actions" }
        routeDidChange(from: previous)
        if query["panel"] == "actions" { panelContentState = "loaded" }
        write()
    }

    static var currentPanelContentState: String? { panelContentState }

    static func setProfiles(_ open: Bool) {
        base = open ? "/profiles" : base
        write()
    }

    /// The suite's web routes: `/`, `/movies`, `/series`, `/music`, `/search`, `/calendar`, `/settings`, a title
    /// `/movies/<id>` or `/series/<id>`, a playlist `/playlists/<id>`.
    static func setRoute(tab: TVNavTab, path: [TVRoute]) {
        let previous = routeWillChange()
        query = tab == .calendar && path.isEmpty ? query.filter { $0.key == "view" } : [:]
        switch path.last {
        case .work(let work):
            base = "/\(work.kind == .series ? "series" : "movies")/\(work.id.uuidString.lowercased())"
        case .playlist(let id, _):
            base = "/playlists/\(id.uuidString.lowercased())"
        case nil:
            base = tab == .home ? "/" : "/\(tab.rawValue)"
        }
        routeDidChange(from: previous)
        write()
    }

    static func start() {
        guard !started else { return }
        started = true
        heartbeat = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            Task { @MainActor in write() }
        }
        #if os(tvOS)
        NotificationCenter.default.addObserver(forName: UIFocusSystem.didUpdateNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in write() }
        }
        #endif
        write()
    }

    #if os(tvOS)
    /// The label of the focused item. SwiftUI's focus item is not a view, so match its frame against the accessibility
    /// elements of the window (the one with the best overlap and a label), then fall back to the view tree.
    private static func label(of item: UIFocusItem?, in window: UIWindow?) -> String? {
        guard let item else { return nil }
        if let text = (item as? NSObject)?.accessibilityLabel, !text.isEmpty { return text }
        if let window, let space = item.focusItemContainer?.coordinateSpace {
            let frame = space.convert(item.frame, to: window.screen.coordinateSpace)
            var best: (score: CGFloat, text: String)?
            func visit(_ node: Any, _ depth: Int) {
                guard depth < 40, let object = node as? NSObject else { return }
                if let text = object.accessibilityLabel, !text.isEmpty {
                    let box = object.accessibilityFrame.intersection(frame)
                    if !box.isNull, box.width > 0, box.height > 0 {
                        let union = object.accessibilityFrame.union(frame)
                        let score = (box.width * box.height) / max(1, union.width * union.height)
                        if score > (best?.score ?? 0.2) { best = (score, text) }
                    }
                }
                if let elements = object.accessibilityElements { elements.forEach { visit($0, depth + 1) } }
                let count = object.accessibilityElementCount()
                if count != NSNotFound, count > 0 { for index in 0..<min(count, 400) { if let element = object.accessibilityElement(at: index) { visit(element, depth + 1) } } }
                if let view = object as? UIView { view.subviews.forEach { visit($0, depth + 1) } }
            }
            visit(window, 0)
            if let best { return best.text }
        }
        var view = item as? UIView
        while let v = view {
            if let text = v.accessibilityLabel, !text.isEmpty { return text }
            if let text = (v as? UILabel)?.text, !text.isEmpty { return text }
            view = v.superview
        }
        return nil
    }

    private static func focusState() -> (label: String?, item: String?) {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first
        let focused = window.flatMap { UIFocusSystem.focusSystem(for: $0)?.focusedItem }
        return (label(of: focused, in: window), focused.map { String(String(describing: $0).prefix(160)) })
    }
    #else
    // The Mac has no focus-system item to read: the tiles' own tags are the focus.
    private static func focusState() -> (label: String?, item: String?) { (nil, nil) }
    #endif

    private static func write() {
        let found = focusState()
        let state: [String: Any] = ["route": route, "userID": currentUserID, "focused": (tag ?? found.label) as Any, "item": found.item as Any,
                                    "at": Date().timeIntervalSince1970, "playback": playback as Any, "position": position as Any,
                                    "items": items as Any, "contentState": contentState,
                                    "panelContentState": panelContentState as Any,
                                    "trace": trace,
                                    "determinism": ["clock": TVParityLaunch.fixedNowArgument ?? "", "animationsDisabled": TVParityLaunch.disablesAnimations]]
        // `-PlayarrParityState <path>`: an explicit file (the Mac driver); otherwise the app's Documents folder.
        let args = ProcessInfo.processInfo.arguments
        let explicit = args.firstIndex(of: "-PlayarrParityState").flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil }
        guard let data = try? JSONSerialization.data(withJSONObject: state),
              let target = explicit.map({ URL(fileURLWithPath: $0) })
                ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("parity-state.json") else { return }
        do { try data.write(to: target, options: .atomic) } catch { NSLog("PlayarrParity: cannot write %@: %@", target.path, String(describing: error)) }
    }
}

/// Pure debug telemetry state, kept separate from the production first-page `didLoad` flag.
struct TVParityReadinessLease: Equatable {
    let routeKey: String
    let generation: Int
}

struct TVParityPaginationReadiness: Equatable {
    private(set) var isLoadingAllPages = false

    mutating func begin() { isLoadingAllPages = true }
    mutating func finish() { isLoadingAllPages = false }

    func contentState(afterFirstPage state: String) -> String {
        isLoadingAllPages ? "loading" : state
    }
}
#endif
