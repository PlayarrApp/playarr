import XCTest

final class DetailNavigationUITests: XCTestCase {
    @MainActor
    func testHomeAndSearchSeriesDetailsSelectSeriesAndRestoreTheirOrigin() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let server = environment["PLAYARR_UI_TEST_SERVER_URL"], !server.isEmpty,
              let username = environment["PLAYARR_UI_TEST_USERNAME"], !username.isEmpty,
              let password = environment["PLAYARR_UI_TEST_PASSWORD"], !password.isEmpty else {
            throw XCTSkip("The iOS UI test account is unavailable in this runner.")
        }

        let app = XCUIApplication()
        app.launchEnvironment = [
            "PLAYARR_PARITY_SERVER": server,
            "PLAYARR_PARITY_USER": username,
            "PLAYARR_PARITY_PASSWORD": password,
            "PLAYARR_PARITY_EXPECTED_USERNAME": username,
            "PLAYARR_PARITY_ROUTE": "home",
            "PLAYARR_PARITY_SELECT_HOME_SERIES": "1",
        ]
        app.launch()
        try requireParityCaptureReady(app, expectedUsername: username)

        let homeTab = app.buttons["phone-tab-home"]
        let searchTab = app.buttons["phone-tab-search"]
        let seriesTab = app.buttons["phone-tab-series"]
        let detailBack = app.buttons["detail-back"]
        let homeSeries = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "home-series-work-")
        ).firstMatch

        XCTAssertTrue(homeSeries.waitForExistence(timeout: 60), "Home must show a Series card.")
        let prefix = "home-series-work-"
        let workID = String(homeSeries.identifier.dropFirst(prefix.count))
        let title = homeSeries.label
        XCTAssertFalse(title.isEmpty, "The Home Series card must expose its title.")
        // The element tap performs XCTest's system-wide interrupting-element check.
        // A coordinate tap targets the already-visible card directly, avoiding that
        // unrelated System application accessibility query on the hosted simulator.
        tap(until: detailBack, "The selected Series detail must open.") {
            if homeSeries.exists { homeSeries.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap() }
        }
        try requireParityCaptureReady(app, expectedUsername: username)
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 30), "The selected Series detail must open.")
        XCTAssertTrue(seriesTab.waitForExistence(timeout: 30))
        assertSelected(seriesTab)
        tap(until: homeSeries, "Back must restore Home.") { if detailBack.exists { detailBack.tap() } }
        try requireParityCaptureReady(app, expectedUsername: username)
        assertSelected(homeTab)

        searchTab.tap()
        try requireParityCaptureReady(app, expectedUsername: username)
        let searchField = app.textFields["search-field"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 30))
        searchField.tap()
        searchField.typeText(title + "\n")

        let result = app.buttons["search-work-\(workID)"]
        XCTAssertTrue(result.waitForExistence(timeout: 60), "Search must return the same Series.")
        tap(until: detailBack, "Search result detail must open.") { if result.exists { result.tap() } }
        try requireParityCaptureReady(app, expectedUsername: username)
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 30))
        assertSelected(seriesTab)
        tap(until: searchField, "Back must restore Search.") { if detailBack.exists { detailBack.tap() } }
        try requireParityCaptureReady(app, expectedUsername: username)
        XCTAssertEqual(searchField.value as? String, title)
        assertSelected(searchTab)
    }

    /// A tap on a loaded CI simulator can be swallowed mid-transition. Retry the tap until its
    /// outcome (`target`) exists, instead of asserting after a single tap and a fixed wait.
    @MainActor
    private func tap(until target: XCUIElement, _ message: String, _ action: () -> Void,
                     file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<3 {
            action()
            if target.waitForExistence(timeout: 20) { return }
        }
        XCTFail(message, file: file, line: line)
    }

    @MainActor
    private func assertSelected(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 60), .completed, file: file, line: line)
    }
}
