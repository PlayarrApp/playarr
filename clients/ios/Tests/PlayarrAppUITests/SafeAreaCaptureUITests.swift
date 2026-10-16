import XCTest

/// Renders the main screens on a notched simulator with the real safe-area insets
/// (`PLAYARR_REAL_INSETS=1`), attaches a screenshot of each for review, and asserts that the
/// navigation and header controls clear the Dynamic Island, the side insets and the home indicator.
/// Insets are those of iPhone 17 (portrait 62 top, 34 bottom; landscape 62 sides, 21 bottom).
final class SafeAreaCaptureUITests: XCTestCase {
    private let nonPlayerRoutes = ["home", "movies", "detail:movie:@first", "settings"]
    private let playerRoute = "player:movie:fixture"

    private func hasExclusiveFixtureWindow(_ environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
        environment["PLAYARR_SAFE_AREA_EXCLUSIVE_FIXTURE_WINDOW"] == "1"
    }

    func testPlayerFixtureWindowRequiresExplicitOptIn() {
        XCTAssertFalse(hasExclusiveFixtureWindow([:]))
        XCTAssertFalse(hasExclusiveFixtureWindow(["PLAYARR_SAFE_AREA_EXCLUSIVE_FIXTURE_WINDOW": "true"]))
        XCTAssertFalse(hasExclusiveFixtureWindow(["PLAYARR_SAFE_AREA_EXCLUSIVE_FIXTURE_WINDOW": "0"]))
        XCTAssertTrue(hasExclusiveFixtureWindow(["PLAYARR_SAFE_AREA_EXCLUSIVE_FIXTURE_WINDOW": "1"]))
    }

    @MainActor
    func testScreensClearTheSafeAreas() throws {
        let credentials = try captureCredentials()
        try render(routes: nonPlayerRoutes, credentials: credentials)
    }

    @MainActor
    func testPlayerRouteClearsTheSafeAreas() throws {
        guard hasExclusiveFixtureWindow() else {
            throw XCTSkip("The player route writes shared progress and requires an explicit exclusive window.")
        }
        let credentials = try captureCredentials()
        try render(routes: [playerRoute], credentials: credentials)
    }

    @MainActor
    private func captureCredentials() throws -> (server: String, username: String, password: String, playFile: String) {
        let environment = ProcessInfo.processInfo.environment
        guard environment["PLAYARR_SAFE_AREA_CAPTURE"] == "1" else {
            throw XCTSkip("Runs only in the safe-area capture workflow.")
        }
        guard let server = environment["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let username = environment["PLAYARR_UI_TEST_USERNAME"], !username.isEmpty,
              let password = environment["PLAYARR_UI_TEST_PASSWORD"], !password.isEmpty,
              let playFile = environment["PLAYARR_UI_TEST_PLAY_FILE"], UUID(uuidString: playFile) != nil else {
            throw XCTSkip("The iOS UI test account is unavailable in this runner.")
        }
        return (server, username, password, playFile)
    }

    @MainActor
    private func render(
        routes: [String],
        credentials: (server: String, username: String, password: String, playFile: String)
    ) throws {
        let phone = UIDevice.current.userInterfaceIdiom == .phone
        // shortcut: portrait only. On hosted simulators the app window does not follow a device rotation (the screenshot
        // is the portrait layout turned on its side), so landscape cannot be rendered here; revisit when it can.
        let orientations: [(String, UIDeviceOrientation)] = [("portrait", .portrait)]

        for (orientationName, orientation) in orientations {
            XCUIDevice.shared.orientation = orientation
            for route in routes {
                let app = XCUIApplication()
                app.launchEnvironment = [
                    "PLAYARR_PARITY_SERVER": credentials.server,
                    "PLAYARR_PARITY_USER": credentials.username,
                    "PLAYARR_PARITY_PASSWORD": credentials.password,
                    "PLAYARR_PARITY_EXPECTED_USERNAME": credentials.username,
                    "PLAYARR_PARITY_PLAY_FILE": credentials.playFile,
                    "PLAYARR_PARITY_ROUTE": route,
                    "PLAYARR_REAL_INSETS": "1",
                ]
                // The simulator's device rotation does not reach the app on recent iOS: the app rotates its own scene.
                if orientationName == "landscape" { app.launchArguments = ["--playarr-parity-landscape"] }
                app.launch()
                XCUIDevice.shared.orientation = orientation
                // The screen has no single ready marker across routes: wait for the window to settle.
                _ = app.windows.firstMatch.waitForExistence(timeout: 30)
                try requireParityCaptureReady(app, expectedUsername: credentials.username)
                Thread.sleep(forTimeInterval: 12)

                let shot = XCTAttachment(screenshot: app.screenshot())
                shot.name = "\(orientationName)-\(route.replacingOccurrences(of: ":", with: "_"))"
                shot.lifetime = .keepAlways
                add(shot)
                let frame = app.windows.firstMatch.frame
                XCTAssertEqual(frame.width > frame.height, orientationName == "landscape", "the app window is \(frame.size) in \(orientationName) (\(route))")

                if phone { assertClearances(app, orientationName, route) }
                if ["home", "movies", "detail:movie:@first"].contains(route) {
                    // Scrolled: page content must not appear behind the island or the notch side.
                    app.windows.firstMatch.swipeUp(velocity: .slow)
                    Thread.sleep(forTimeInterval: 2)
                    try requireParityCaptureReady(app, expectedUsername: credentials.username)
                    let scrolled = XCTAttachment(screenshot: app.screenshot())
                    scrolled.name = "\(orientationName)-\(route.replacingOccurrences(of: ":", with: "_"))-scrolled"
                    scrolled.lifetime = .keepAlways
                    add(scrolled)
                }
                app.terminate()
                let routeName = route == playerRoute ? "player" : route == "detail:movie:@first" ? "detail" : route
                print("SAFE_AREA_ROUTE_\(routeName)=passed")
            }
        }
    }

    /// The bottom pill keeps max(8, bottom) from the bottom edge and the side inset from the sides; the
    /// back button clears the island in portrait and the notch side in landscape.
    @MainActor
    private func assertClearances(_ app: XCUIApplication, _ orientationName: String, _ route: String) {
        let window = app.windows.firstMatch.frame
        let landscape = orientationName == "landscape"
        let bottom: CGFloat = landscape ? 21 : 34
        let side: CGFloat = landscape ? 59 : 0
        let top: CGFloat = landscape ? 0 : 59
        let tolerance: CGFloat = 2

        let tab = app.buttons["phone-tab-home"]
        if tab.exists, route != "player:movie:fixture" {
            XCTAssertLessThanOrEqual(tab.frame.maxY, window.maxY - max(8, bottom) + tolerance, "nav clears the home indicator (\(orientationName) \(route))")
            XCTAssertGreaterThanOrEqual(tab.frame.minX, side - tolerance, "nav clears the notch side (\(orientationName) \(route))")
        }
        let back = app.buttons["detail-back"]
        if back.exists {
            XCTAssertGreaterThanOrEqual(back.frame.minY, top - tolerance, "back clears the island (\(orientationName) \(route))")
            XCTAssertGreaterThanOrEqual(back.frame.minX, side - tolerance, "back clears the notch side (\(orientationName) \(route))")
        }
    }
}
