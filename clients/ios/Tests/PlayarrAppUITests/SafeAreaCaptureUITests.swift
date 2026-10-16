import XCTest

/// Renders the main screens on a notched simulator with the real safe-area insets
/// (`PLAYARR_REAL_INSETS=1`), attaches a screenshot of each for review, and asserts that the
/// navigation and header controls clear the Dynamic Island, the side insets and the home indicator.
/// Insets are those of iPhone 17 (portrait 62 top, 34 bottom; landscape 62 sides, 21 bottom).
final class SafeAreaCaptureUITests: XCTestCase {
    private let playerRoute = "player:movie:@first"
    private let routes = ["home", "movies", "detail:movie:@first", "settings", "player:movie:@first"]

    @MainActor
    func testScreensClearTheSafeAreas() throws {
        continueAfterFailure = false
        let environment = ProcessInfo.processInfo.environment
        guard let server = environment["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let username = environment["PLAYARR_UI_TEST_USERNAME"], !username.isEmpty,
              let password = environment["PLAYARR_UI_TEST_PASSWORD"], !password.isEmpty else {
            throw XCTSkip("The iOS UI test account is unavailable in this runner.")
        }
        guard environment["PLAYARR_SAFE_AREA_CAPTURE"] == "1" else {
            throw XCTSkip("Runs only in the safe-area capture workflow.")
        }
        let phone = UIDevice.current.userInterfaceIdiom == .phone
        // shortcut: portrait only. On hosted simulators the app window does not follow a device rotation (the screenshot
        // is the portrait layout turned on its side), so landscape cannot be rendered here; revisit when it can.
        let orientations: [(String, UIDeviceOrientation)] = [("portrait", .portrait)]

        for (orientationName, orientation) in orientations {
            XCUIDevice.shared.orientation = orientation
            for route in routes {
                let app = XCUIApplication()
                app.launchEnvironment = [
                    "PLAYARR_PARITY_SERVER": server,
                    "PLAYARR_PARITY_USER": username,
                    "PLAYARR_PARITY_PASSWORD": password,
                    "PLAYARR_PARITY_ROUTE": route,
                    "PLAYARR_REAL_INSETS": "1",
                ]
                var launchArguments: [String] = []
                if route == playerRoute {
                    guard let file = environment["PLAYARR_UI_TEST_PLAY_FILE"], !file.isEmpty else {
                        XCTFail("The safe-area player capture requires the shared direct-play fixture.")
                        app.terminate()
                        return
                    }
                    launchArguments += ["--playarr-parity-play", file]
                }
                // The simulator's device rotation does not reach the app on recent iOS: the app rotates its own scene.
                if orientationName == "landscape" { launchArguments.append("--playarr-parity-landscape") }
                app.launchArguments = launchArguments
                app.launch()
                XCUIDevice.shared.orientation = orientation
                // The screen has no single ready marker across routes. Do not request a screenshot
                // until XCTest has confirmed that the app window is available.
                let window = app.windows.firstMatch
                guard window.waitForExistence(timeout: 30) else {
                    XCTFail("The app window did not become available for \(orientationName) (\(route)).")
                    app.terminate()
                    return
                }
                Thread.sleep(forTimeInterval: 12)

                if route == playerRoute {
                    XCTAssertFalse(app.staticTexts["Playback failed"].exists, "The player must not show a playback failure before capture.")
                    let play = app.buttons["Play"]
                    let pause = app.buttons["Pause"]
                    XCTAssertTrue(play.waitForExistence(timeout: 30) || pause.waitForExistence(timeout: 1), "The player controls must load before capture.")
                    let info = app.buttons["Playback info"]
                    XCTAssertTrue(info.waitForExistence(timeout: 10), "The player info control must load before capture.")
                    info.tap()
                    XCTAssertTrue(app.staticTexts["Direct play"].waitForExistence(timeout: 10), "The safe-area player must negotiate direct playback.")
                    info.tap()
                    XCTAssertFalse(app.staticTexts["Playback failed"].exists, "The player must remain healthy before the screenshot is attached.")
                    XCTAssertTrue(play.waitForExistence(timeout: 10) || pause.waitForExistence(timeout: 1), "The player controls must remain loaded before capture.")
                }

                // Diagnostic A/B only on the first home route: retain the app screenshot below as the accepted capture path.
                var diagnosticAppScreenshot: XCUIScreenshot?
                if route == "home" {
                    let appWindowSize = window.frame.size
                    XCTAssertGreaterThan(appWindowSize.width, 0, "The app window width must be positive before capture for \(orientationName) (\(route)).")
                    XCTAssertGreaterThan(appWindowSize.height, 0, "The app window height must be positive before capture for \(orientationName) (\(route)).")

                    addDiagnosticStartMarker(source: "XCUIScreen.main.screenshot", orientationName: orientationName, route: route)
                    let screenDiagnosticStart = DispatchTime.now().uptimeNanoseconds
                    let screenDiagnostic = XCUIScreen.main.screenshot()
                    let screenDiagnosticDuration = DispatchTime.now().uptimeNanoseconds - screenDiagnosticStart
                    addDiagnosticCapture(screenDiagnostic, source: "XCUIScreen.main.screenshot", durationNanoseconds: screenDiagnosticDuration, appWindowSize: appWindowSize, orientationName: orientationName, route: route)

                    addDiagnosticStartMarker(source: "app.screenshot", orientationName: orientationName, route: route)
                    let appDiagnosticStart = DispatchTime.now().uptimeNanoseconds
                    let appDiagnostic = app.screenshot()
                    let appDiagnosticDuration = DispatchTime.now().uptimeNanoseconds - appDiagnosticStart
                    addDiagnosticCapture(appDiagnostic, source: "app.screenshot", durationNanoseconds: appDiagnosticDuration, appWindowSize: appWindowSize, orientationName: orientationName, route: route)
                    diagnosticAppScreenshot = appDiagnostic
                }

                let shot = XCTAttachment(screenshot: diagnosticAppScreenshot ?? app.screenshot())
                shot.name = "\(orientationName)-\(route.replacingOccurrences(of: ":", with: "_"))"
                shot.lifetime = .keepAlways
                add(shot)
                let frame = window.frame
                XCTAssertEqual(frame.width > frame.height, orientationName == "landscape", "the app window is \(frame.size) in \(orientationName) (\(route))")

                if phone { assertClearances(app, orientationName, route) }
                if ["home", "movies", "detail:movie:@first"].contains(route) {
                    // Scrolled: page content must not appear behind the island or the notch side.
                    app.windows.firstMatch.swipeUp(velocity: .slow)
                    Thread.sleep(forTimeInterval: 2)
                    let scrolled = XCTAttachment(screenshot: app.screenshot())
                    scrolled.name = "\(orientationName)-\(route.replacingOccurrences(of: ":", with: "_"))-scrolled"
                    scrolled.lifetime = .keepAlways
                    add(scrolled)
                }
                app.terminate()
            }
        }
    }

    @MainActor
    private func addDiagnosticStartMarker(source: String, orientationName: String, route: String) {
        let marker = XCTAttachment(string: "source=\(source) phase=start")
        marker.name = "diagnostic-\(orientationName)-\(route.replacingOccurrences(of: ":", with: "_"))-\(source)-start"
        marker.lifetime = .keepAlways
        add(marker)
    }

    @MainActor
    private func addDiagnosticCapture(_ screenshot: XCUIScreenshot, source: String, durationNanoseconds: UInt64, appWindowSize: CGSize, orientationName: String, route: String) {
        let size = screenshot.image.size

        let stem = "\(orientationName)-\(route.replacingOccurrences(of: ":", with: "_"))"
        let frame = "\(Int(size.width))x\(Int(size.height))"
        let scale = screenshot.image.scale
        let pixels = "\(Int((size.width * scale).rounded()))x\(Int((size.height * scale).rounded()))"
        let delta = "\(String(format: "%.1f", size.width - appWindowSize.width))x\(String(format: "%.1f", size.height - appWindowSize.height))"
        let duration = String(format: "%.1f", Double(durationNanoseconds) / 1_000_000)
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = "diagnostic-\(stem)-\(source)-\(frame)-\(duration)ms"
        attachment.lifetime = .keepAlways
        add(attachment)

        let details = XCTAttachment(string: "source=\(source) duration_ms=\(duration) image_points=\(frame) scale=\(scale) pixels=\(pixels) app_window_points=\(Int(appWindowSize.width))x\(Int(appWindowSize.height)) delta_from_app_window_points=\(delta)")
        details.name = "diagnostic-\(stem)-\(source)-metadata"
        details.lifetime = .keepAlways
        add(details)
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
        if tab.exists, route != "player:movie:@first" {
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
