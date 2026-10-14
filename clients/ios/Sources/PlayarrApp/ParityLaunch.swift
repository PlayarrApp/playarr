import Foundation
import PlayarrKit
import SwiftUI
import UIKit

#if DEBUG
/// Debug launch hooks for parity captures and iOS UI tests. They sign the app
/// in against a fixture server and open one named screen, so simulator output
/// can be compared with the web mobile reference. UI tests pass credentials
/// through the environment, not simulator launch arguments. Compiled out of Release builds.
///
///     --playarr-parity-server <url> --playarr-parity-user <name>
///     --playarr-parity-password <password> --playarr-parity-route <route>
///
/// Routes: `home`, `movies`, `series`, `settings`, `profiles`, `search:<text>`,
/// `detail:<movie|series>:<title>`, `player:movie:<title>` (the film paused at 2.0 s with the
/// controls up) and `player-quality:movie:<title>` (the same with the quality menu open).
enum ParityLaunch {
    private static func environmentValue(_ key: String) -> String? {
        ProcessInfo.processInfo.environment[key]
    }

    private static func value(_ flag: String) -> String? {
        let args = ProcessInfo.processInfo.arguments
        guard let index = args.lastIndex(of: flag), index + 1 < args.count else { return nil }
        return args[index + 1]
    }

    static var server: String? { value("--playarr-parity-server") ?? environmentValue("PLAYARR_PARITY_SERVER") }
    static var user: String? { value("--playarr-parity-user") ?? environmentValue("PLAYARR_PARITY_USER") }
    static var password: String? { value("--playarr-parity-password") ?? environmentValue("PLAYARR_PARITY_PASSWORD") }
    static var route: String? { value("--playarr-parity-route") ?? environmentValue("PLAYARR_PARITY_ROUTE") }
    private static var parts: [String] {
        (route ?? "").split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false).map(String.init)
    }
    static var screen: String? {
        guard let head = parts.first, !head.isEmpty else { return nil }
        switch head {
        case "home-scrolled": return "home"
        case "calendar-month", "calendar-week", "calendar-agenda": return "calendar"
        case "detail": return parts.count > 1 && parts[1] == "series" ? "detail-series" : "detail-film"
        default: return head
        }
    }
    /// `home-scrolled:<card>`: Home with the first rail scrolled so that card is at the leading edge.
    static var homeScrollCard: Int? {
        guard parts.first == "home-scrolled" else { return nil }
        return parts.count > 1 ? Int(parts[1]) ?? 2 : 2
    }
    static var selectsHomeSeries: Bool { environmentValue("PLAYARR_PARITY_SELECT_HOME_SERIES") == "1" }
    /// `--playarr-parity-play <media file id>` with route `play`: opens the player on that file and plays it (suite playback cases).
    static var playFile: String? { value("--playarr-parity-play") }
    /// Routes `calendar-month`, `calendar-week` and `calendar-agenda` open the calendar in that view.
    static var calendarMode: CalendarViewMode? {
        switch parts.first { case "calendar-month": .month; case "calendar-week": .week; case "calendar-agenda": .agenda; default: nil }
    }
    /// Merges one key into Documents/parity-state.json, which the simulator driver reads (signed in, playback state).
    @MainActor static func record(_ key: String, _ value: Any) {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("parity-state.json")
        var state = (try? JSONSerialization.jsonObject(with: Data(contentsOf: url))) as? [String: Any] ?? [:]
        state[key] = value
        if let data = try? JSONSerialization.data(withJSONObject: state) { try? data.write(to: url) }
    }
    static var isPlayerRoute: Bool { parts.first == "player" || parts.first == "player-quality" }
    static var title: String? {
        ["detail", "player", "player-quality"].contains(parts.first ?? "") && parts.count > 2 ? parts[2] : nil
    }
    /// `settings:<panel>` opens one settings panel (avatar, language, player, server, lock, invite, remote,
    /// latency or your-data).
    static var panel: String? { parts.first == "settings" && parts.count > 1 ? parts[1] : nil }
    /// `--playarr-parity-theme light|dark`: the app's own appearance setting, as the web references set
    /// the theme in storage (the profile page names the active theme).
    static var theme: String? {
        guard let value = value("--playarr-parity-theme"), ["light", "dark"].contains(value) else { return nil }
        return value
    }
    static var query: String? { parts.first == "search" && parts.count > 1 ? parts[1] : nil }
    /// `--playarr-parity-now <ISO 8601>`: the instant the web reference was captured at.
    static var frozenNow: Date? {
        guard let raw = value("--playarr-parity-now") else { return nil }
        return ISO8601DateFormatter().date(from: raw)
    }
    static var isActive: Bool { server != nil && user != nil }
    /// `--playarr-parity-landscape`: rotates the window to landscape (a wall tile shows the iPad 4:3 landscape).
    @MainActor static func applyLandscape() {
        guard ProcessInfo.processInfo.arguments.contains("--playarr-parity-landscape") else { return }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
                scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeLeft)) { NSLog("PlayarrParity rotate failed: %@", String(describing: $0)) }
            }
        }
    }
}

/// Resolves the fixture film named in the launch route to its media file through the catalogue,
/// then shows the player on it.
struct ParityPlayerHost: View {
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var target: (id: UUID, title: String)?

    var body: some View {
        NavigationStack {
            if let target {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: target.id.uuidString,
                    initialTitle: target.title
                )
            } else {
                Color.black.ignoresSafeArea()
            }
        }
        .task {
            if target == nil, let file = ParityLaunch.playFile, let id = UUID(uuidString: file) { target = (id, ""); return }
            guard target == nil, let title = ParityLaunch.title else { return }
            let page = try? await apiClient.browseCatalog(kind: .movie, genre: nil, tag: nil, sort: nil, limit: 100, offset: nil)
            guard let work = page?.items.first(where: { $0.title == title || title == "@first" }),
                  let detail = try? await apiClient.fetchWork(id: work.id),
                  let mediaFileID = detail.mediaFileID else { return }
            target = (mediaFileID, title)
        }
    }
}
#endif
