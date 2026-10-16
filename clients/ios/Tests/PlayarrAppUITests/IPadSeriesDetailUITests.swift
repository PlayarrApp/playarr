import XCTest

/// Renders the iPad series detail for a series that mixes playable and unplayable (unaired) episodes with three
/// resume targets, set through the server API as the device test account: no progress, the last playable episode,
/// and a mid-season episode. Screenshots are attached for review; progress is reset afterwards.
final class IPadSeriesDetailUITests: XCTestCase {
    private struct Episode { let id: String; let mediaFileID: String?; let season: Int }

    @MainActor
    func testResumeTargetsOnAMixedSeries() async throws {
        let env = ProcessInfo.processInfo.environment
        guard UIDevice.current.userInterfaceIdiom == .pad,
              let server = env["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let username = env["PLAYARR_UI_TEST_USERNAME"], !username.isEmpty,
              let password = env["PLAYARR_UI_TEST_PASSWORD"], !password.isEmpty,
              let base = URL(string: server) else {
            throw XCTSkip("iPad simulator or the UI test account is unavailable.")
        }
        // A library series with unplayable episodes in season 1.
        let seriesID = "ba0f2e48-54da-4c25-9f8c-f9a4eb00ea46"

        func request(_ method: String, _ path: String, token: String? = nil, body: [String: Any]? = nil) async throws -> [String: Any] {
            var req = URLRequest(url: base.appendingPathComponent(path))
            req.httpMethod = method
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
            if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, _) = try await URLSession.shared.data(for: req)
            return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        }
        let login = try await request("POST", "api/v1/auth/login", body: [
            "client_platform": "web", "client_version": "ui-test", "device_id": UUID().uuidString,
            "device_name": "ios-ui-test", "username": username, "password": password,
        ])
        let token = try XCTUnwrap(login["access_token"] as? String)
        let detail = try await request("GET", "api/v1/catalog/\(seriesID)", token: token)
        let seasons = ((detail["children"] as? [String: Any])?["Series"] as? [[String: Any]]) ?? []
        var episodes: [Episode] = []
        for s in seasons {
            let number = ((s["season"] as? [String: Any])?["season_number"] as? Int) ?? 0
            for e in (s["episodes"] as? [[String: Any]]) ?? [] {
                let id = ((e["episode"] as? [String: Any])?["id"] as? String) ?? ""
                episodes.append(Episode(id: id, mediaFileID: e["media_file_id"] as? String, season: number))
            }
        }
        let playable = episodes.filter { $0.mediaFileID != nil }
        XCTAssertLessThan(playable.count, episodes.count, "The fixture series must include unplayable episodes.")
        let season2 = playable.filter { $0.season == 2 }

        func setProgress(_ episode: Episode, completed: Bool, positionMs: Int) async throws {
            guard let file = episode.mediaFileID else { return }
            _ = try await request("PUT", "api/v1/playback/\(file)/progress", token: token, body: [
                "position_ms": positionMs, "duration_ms": 1_800_000, "completed": completed,
            ])
        }
        func resetAll() async throws { for e in playable { try await setProgress(e, completed: false, positionMs: 0) } }
        func shoot(_ name: String, app: XCUIApplication) throws {
            try requireParityCaptureReady(app, expectedUsername: username)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        func render(_ name: String) {
            let app = XCUIApplication()
            app.launchEnvironment = [
                "PLAYARR_PARITY_SERVER": server, "PLAYARR_PARITY_USER": username, "PLAYARR_PARITY_PASSWORD": password,
                "PLAYARR_PARITY_EXPECTED_USERNAME": username,
                "PLAYARR_PARITY_ROUTE": "detail:series:id=\(seriesID)", "PLAYARR_REAL_INSETS": "1",
            ]
            app.launch()
            _ = app.windows.firstMatch.waitForExistence(timeout: 30)
            try requireParityCaptureReady(app, expectedUsername: username)
            Thread.sleep(forTimeInterval: 15)
            try shoot(name, app: app)
            XCTAssertFalse(app.staticTexts["Not available yet"].exists, "The tablet rails list playable episodes only.")
            app.terminate()
        }

        defer { Task { try? await resetAll() } }
        try await resetAll()
        render("ipad-series-fresh")

        // Last playable episode as the resume target.
        for e in playable.dropLast() { try await setProgress(e, completed: true, positionMs: 1_800_000) }
        try await setProgress(try XCTUnwrap(playable.last), completed: false, positionMs: 600_000)
        render("ipad-series-last-episode")

        // A mid-season target: season 2 episode 5.
        try await resetAll()
        let mid = try XCTUnwrap(season2.dropFirst(4).first)
        for e in playable {
            if e.id == mid.id { break }
            try await setProgress(e, completed: true, positionMs: 1_800_000)
        }
        try await setProgress(mid, completed: false, positionMs: 600_000)
        render("ipad-series-mid-season")
    }
}
