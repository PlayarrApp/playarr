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
            "PLAYARR_PARITY_ROUTE": "home",
            "PLAYARR_PARITY_SELECT_HOME_SERIES": "1",
        ]
        app.launch()

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
        homeSeries.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()

        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 30), "The selected Series detail must open.")
        XCTAssertTrue(seriesTab.waitForExistence(timeout: 30))
        assertSelected(seriesTab)
        XCTAssertTrue(detailBack.waitForExistence(timeout: 30))
        detailBack.tap()
        XCTAssertTrue(homeSeries.waitForExistence(timeout: 30), "Back must restore Home.")
        assertSelected(homeTab)

        searchTab.tap()
        let searchField = app.textFields["search-field"]
        XCTAssertTrue(searchField.waitForExistence(timeout: 30))
        searchField.tap()
        searchField.typeText(title + "\n")

        let result = app.buttons["search-work-\(workID)"]
        XCTAssertTrue(result.waitForExistence(timeout: 60), "Search must return the same Series.")
        result.tap()
        XCTAssertTrue(app.staticTexts[title].waitForExistence(timeout: 30))
        XCTAssertTrue(detailBack.waitForExistence(timeout: 30))
        assertSelected(seriesTab)
        detailBack.tap()

        XCTAssertTrue(searchField.waitForExistence(timeout: 30), "Back must restore Search.")
        XCTAssertEqual(searchField.value as? String, title)
        assertSelected(searchTab)
    }

    @MainActor
    private func assertSelected(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "isSelected == true"), object: element)
        XCTAssertEqual(XCTWaiter.wait(for: [selected], timeout: 30), .completed, file: file, line: line)
    }
}
