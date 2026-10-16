import XCTest

/// Verifies identity and route readiness before captures, then checks keyboard focus movement across each phone route,
/// panel scrolling, selector presentation, and direct-play controls. Captures are attached for visual parity review.
final class KeyboardFocusUITests: XCTestCase {
    private func credentials() throws -> (String, String, String, String, String) {
        let e = ProcessInfo.processInfo.environment
        guard e["PLAYARR_KEYBOARD_FOCUS"] == "1" else { throw XCTSkip("Runs only in the keyboard focus workflow.") }
        guard let server = e["PLAYARR_DEVICE_TEST_SERVER_URL"], !server.isEmpty,
              let user = e["PLAYARR_DEVICE_TEST_USERNAME"], !user.isEmpty,
              let pass = e["PLAYARR_DEVICE_TEST_PASSWORD"], !pass.isEmpty,
              let expected = e["PLAYARR_DEVICE_TEST_EXPECTED_USERNAME"], !expected.isEmpty else {
            throw NSError(domain: "PlayarrKeyboardFocus", code: 10, userInfo: [NSLocalizedDescriptionKey: "The opted-in keyboard workflow requires the signed-in device-test account."])
        }
        guard let file = e["PLAYARR_DEVICE_TEST_PLAY_FILE"], UUID(uuidString: file) != nil else {
            throw NSError(domain: "PlayarrKeyboardFocus", code: 11, userInfo: [NSLocalizedDescriptionKey: "The keyboard workflow requires the pinned direct-play fixture."])
        }
        return (server, user, pass, expected, file)
    }

