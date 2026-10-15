import XCTest

/// Focus while moving, with a hardware keyboard: opens each screen, sends Tab and arrow keys and attaches a frame after every
/// key (names `<route>_<n>_<key>`), then swipes the panels to their end and shows and hides the player controls. Frames only,
/// compared by eye with the web at the phone profile; runs in the iOS keyboard focus workflow, never in the normal test run.
final class KeyboardFocusUITests: XCTestCase {
    private func credentials() throws -> (String, String, String) {
        let e = ProcessInfo.processInfo.environment
        guard e["PLAYARR_KEYBOARD_FOCUS"] == "1",
              let server = e["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let user = e["PLAYARR_UI_TEST_USERNAME"], !user.isEmpty,
              let pass = e["PLAYARR_UI_TEST_PASSWORD"], !pass.isEmpty else { throw XCTSkip("Runs only in the keyboard focus workflow.") }
        return (server, user, pass)
    }

    private func launch(_ route: String, _ c: (String, String, String), arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launchEnvironment = ["PLAYARR_PARITY_SERVER": c.0, "PLAYARR_PARITY_USER": c.1, "PLAYARR_PARITY_PASSWORD": c.2, "PLAYARR_PARITY_ROUTE": route]
        app.launch()
        _ = app.windows.firstMatch.waitForExistence(timeout: 30)
        Thread.sleep(forTimeInterval: 14)
        return app
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name; a.lifetime = .keepAlways
        add(a)
    }

    @MainActor
    func testKeysMoveFocus() throws {
        let c = try credentials()
        let keys: [(String, XCUIKeyboardKey)] = [
            ("tab", .tab), ("tab", .tab), ("down", .downArrow), ("down", .downArrow), ("right", .rightArrow), ("right", .rightArrow),
            ("left", .leftArrow), ("up", .upArrow), ("return", .return),
        ]
        for route in ["home", "movies", "series", "search:Sample", "calendar-agenda", "settings", "detail:movie:@first", "detail:series:@first"] {
            let app = launch(route, c)
            let tag = route.replacingOccurrences(of: ":", with: "_")
            shot(app, "\(tag)_0_start")
            for (index, key) in keys.enumerated() {
                app.typeKey(key.1, modifierFlags: [])
                Thread.sleep(forTimeInterval: 0.8)
                shot(app, "\(tag)_\(index + 1)_\(key.0)")
            }
            app.terminate()
        }
    }

    @MainActor
    func testPanelsScrollToTheEnd() throws {
        let c = try credentials()
        for route in ["filters", "actions", "profiles", "settings:player"] {
            let app = launch(route, c)
            let tag = route.replacingOccurrences(of: ":", with: "_")
            shot(app, "\(tag)_0_top")
            for step in 1...4 {
                app.swipeUp(velocity: .fast)
                Thread.sleep(forTimeInterval: 0.8)
                shot(app, "\(tag)_\(step)_swipe")
            }
            app.terminate()
        }
    }

    @MainActor
    func testSelectsAndProfileMenu() throws {
        let c = try credentials()
        let filters = launch("filters", c)
        let select = filters.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Any language'")).firstMatch
        if select.waitForExistence(timeout: 5) { select.tap(); Thread.sleep(forTimeInterval: 1) }
        shot(filters, "select_0_open")
        for step in 1...3 { filters.swipeUp(velocity: .fast); Thread.sleep(forTimeInterval: 0.8); shot(filters, "select_\(step)_swipe") }
        filters.terminate()
        let home = launch("home", c)
        let profile = home.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'profile'")).firstMatch
        if profile.waitForExistence(timeout: 5) { profile.tap(); Thread.sleep(forTimeInterval: 1.5) }
        shot(home, "profile_0_open")
        for step in 1...3 { home.swipeUp(velocity: .fast); Thread.sleep(forTimeInterval: 0.8); shot(home, "profile_\(step)_swipe") }
        home.terminate()
    }

    /// Playback through the `play` route on the suite's pinned file (the `player` route pauses at 2.0 s by design), so the
    /// controls fade while playing: frames at 1, 3, 5 and 9 s idle, a tap to show them, space to pause, arrows, a scrub drag
    /// along the seek bar, Tab and Return.
    @MainActor
    func testPlayerControlsShowAndHide() throws {
        let c = try credentials()
        let file = ProcessInfo.processInfo.environment["PLAYARR_UI_TEST_PLAY_FILE"] ?? ""
        let app = file.isEmpty ? launch("player:movie:@first", c) : launch("play", c, arguments: ["--playarr-parity-play", file])
        let window = app.windows.firstMatch
        for seconds in [1.0, 2.0, 2.0, 4.0] { Thread.sleep(forTimeInterval: seconds); shot(app, "player_idle_\(Int(seconds * 10))_\(Date().timeIntervalSince1970)") }
        let centre = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
        centre.tap(); Thread.sleep(forTimeInterval: 0.6); shot(app, "player_1_tap")
        Thread.sleep(forTimeInterval: 5); shot(app, "player_2_hidden_again")
        centre.tap(); Thread.sleep(forTimeInterval: 0.6); shot(app, "player_3_tap_show")
        app.typeKey(" ", modifierFlags: []); Thread.sleep(forTimeInterval: 1); shot(app, "player_4_space")
        app.typeKey(.rightArrow, modifierFlags: []); Thread.sleep(forTimeInterval: 1); shot(app, "player_5_right")
        app.typeKey(.leftArrow, modifierFlags: []); Thread.sleep(forTimeInterval: 1); shot(app, "player_6_left")
        let from = window.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.835))
        let to = window.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.835))
        from.press(forDuration: 0.2, thenDragTo: to); Thread.sleep(forTimeInterval: 1.5); shot(app, "player_7_scrub")
        app.typeKey(.tab, modifierFlags: []); Thread.sleep(forTimeInterval: 0.8); shot(app, "player_8_tab")
        app.typeKey(.tab, modifierFlags: []); Thread.sleep(forTimeInterval: 0.8); shot(app, "player_9_tab")
        app.typeKey(.return, modifierFlags: []); Thread.sleep(forTimeInterval: 1); shot(app, "player_10_return")
        app.terminate()
    }
}
