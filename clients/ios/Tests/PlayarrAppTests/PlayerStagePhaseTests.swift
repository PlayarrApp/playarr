@testable import PlayarrApp
import XCTest

final class PlayerStagePhaseTests: XCTestCase {
    /// Pressing Play mounts the player stage immediately: no state before playback is an interstitial.
    func testEveryStateBeforePlaybackIsTheStageNotAnInterstitial() {
        XCTAssertEqual(PlayerStagePhase.resolve(nil), .stage)
        XCTAssertEqual(PlayerStagePhase.resolve(.idle), .stage)
        XCTAssertEqual(PlayerStagePhase.resolve(.loadingPlaybackInfo), .stage)
    }

    func testPlaybackAndErrorsStayInsideThePlayer() {
        XCTAssertEqual(PlayerStagePhase.resolve(.playing), .playing)
        XCTAssertEqual(PlayerStagePhase.resolve(.failed("x")), .failed("x"))
    }
}

final class PhoneNavigationSelectionTests: XCTestCase {
    #if DEBUG
    func testDirectSeriesDetailSelectsSeriesTabWithoutChangingContentDestination() {
        let contentDestination = AppDestination.detail

        XCTAssertEqual(
            contentDestination.phoneNavigationSelection(visibleDetailKind: nil, debugDetailKind: .series),
            .library(.series)
        )
        XCTAssertEqual(contentDestination, .detail)
    }

    func testDebugDetailFallbackOnlyRecognizesFilmAndSeriesRoutes() {
        XCTAssertEqual(AppDestination.debugDetailKind(for: "detail-series"), .series)
        XCTAssertEqual(AppDestination.debugDetailKind(for: "detail-film"), .movie)
        XCTAssertNil(AppDestination.debugDetailKind(for: "detail"))
        XCTAssertNil(AppDestination.debugDetailKind(for: "home"))
    }
    #endif

    func testNormalHomeAndLibraryDestinationsRemainSelected() {
        XCTAssertEqual(AppDestination.home.phoneNavigationSelection(visibleDetailKind: nil, debugDetailKind: nil), .home)
        XCTAssertEqual(
            AppDestination.library(.movie).phoneNavigationSelection(visibleDetailKind: nil, debugDetailKind: .series),
            .library(.movie)
        )
    }

    @MainActor
    func testHomeAndSearchDetailRoutesSelectSeriesAndRestoreTheirOrigin() {
        let routes = VisibleWorkDetailRoutes()
        let routeID = UUID()

        for origin in [AppDestination.home, .search] {
            XCTAssertEqual(
                origin.phoneNavigationSelection(visibleDetailKind: routes.activeKind, debugDetailKind: nil),
                origin
            )

            routes.activate(id: routeID, kind: .series)
            XCTAssertEqual(
                origin.phoneNavigationSelection(visibleDetailKind: routes.activeKind, debugDetailKind: nil),
                .library(.series)
            )

            routes.deactivate(id: routeID)
            XCTAssertEqual(
                origin.phoneNavigationSelection(visibleDetailKind: routes.activeKind, debugDetailKind: nil),
                origin
            )
        }
    }

    @MainActor
    func testNestedDetailRestoresParentKindAfterChildCloses() {
        let routes = VisibleWorkDetailRoutes()
        let parent = UUID()
        let child = UUID()

        routes.activate(id: parent, kind: .movie)
        XCTAssertEqual(routes.activeKind, .movie)

        routes.deactivate(id: parent)
        XCTAssertNil(routes.activeKind)

        routes.activate(id: child, kind: .series)
        XCTAssertEqual(routes.activeKind, .series)

        routes.deactivate(id: child)
        XCTAssertNil(routes.activeKind)

        routes.activate(id: parent, kind: .movie)
        XCTAssertEqual(routes.activeKind, .movie)

        routes.deactivate(id: parent)
        XCTAssertNil(routes.activeKind)
    }
}
