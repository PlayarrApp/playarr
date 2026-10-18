import XCTest

/// Renders the page headers for review against the web (#1299): iPad series and film detail and the Library; iPhone
/// film detail and a Settings section. Screenshots only; runs in the page-header capture workflow.
final class PageHeaderCaptureUITests: XCTestCase {
    @MainActor
    func testHeaders() throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["PLAYARR_PAGE_HEADER_CAPTURE"] == "1",
              let server = environment["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let username = environment["PLAYARR_UI_TEST_USERNAME"], !username.isEmpty,
              let password = environment["PLAYARR_UI_TEST_PASSWORD"], !password.isEmpty else {
            throw XCTSkip("Runs only in the page-header capture workflow.")
        }
        let pad = UIDevice.current.userInterfaceIdiom == .pad
        let routes = pad
            ? ["detail:series:@first", "detail:movie:@first", "movies", "series"]
            : ["detail:movie:@first", "detail:series:@first", "settings:player", "movies"]
        for route in routes {
            let app = XCUIApplication()
            app.launchEnvironment = [
                "PLAYARR_PARITY_SERVER": server, "PLAYARR_PARITY_USER": username, "PLAYARR_PARITY_PASSWORD": password,
                "PLAYARR_PARITY_EXPECTED_USERNAME": username,
                "PLAYARR_PARITY_ROUTE": route,
            ]
            app.launch()
            _ = app.windows.firstMatch.waitForExistence(timeout: 30)
            try requireParityCaptureReady(app, expectedUsername: username)
            Thread.sleep(forTimeInterval: 14)
            let shot = XCTAttachment(screenshot: app.screenshot())
            shot.name = route.replacingOccurrences(of: ":", with: "_")
            shot.lifetime = .keepAlways
            add(shot)
            app.terminate()
        }
    }
}
