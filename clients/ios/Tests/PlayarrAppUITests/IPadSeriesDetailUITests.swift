import XCTest

enum IPadSeriesTestIdentityGuard {
    static func fixtureWindowAuthorized(_ environment: [String: String]) -> Bool {
        environment["PLAYARR_UI_TEST_EXCLUSIVE_FIXTURE_WINDOW"] == "1"
    }

    static func validate(loginUserID: String?, profiles: Any, expectedUsername: String) throws {
        guard let loginUserID, !loginUserID.isEmpty,
              let profiles = profiles as? [[String: Any]] else {
            throw NSError(domain: "IPadSeriesTestIdentity", code: 1, userInfo: [NSLocalizedDescriptionKey: "The current profile response was invalid."])
        }
        let current = profiles.filter { $0["is_current"] as? Bool == true }
        guard current.count == 1,
              let profileID = current[0]["id"] as? String,
              profileID.caseInsensitiveCompare(loginUserID) == .orderedSame,
              let username = current[0]["username"] as? String,
              username.caseInsensitiveCompare(expectedUsername) == .orderedSame else {
            throw NSError(domain: "IPadSeriesTestIdentity", code: 2, userInfo: [NSLocalizedDescriptionKey: "The configured account is not the authenticated current profile."])
        }
    }
}

/// Renders the iPad series detail for a series that mixes playable and unplayable (unaired) episodes with three
/// resume targets, set through the server API as the device test account: no progress, the last playable episode,
/// and a mid-season episode. Screenshots are attached for review; progress is reset afterwards.
final class IPadSeriesDetailUITests: XCTestCase {
    private struct Episode { let id: String; let mediaFileID: String?; let season: Int }

    @MainActor
    func testResumeTargetsOnAMixedSeries() async throws {
        let env = ProcessInfo.processInfo.environment
        guard UIDevice.current.userInterfaceIdiom == .pad,
              IPadSeriesTestIdentityGuard.fixtureWindowAuthorized(env),
              let server = env["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let username = env["PLAYARR_UI_TEST_USERNAME"], !username.isEmpty,
              let password = env["PLAYARR_UI_TEST_PASSWORD"], !password.isEmpty,
              let base = URL(string: server) else {
            throw XCTSkip("Requires the iPad simulator, UI test account and explicit exclusive fixture window.")
        }
        // A library series with unplayable episodes in season 1.
        let seriesID = "ba0f2e48-54da-4c25-9f8c-f9a4eb00ea46"

        func request(_ method: String, _ path: String, token: String? = nil, body: [String: Any]? = nil, allowEmptyResponse: Bool = false) async throws -> Any {
            var req = URLRequest(url: base.appendingPathComponent(path))
            req.httpMethod = method
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
            if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
            let (data, response) = try await URLSession.shared.data(for: req)
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                throw NSError(domain: "IPadSeriesTestAPI", code: status, userInfo: [NSLocalizedDescriptionKey: "The series fixture API request failed with status \(status)."])
            }
            if data.isEmpty, allowEmptyResponse { return NSNull() }
            do { return try JSONSerialization.jsonObject(with: data) }
            catch { throw NSError(domain: "IPadSeriesTestAPI", code: 1, userInfo: [NSLocalizedDescriptionKey: "The series fixture API returned invalid JSON."]) }
        }
        guard let login = try await request("POST", "api/v1/auth/login", body: [
            "client_platform": "web", "client_version": "ui-test", "device_id": UUID().uuidString,
            "device_name": "ios-ui-test", "username": username, "password": password,
        ]) as? [String: Any],
              let token = login["access_token"] as? String, !token.isEmpty,
              let loginUserID = login["user_id"] as? String, !loginUserID.isEmpty else {
            throw NSError(domain: "IPadSeriesTestAPI", code: 2, userInfo: [NSLocalizedDescriptionKey: "The series fixture login response was invalid."])
        }
        guard let detail = try await request("GET", "api/v1/catalog/\(seriesID)", token: token) as? [String: Any] else {
            throw NSError(domain: "IPadSeriesTestAPI", code: 3, userInfo: [NSLocalizedDescriptionKey: "The series fixture catalogue response was invalid."])
        }
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
            let profileResponse = try await request("GET", "api/v1/users/profiles", token: token)
            try IPadSeriesTestIdentityGuard.validate(loginUserID: loginUserID, profiles: profileResponse, expectedUsername: username)
            _ = try await request("PUT", "api/v1/playback/\(file)/progress", token: token, body: [
                "position_ms": positionMs, "duration_ms": 1_800_000, "completed": completed,
            ], allowEmptyResponse: true)
        }
        func resetAll() async throws { for e in playable { try await setProgress(e, completed: false, positionMs: 0) } }
        func shoot(_ name: String, app: XCUIApplication) throws {
            try requireParityCaptureReady(app, expectedUsername: username)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = name
            shot.lifetime = .keepAlways
            add(shot)
        }
        func launchVerifiedApp() throws -> XCUIApplication {
            let app = XCUIApplication()
            app.launchEnvironment = [
                "PLAYARR_PARITY_SERVER": server, "PLAYARR_PARITY_USER": username, "PLAYARR_PARITY_PASSWORD": password,
                "PLAYARR_PARITY_EXPECTED_USERNAME": username,
                "PLAYARR_PARITY_ROUTE": "detail:series:id=\(seriesID)", "PLAYARR_REAL_INSETS": "1",
            ]
            app.launch()
            _ = app.windows.firstMatch.waitForExistence(timeout: 30)
            try requireParityCaptureReady(app, expectedUsername: username)
            return app
        }
        func render(_ name: String) throws {
            let app = try launchVerifiedApp()
            Thread.sleep(forTimeInterval: 15)
            try shoot(name, app: app)
            XCTAssertFalse(app.staticTexts["Not available yet"].exists, "The tablet rails list playable episodes only.")
            app.terminate()
        }