    private func launch(_ route: String, _ c: (String, String, String, String, String), arguments: [String] = []) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments + ["--playarr-parity-now", "2026-10-14T12:00:00Z"]
        app.launchEnvironment = ["PLAYARR_PARITY_SERVER": c.0, "PLAYARR_PARITY_USER": c.1, "PLAYARR_PARITY_PASSWORD": c.2, "PLAYARR_PARITY_EXPECTED_USERNAME": c.3, "PLAYARR_PARITY_PLAY_FILE": c.4, "PLAYARR_PARITY_DISABLE_ANIMATIONS": "1", "PLAYARR_PARITY_ROUTE": route]
        app.launch()
        _ = app.windows.firstMatch.waitForExistence(timeout: 30)
        let verified = app.descendants(matching: .any)["parity.identityVerified"]
        guard verified.waitForExistence(timeout: 45),
              (verified.value as? String)?.caseInsensitiveCompare(c.3) == .orderedSame else {
            app.terminate()
            throw NSError(domain: "PlayarrKeyboardFocus", code: 1, userInfo: [NSLocalizedDescriptionKey: "The active server profile did not match the configured device-test identity."])
        }
        let contentReady = app.descendants(matching: .any)["parity.screenContentReady"]
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "true"), object: contentReady)
        guard XCTWaiter.wait(for: [ready], timeout: 45) == .completed else {
            app.terminate()
            throw NSError(domain: "PlayarrKeyboardFocus", code: 3, userInfo: [NSLocalizedDescriptionKey: "The requested screen content did not reach its ready state."])
        }
        return app
    }

    @MainActor
    private func shot(_ app: XCUIApplication, _ name: String, expected: String) throws {
        try requireParityCaptureReady(app, expectedUsername: expected)
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = name; a.lifetime = .keepAlways
        add(a)
    }

    private func requireIdentity(_ app: XCUIApplication, expected: String) throws {
        let profile = app.descendants(matching: .any)["parity.identityVerified"]
        guard profile.exists,
              (profile.value as? String)?.caseInsensitiveCompare(expected) == .orderedSame else {
            app.terminate()
            throw NSError(domain: "PlayarrKeyboardFocus", code: 6, userInfo: [NSLocalizedDescriptionKey: "Authenticated profile changed during the focus run."])
        }
    }

    private func focusedSignature(_ app: XCUIApplication) -> String? {
        let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
        guard focused.exists else { return nil }
        return "\(focused.identifier)|\(focused.label)|\(focused.frame.origin.x),\(focused.frame.origin.y)"
    }

    @MainActor
    func testKeysMoveFocus() throws {
        let c = try credentials()
        let keys: [(String, XCUIKeyboardKey)] = [
            ("tab", .tab), ("tab", .tab), ("down", .downArrow), ("down", .downArrow), ("right", .rightArrow), ("right", .rightArrow),
            ("left", .leftArrow), ("up", .upArrow),
        ]
        for route in ["home", "movies", "series", "music", "playlists", "watchlist", "requests", "downloads", "search:Sample", "calendar-month", "calendar-week", "calendar-agenda", "settings", "profiles", "filters", "actions", "detail:movie:@first", "detail:series:@first"] {
            let app = try launch(route, c)
            let tag = route.replacingOccurrences(of: ":", with: "_")
            try requireIdentity(app, expected: c.3)
            try shot(app, "\(tag)_0_start", expected: c.3)
            for (index, key) in keys.enumerated() {
                try requireIdentity(app, expected: c.3)
                let before = focusedSignature(app)
                app.typeKey(key.1, modifierFlags: [])
                let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
                guard focused.waitForExistence(timeout: 3) else {
                    app.terminate()
                    throw NSError(domain: "PlayarrKeyboardFocus", code: 4, userInfo: [NSLocalizedDescriptionKey: "No focus target was active after \(key.0) on \(route)."])
                }
                if key.1 == .tab, index > 0, let before {
                    let after = focusedSignature(app)
                    guard after != before else {
                        app.terminate()
                        throw NSError(domain: "PlayarrKeyboardFocus", code: 12, userInfo: [NSLocalizedDescriptionKey: "Tab did not move focus to another control on \(route)."])
                    }
                }
                try requireIdentity(app, expected: c.3)
                try shot(app, "\(tag)_\(index + 1)_\(key.0)", expected: c.3)
            }
            app.terminate()
        }
    }

    @MainActor
    func testPanelsScrollToTheEnd() throws {
        let c = try credentials()
        for route in ["filters", "actions", "profiles", "settings:player"] {
            let app = try launch(route, c)
            let tag = route.replacingOccurrences(of: ":", with: "_")
            try shot(app, "\(tag)_0_top", expected: c.3)
            for step in 1...4 {
                try requireIdentity(app, expected: c.3)
                app.swipeUp(velocity: .fast)
                Thread.sleep(forTimeInterval: 0.8)
                try shot(app, "\(tag)_\(step)_swipe", expected: c.3)
            }
            app.terminate()
        }
    }

    @MainActor
    func testSelectsAndProfileMenu() throws {
        let c = try credentials()
        let filters = try launch("filters", c)
        let select = filters.buttons["library-filter-audio-language"]
        guard select.waitForExistence(timeout: 5) else { throw NSError(domain: "PlayarrKeyboardFocus", code: 13, userInfo: [NSLocalizedDescriptionKey: "The audio language selector was not available."]) }
        try requireIdentity(filters, expected: c.3); select.tap()
        let options = filters.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "library-filter-audio-language-option-"))
        guard options.firstMatch.waitForExistence(timeout: 5) else { throw NSError(domain: "PlayarrKeyboardFocus", code: 17, userInfo: [NSLocalizedDescriptionKey: "The audio language options did not open."]) }
        let firstOption = options.firstMatch
        let wasSelected = firstOption.isSelected
        try requireIdentity(filters, expected: c.3); firstOption.tap()
        let selectionChanged = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isSelected == %@", NSNumber(value: !wasSelected)),
            object: firstOption
        )
        guard XCTWaiter.wait(for: [selectionChanged], timeout: 10) == .completed else {
            throw NSError(domain: "PlayarrKeyboardFocus", code: 18, userInfo: [NSLocalizedDescriptionKey: "Choosing an audio language did not update its selected state."])
        }
        try requireParityCaptureReady(filters, expectedUsername: c.3)
        try shot(filters, "select_0_open", expected: c.3)
        for step in 1...3 { try requireIdentity(filters, expected: c.3); filters.swipeUp(velocity: .fast); Thread.sleep(forTimeInterval: 0.8); try shot(filters, "select_\(step)_swipe", expected: c.3) }
        filters.terminate()
        let home = try launch("home", c)
        let profile = home.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'profile'")).firstMatch
        guard profile.waitForExistence(timeout: 5) else { throw NSError(domain: "PlayarrKeyboardFocus", code: 14, userInfo: [NSLocalizedDescriptionKey: "The profile menu control was not available."]) }
        try requireIdentity(home, expected: c.3); profile.tap(); Thread.sleep(forTimeInterval: 1.5)
        try shot(home, "profile_0_open", expected: c.3)
        for step in 1...3 { try requireIdentity(home, expected: c.3); home.swipeUp(velocity: .fast); Thread.sleep(forTimeInterval: 0.8); try shot(home, "profile_\(step)_swipe", expected: c.3) }
        home.terminate()
    }

    /// Playback through the `play` route on the suite's pinned direct-play file (the `player` route pauses at 2.0 s by design), so the
    /// controls fade while playing: frames at 1, 3, 5 and 9 s idle, a tap to show them, space to pause, arrows, a scrub drag
    /// along the seek bar, Tab and Return.
    @MainActor
    func testPlayerControlsShowAndHide() throws {
        let c = try credentials()
        let file = c.4
        guard UUID(uuidString: file) != nil else { throw NSError(domain: "PlayarrKeyboardFocus", code: 5, userInfo: [NSLocalizedDescriptionKey: "The configured direct-play fixture ID is invalid."]) }
        let app = try launch("play", c)
        let directPlay = app.descendants(matching: .any)["parity.directPlay"]
        let direct = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "true"), object: directPlay)
        guard XCTWaiter.wait(for: [direct], timeout: 30) == .completed else {
            app.terminate()
            XCTFail("The configured fixture did not negotiate direct play.")
            throw NSError(domain: "PlayarrKeyboardFocus", code: 2)
        }
        let window = app.windows.firstMatch
        for (index, seconds) in [1.0, 2.0, 2.0, 4.0].enumerated() { Thread.sleep(forTimeInterval: seconds); try shot(app, "player_idle_\(index)", expected: c.3) }
        let centre = window.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
        try requireIdentity(app, expected: c.3); centre.tap(); Thread.sleep(forTimeInterval: 0.6); try shot(app, "player_1_tap", expected: c.3)
        Thread.sleep(forTimeInterval: 5); try shot(app, "player_2_hidden_again", expected: c.3)
        try requireIdentity(app, expected: c.3); centre.tap(); Thread.sleep(forTimeInterval: 0.6)
        let pause = app.buttons["Pause"]
        guard pause.waitForExistence(timeout: 5) else { throw NSError(domain: "PlayarrKeyboardFocus", code: 15, userInfo: [NSLocalizedDescriptionKey: "Player controls did not show a pause action."]) }
        try shot(app, "player_3_tap_show", expected: c.3)
        try requireIdentity(app, expected: c.3); pause.tap()
        guard app.buttons["Play"].waitForExistence(timeout: 5) else { throw NSError(domain: "PlayarrKeyboardFocus", code: 16, userInfo: [NSLocalizedDescriptionKey: "Pause did not change the player control to Play."]) }
        try shot(app, "player_4_paused", expected: c.3)
        try requireIdentity(app, expected: c.3); app.typeKey(.rightArrow, modifierFlags: []); Thread.sleep(forTimeInterval: 1); try shot(app, "player_5_right", expected: c.3)
        try requireIdentity(app, expected: c.3); app.typeKey(.leftArrow, modifierFlags: []); Thread.sleep(forTimeInterval: 1); try shot(app, "player_6_left", expected: c.3)
        let from = window.coordinate(withNormalizedOffset: CGVector(dx: 0.08, dy: 0.835))
        let to = window.coordinate(withNormalizedOffset: CGVector(dx: 0.6, dy: 0.835))
        try requireIdentity(app, expected: c.3); from.press(forDuration: 0.2, thenDragTo: to); Thread.sleep(forTimeInterval: 1.5); try shot(app, "player_7_scrub", expected: c.3)
        try requireIdentity(app, expected: c.3); app.typeKey(.tab, modifierFlags: []); Thread.sleep(forTimeInterval: 0.8); try shot(app, "player_8_tab", expected: c.3)
        try requireIdentity(app, expected: c.3); app.typeKey(.tab, modifierFlags: []); Thread.sleep(forTimeInterval: 0.8); try shot(app, "player_9_tab", expected: c.3)
        try requireIdentity(app, expected: c.3); app.typeKey(.return, modifierFlags: []); Thread.sleep(forTimeInterval: 1); try shot(app, "player_10_return", expected: c.3)
        app.terminate()
    }
}

@MainActor
func requireParityCaptureReady(_ app: XCUIApplication, expectedUsername: String) throws {
    let identity = app.descendants(matching: .any)["parity.identityVerified"]
    let identityPredicate = NSPredicate(format: "value ==[c] %@", expectedUsername)
    let identityReady = XCTNSPredicateExpectation(predicate: identityPredicate, object: identity)
    guard XCTWaiter.wait(for: [identityReady], timeout: 45) == .completed else {
        app.terminate()
        throw NSError(domain: "PlayarrKeyboardFocus", code: 20, userInfo: [NSLocalizedDescriptionKey: "The authenticated account did not match the configured identity."])
    }
    let screen = app.descendants(matching: .any)["parity.screenContentReady"]
    let screenReady = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", "true"), object: screen)
    guard XCTWaiter.wait(for: [screenReady], timeout: 45) == .completed else {
        app.terminate()
        throw NSError(domain: "PlayarrKeyboardFocus", code: 21, userInfo: [NSLocalizedDescriptionKey: "The requested route did not finish loading."])
    }
}
