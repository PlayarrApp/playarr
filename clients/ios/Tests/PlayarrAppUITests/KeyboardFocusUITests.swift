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

    private func launch(_ route: String, _ c: (String, String, String)) -> XCUIApplication {
        let app = XCUIApplication()
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
    func testPlayerControlsShowAndHide() throws {
        let c = try credentials()
        let app = launch("player:movie:@first", c)
        shot(app, "player_0_start")
        let centre = app.windows.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for (index, label) in ["tap-hide", "tap-show", "space", "right", "right", "left", "tab", "tab", "return"].enumerated() {
            switch label {
            case "tap-hide", "tap-show": centre.tap()
            case "space": app.typeKey(" ", modifierFlags: [])
            case "right": app.typeKey(.rightArrow, modifierFlags: [])
            case "left": app.typeKey(.leftArrow, modifierFlags: [])
            case "tab": app.typeKey(.tab, modifierFlags: [])
            default: app.typeKey(.return, modifierFlags: [])
            }
            for frame in 0..<3 { Thread.sleep(forTimeInterval: 0.6); shot(app, "player_\(index + 1)_\(label)_\(frame)") }
        }
        Thread.sleep(forTimeInterval: 6)
        shot(app, "player_99_after_idle")
        app.terminate()
    }
}
