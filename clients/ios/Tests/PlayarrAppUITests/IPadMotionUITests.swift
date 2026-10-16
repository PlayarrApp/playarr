import XCTest

/// iPad Home scroll bursts, with a hardware keyboard: DOWN through every rail and back UP, then RIGHT to the last card in the
/// first rail; after each key five frames about 150 ms apart (names `home_<step>_<key>_<n>`), for focused-row position,
/// clipping at the top and the edge fades. Frames only, compared by eye with the web at the tablet profile; runs in the iPad
/// motion workflow, never in the normal test run.
final class IPadMotionUITests: XCTestCase {
    private func credentials() throws -> (String, String, String) {
        let e = ProcessInfo.processInfo.environment
        guard e["PLAYARR_KEYBOARD_FOCUS"] == "1", UIDevice.current.userInterfaceIdiom == .pad,
              let server = e["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let user = e["PLAYARR_UI_TEST_USERNAME"], !user.isEmpty,
              let pass = e["PLAYARR_UI_TEST_PASSWORD"], !pass.isEmpty else { throw XCTSkip("Runs only in the iPad motion workflow.") }
        return (server, user, pass)
    }

    @MainActor
    func testHomeScrollBursts() throws {
        let c = try credentials()
        let app = XCUIApplication()
        app.launchEnvironment = ["PLAYARR_PARITY_SERVER": c.0, "PLAYARR_PARITY_USER": c.1, "PLAYARR_PARITY_PASSWORD": c.2, "PLAYARR_PARITY_EXPECTED_USERNAME": c.1, "PLAYARR_PARITY_ROUTE": "home"]
        app.launch()
        _ = app.windows.firstMatch.waitForExistence(timeout: 30)
        try requireParityCaptureReady(app, expectedUsername: c.1)
        Thread.sleep(forTimeInterval: 14)
        func burst(_ name: String) throws {
            for n in 0..<5 {
                try requireParityCaptureReady(app, expectedUsername: c.1)
                let a = XCTAttachment(screenshot: app.screenshot())
                a.name = "\(name)_\(n)"; a.lifetime = .keepAlways
                add(a)
                Thread.sleep(forTimeInterval: 0.15)
            }
        }
        try burst("home_00_start")
        // Focus enters the content, then moves down every rail and back up.
        try requireParityCaptureReady(app, expectedUsername: c.1)
        app.typeKey(.tab, modifierFlags: [])
        Thread.sleep(forTimeInterval: 0.8)
        for step in 1...6 { try requireParityCaptureReady(app, expectedUsername: c.1); app.typeKey(.downArrow, modifierFlags: []); try burst("home_\(String(format: "%02d", step))_down") }
        for step in 7...12 { try requireParityCaptureReady(app, expectedUsername: c.1); app.typeKey(.upArrow, modifierFlags: []); try burst("home_\(String(format: "%02d", step))_up") }
        for step in 13...20 { try requireParityCaptureReady(app, expectedUsername: c.1); app.typeKey(.rightArrow, modifierFlags: []); try burst("home_\(String(format: "%02d", step))_right") }
        app.terminate()
    }
}