        let identityApp = try launchVerifiedApp()
        identityApp.terminate()
        do {
            try await resetAll()
            try render("ipad-series-fresh")

            // Last playable episode as the resume target.
            for e in playable.dropLast() { try await setProgress(e, completed: true, positionMs: 1_800_000) }
            try await setProgress(try XCTUnwrap(playable.last), completed: false, positionMs: 600_000)
            try render("ipad-series-last-episode")

            // A mid-season target: season 2 episode 5.
            try await resetAll()
            let mid = try XCTUnwrap(season2.dropFirst(4).first)
            for e in playable {
                if e.id == mid.id { break }
                try await setProgress(e, completed: true, positionMs: 1_800_000)
            }
            try await setProgress(mid, completed: false, positionMs: 600_000)
            try render("ipad-series-mid-season")
        } catch {
            let testError = error
            do { try await resetAll() }
            catch {
                throw NSError(domain: "IPadSeriesTestCleanup", code: 1, userInfo: [NSLocalizedDescriptionKey: "The series test failed and guarded progress cleanup also failed."])
            }
            throw testError
        }
        try await resetAll()
    }

    func testCurrentProfileGuardRejectsUnexpectedIdentity() {
        let expected: [[String: Any]] = [["id": "profile-a", "username": "device-test", "is_current": true]]
        XCTAssertNoThrow(try IPadSeriesTestIdentityGuard.validate(loginUserID: "profile-a", profiles: expected, expectedUsername: "DEVICE-TEST"))

        let invalid: [([[String: Any]], String?, String)] = [
            ([["id": "profile-b", "username": "device-test", "is_current": true]], "profile-a", "device-test"),
            ([["id": "profile-a", "username": "other-user", "is_current": true]], "profile-a", "device-test"),
            ([["id": "profile-a", "username": "device-test", "is_current": false]], "profile-a", "device-test"),
            ([["id": "profile-a", "username": "device-test", "is_current": true], ["id": "profile-b", "username": "other-user", "is_current": true]], "profile-a", "device-test"),
        ]
        for (profiles, loginUserID, username) in invalid {
            XCTAssertThrowsError(try IPadSeriesTestIdentityGuard.validate(loginUserID: loginUserID, profiles: profiles, expectedUsername: username))
        }
        XCTAssertThrowsError(try IPadSeriesTestIdentityGuard.validate(loginUserID: "profile-a", profiles: ["invalid"], expectedUsername: "device-test"))
    }

    func testProgressMutationRequiresExplicitFixtureWindow() {
        XCTAssertFalse(IPadSeriesTestIdentityGuard.fixtureWindowAuthorized([:]))
        XCTAssertFalse(IPadSeriesTestIdentityGuard.fixtureWindowAuthorized(["PLAYARR_UI_TEST_EXCLUSIVE_FIXTURE_WINDOW": "true"]))
        XCTAssertTrue(IPadSeriesTestIdentityGuard.fixtureWindowAuthorized(["PLAYARR_UI_TEST_EXCLUSIVE_FIXTURE_WINDOW": "1"]))
    }
}
