import XCTest

/// Renders iPad Home and Movies for the artwork settings (Home screen artwork and Artwork size) by passing the two
/// defaults as launch arguments; screenshots only, run by the poster-mode capture workflow.
final class PosterModeCaptureUITests: XCTestCase {
    @MainActor
    func testPosterModes() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["PLAYARR_POSTER_MODE_CAPTURE"] == "1",
              let server = environment["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let username = environment["PLAYARR_UI_TEST_USERNAME"], !username.isEmpty,
              let password = environment["PLAYARR_UI_TEST_PASSWORD"], !password.isEmpty else {
            throw XCTSkip("Runs only in the poster-mode capture workflow.")
        }
        let cases: [(String, String, String)] = [
            ("cover-medium", "cover", "medium"), ("cover-small", "cover", "small"), ("cover-large", "cover", "large"),
        ]
        for (name, view, size) in cases {
            for route in ["home"] {
                let app = XCUIApplication()
                app.launchArguments = ["-com.playarr.ios.homeView", view, "-com.playarr.ios.artworkSize", size]
                app.launchEnvironment = [
                    "PLAYARR_PARITY_SERVER": server, "PLAYARR_PARITY_USER": username, "PLAYARR_PARITY_PASSWORD": password,
                    "PLAYARR_PARITY_ROUTE": route,
                ]
                app.launch()
                _ = app.windows.firstMatch.waitForExistence(timeout: 30)
                Thread.sleep(forTimeInterval: 12)
                let shot = XCTAttachment(screenshot: app.screenshot())
                shot.name = "\(name)-\(route)"
                shot.lifetime = .keepAlways
                add(shot)
                app.terminate()
            }
        }
    }
}
