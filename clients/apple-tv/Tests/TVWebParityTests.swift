import Foundation
import PlayarrKit
import XCTest
@testable import PlayarrTV

/// Locks the pieces of the web parity work that are pure functions.
final class TVWebParityTests: XCTestCase {
    func testAppearanceSegmentsFillTheSettingsDetailColumnEqually() {
        XCTAssertEqual(TVSettingsAppearanceLayout.equalSegmentWidths(count: 3), [347.2, 347.2, 347.2])
        XCTAssertEqual(TVSettingsAppearanceLayout.equalSegmentWidths(count: 2), [520.8, 520.8])
        XCTAssertEqual(TVSettingsAppearanceLayout.equalSegmentWidths(count: 2, in: 995), [497.5, 497.5])
        XCTAssertEqual(TVSettingsAppearanceLayout.equalSegmentWidths(count: 0), [])
    }

    func testLibraryRowsUseTheMeasuredWebCardPitch() {
        XCTAssertEqual(DesignTokens.Shell.libraryCardPitchY, 240.4, accuracy: 0.001)
    }

    /// Web `orderWorks`: numeric, case-insensitive order on the sort title ("2" before "10").
    func testLibraryTitleOrderIsNumericLikeTheWeb() {
        func work(_ title: String) -> Work {
            Work(id: UUID(), kind: .movie, title: title, sortTitle: title, addedAt: Date(), monitored: false, availability: .available)
        }
        let titles = ["Title 10", "title 2", "Title 1"].map(work)
        XCTAssertEqual(TVLibraryKindView.ordered(titles, sort: "title", order: "asc").map(\.title), ["Title 1", "title 2", "Title 10"])
        XCTAssertEqual(TVLibraryKindView.ordered(titles, sort: "title", order: "desc").map(\.title), ["Title 10", "title 2", "Title 1"])
    }

    func testMacDetailBackPopsToTheLibraryRootWithoutChangingSelection() {
        let detail = Work(
            id: UUID(), kind: .series, title: "Test Series A", sortTitle: "Test Series A",
            addedAt: Date(), monitored: false, availability: .available
        )
        var state = TVShellBackState(selection: .series, path: [.work(detail)])

        XCTAssertTrue(state.handleBack())
        XCTAssertTrue(state.path.isEmpty, "Back from a pushed detail route returns to the library root")
        XCTAssertEqual(state.selection, .series, "popping detail preserves its originating library tab")
    }

    func testMacBackLeavesModalAndCoverHandlingAheadOfRoutePop() {
        let detail = Work(
            id: UUID(), kind: .series, title: "Test Series A", sortTitle: "Test Series A",
            addedAt: Date(), monitored: false, availability: .available
        )

        for state in [
            TVShellBackState(selection: .series, path: [.work(detail)], actionsPresented: true),
            TVShellBackState(selection: .series, path: [.work(detail)], playerPresented: true),
            TVShellBackState(selection: .series, path: [.work(detail)], profilesPresented: true),
        ] {
            var state = state
            XCTAssertFalse(state.handleBack())
            XCTAssertEqual(state.path.count, 1, "modal or cover Back must not pop the underlying route")
        }
    }

    func testMacBackDoesNotPopRouteUnderAFocusLayerOverlay() {
        let detail = Work(
            id: UUID(), kind: .series, title: "Test Series A", sortTitle: "Test Series A",
            addedAt: Date(), monitored: false, availability: .available
        )
        var state = TVShellBackState(selection: .series, path: [.work(detail)], focusLayer: 1)

        XCTAssertFalse(state.handleBack())
        XCTAssertEqual(state.path.count, 1, "a higher focus layer handles Back before the underlying route")
    }

    func testMacBackReturnsToHomeOnlyAtTheRootOfANonHomeTab() {
        var library = TVShellBackState(selection: .series, path: [])
        XCTAssertTrue(library.handleBack())
        XCTAssertEqual(library.selection, .home)

        var home = TVShellBackState(selection: .home, path: [])
        XCTAssertFalse(home.handleBack())
        XCTAssertEqual(home.selection, .home)
    }

    func testHomeFocusHandoffRunsOnceAtTheHomeRootPerTabEntry() {
        var handoff = TVHomeFocusHandoff()

        XCTAssertFalse(handoff.claim(isHomeRoot: false), "a detail page must not consume the Home handoff")
        XCTAssertTrue(handoff.claim(isHomeRoot: true), "the first Home rail appearance requests focus")
        XCTAssertFalse(handoff.claim(isHomeRoot: true), "rail refreshes must not steal focus")

        handoff.tabChanged(to: .movies)
        XCTAssertFalse(handoff.claim(isHomeRoot: false))
        handoff.tabChanged(to: .home)
        XCTAssertTrue(handoff.claim(isHomeRoot: true), "entering Home again starts one new handoff")
    }

    func testHomeFocusHandoffIsCancelledByUserMovementUntilTheNextRouteEntry() {
        var handoff = TVHomeFocusHandoff()
        handoff.cancel()
        XCTAssertFalse(handoff.claim(isHomeRoot: true), "a cancelled entry must not later reset user focus")

        handoff.tabChanged(to: .movies)
        handoff.tabChanged(to: .home)
        XCTAssertTrue(handoff.claim(isHomeRoot: true), "a new Home route entry arms one new focus claim")
    }

    func testHomeLeftUsesMeasuredNearestNavFrameAndRightRestoresTheLeadingCard() {
        // Production Home's leading rail/card identity is the expected 0:0 restore target.
        let sourceFocus = HomeRailCardFocus(rail: "start", workID: UUID())
        let sourceFrame = CGRect(x: 880, y: 450, width: 320, height: 180)
        let measuredNavFrames: [TVNavTab: CGRect] = [
            .home: CGRect(x: 18, y: 400, width: 64, height: 64),
            .search: CGRect(x: 18, y: 310, width: 64, height: 64),
            .series: CGRect(x: 18, y: 480, width: 64, height: 64),
            .movies: CGRect(x: 18, y: 560, width: 64, height: 64),
        ]
        var handoff = TVHomeNavFocusHandoff()

        XCTAssertEqual(handoff.begin(from: sourceFocus, frame: sourceFrame, navFrames: measuredNavFrames), .series)
        XCTAssertTrue(
            TVHomeNavFocusHandoff.allowsNavFocus(.series, activeTab: .home, navHasFocus: false, oneShotTarget: handoff.oneShotNavTarget),
            "only the geometry-selected inactive tab receives the one-shot entry exception"
        )
        XCTAssertFalse(
            TVHomeNavFocusHandoff.allowsNavFocus(.movies, activeTab: .home, navHasFocus: false, oneShotTarget: handoff.oneShotNavTarget)
        )
        XCTAssertTrue(TVHomeNavFocusHandoff.allowsNavFocus(.movies, activeTab: .home, navHasFocus: true, oneShotTarget: nil))

        XCTAssertEqual(handoff.takeReturnTarget(isHomeRoot: true), sourceFocus)
        XCTAssertNil(handoff.oneShotNavTarget, "Right consumes the one-shot target after returning to the same card")
    }

    func testHomeNavReturnTargetIsNotConsumedOutsideHomeRoot() {
        let sourceFocus = HomeRailCardFocus(rail: "start", workID: UUID())
        let sourceFrame = CGRect(x: 880, y: 450, width: 320, height: 180)
        var handoff = TVHomeNavFocusHandoff()
        _ = handoff.begin(
            from: sourceFocus,
            frame: sourceFrame,
            navFrames: [.home: CGRect(x: 18, y: 420, width: 64, height: 64)]
        )

        XCTAssertNil(handoff.takeReturnTarget(isHomeRoot: false))
        XCTAssertEqual(handoff.returnTarget, sourceFocus)
    }

    func testHomeLeftWithoutMeasuredNavFramesDoesNotArmAnArbitraryTarget() {
        var handoff = TVHomeNavFocusHandoff()
        let source = HomeRailCardFocus(rail: "start", workID: UUID())

        XCTAssertNil(handoff.begin(from: source, frame: CGRect(x: 880, y: 450, width: 320, height: 180), navFrames: [:]))
        XCTAssertNil(handoff.oneShotNavTarget)
        XCTAssertNil(handoff.returnTarget)
    }

    func testHomeLeftGeometryMatchesWebOverlapScoring() {
        let source = CGRect(x: 880, y: 450, width: 320, height: 180)
        let frames: [TVNavTab: CGRect] = [
            .home: CGRect(x: 18, y: 400, width: 64, height: 64),
            .series: CGRect(x: 18, y: 480, width: 64, height: 64),
        ]

        // Both overlap the source's vertical span. Web scores primary + 4*lateral - 0.55*overlap,
        // so the closer vertical centre wins despite its larger raw forward-axis distance being equal.
        guard let seriesScore = TVHomeNavFocusGeometry.scoreLeftCandidate(from: source, to: frames[.series]!) else {
            return XCTFail("the overlapping forward nav candidate must be scored")
        }
        XCTAssertEqual(seriesScore, 1_066.8, accuracy: 0.001)
        XCTAssertEqual(TVHomeNavFocusGeometry.nearestTarget(from: source, navFrames: frames), .series)
    }

    func testHomeLeftGeometryRejectsNonOverlappingTargetOutsideWebDirectionalCone() {
        let source = CGRect(x: 880, y: 450, width: 320, height: 180)
        let outsideCone = CGRect(x: 18, y: 1500, width: 64, height: 64)
        let insideCone = CGRect(x: 18, y: 640, width: 64, height: 64)

        XCTAssertNil(TVHomeNavFocusGeometry.scoreLeftCandidate(from: source, to: outsideCone))
        XCTAssertNil(TVHomeNavFocusGeometry.nearestTarget(from: source, navFrames: [.home: outsideCone]))
        XCTAssertNotNil(TVHomeNavFocusGeometry.scoreLeftCandidate(from: source, to: insideCone))
        XCTAssertEqual(TVHomeNavFocusGeometry.nearestTarget(from: source, navFrames: [.home: insideCone]), .home)
    }

    func testLateOnDeckUpdateCannotReplaceCapturedHomeEntryTarget() {
        let initial = HomeRailCardFocus(rail: "r0", workID: UUID())
        let lateOnDeck = HomeRailCardFocus(rail: "r0", workID: UUID())
        var latch = TVHomeInitialFocus()
        var handoff = TVHomeFocusHandoff()

        latch.capture(initial)
        XCTAssertFalse(handoff.claim(isHomeRoot: true, targetRegistered: false), "the Mac claim waits for the target registration event")
        XCTAssertTrue(handoff.pending, "an unavailable lazy target leaves the one-shot pending")
        latch.capture(lateOnDeck)

        XCTAssertTrue(latch.wasCaptured)
        XCTAssertEqual(latch.target, initial)
        XCTAssertTrue(handoff.claim(isHomeRoot: true, targetRegistered: true), "the frozen registered target can claim focus")

        var cancelled = TVHomeFocusHandoff()
        XCTAssertFalse(cancelled.claim(isHomeRoot: true, targetRegistered: false))
        cancelled.cancel()
        XCTAssertFalse(cancelled.claim(isHomeRoot: true, targetRegistered: true), "user movement cancels a late registration claim")
    }

    func testHomeOnDeckMembershipMatchesTheWebPrimaryAndKeepsServerShelves() {
        func work(_ title: String, kind: WorkKind = .movie) -> Work {
            Work(id: UUID(), kind: kind, title: title, sortTitle: title, addedAt: Date(), monitored: false, availability: .available)
        }

        let onDeck = work("Test Movie A")
        let shelfOnly = work("Test Movie B")
        let rails = TVHomeRailMembership.server(
            rails: [(title: "Server shelf", works: [onDeck, shelfOnly])],
            onDeck: [onDeck]
        )

        XCTAssertEqual(rails.map(\.title), ["On deck", "Server shelf"])
        XCTAssertEqual(rails[0].works.map(\.id), [onDeck.id])
        XCTAssertEqual(rails[1].works.map(\.id), [onDeck.id, shelfOnly.id])
    }

    func testSingleItemOnDeckRailPrecedesServerShelvesInSourceOrder() throws {
        func work(_ title: String) -> Work {
            Work(id: UUID(), kind: .movie, title: title, sortTitle: title, addedAt: Date(), monitored: false, availability: .available)
        }

        let onDeck = work("Test Movie A")
        let firstShelfItem = work("Test Movie B")
        let nextShelfItem = work("Test Movie C")
        let rails = TVHomeRailMembership.server(
            rails: [
                (title: "First server shelf", works: [firstShelfItem]),
                (title: "Next server shelf", works: [nextShelfItem]),
            ],
            onDeck: [onDeck]
        )

        let lead = try XCTUnwrap(rails.first)
        XCTAssertEqual(lead.title, "On deck")
        XCTAssertEqual(lead.works.count, 1)
        XCTAssertEqual(lead.works.first?.id, onDeck.id)

        let serverShelves = Array(rails.dropFirst())
        XCTAssertEqual(serverShelves.map(\.title), ["First server shelf", "Next server shelf"])
        XCTAssertEqual(serverShelves.first?.works.map(\.id), [firstShelfItem.id])
        XCTAssertEqual(serverShelves.dropFirst().first?.works.map(\.id), [nextShelfItem.id])
    }

    func testFallbackOnDeckCardIsNotRepeatedInTheMoviesRail() {
        func work(_ title: String, kind: WorkKind) -> Work {
            Work(id: UUID(), kind: kind, title: title, sortTitle: title, addedAt: Date(), monitored: false, availability: .available)
        }

        let series = work("Test Series A", kind: .series)
        let onDeck = work("Test Movie A", kind: .movie)
        let otherMovie = work("Test Movie B", kind: .movie)
        let rails = TVHomeRailMembership.fallback(works: [series, onDeck, otherMovie], onDeck: [onDeck])

        XCTAssertEqual(rails.map(\.title), ["On deck", "New movies"])
        XCTAssertEqual(rails[0].works.map(\.id), [onDeck.id])
        XCTAssertEqual(rails[1].works.map(\.id), [otherMovie.id])
    }

    func testHomeServerShelfWithoutOnDeckUsesEightUniqueRecentItems() {
        func work(_ title: String, addedAt: Date) -> Work {
            Work(id: UUID(), kind: .movie, title: title, sortTitle: title, addedAt: addedAt, monitored: false, availability: .available)
        }

        let newest = work("Test Movie A", addedAt: Date(timeIntervalSince1970: 3))
        let duplicate = work("Test Movie B", addedAt: Date(timeIntervalSince1970: 2))
        let older = (0..<8).map { work("Test Movie \($0)", addedAt: Date(timeIntervalSince1970: 1)) }
        let rails = TVHomeRailMembership.server(
            rails: [
                (title: "First", works: [newest, duplicate]),
                (title: "Second", works: [duplicate] + older),
            ],
            onDeck: []
        )

        XCTAssertEqual(rails.first?.title, "Start watching")
        XCTAssertEqual(rails.first?.works.map(\.id), [newest.id, duplicate.id] + older.prefix(6).map(\.id))
        XCTAssertEqual(rails.dropFirst().map(\.title), ["First", "Second"])
        XCTAssertEqual(rails.last?.works.map(\.id), [duplicate.id] + older.map(\.id))
    }

    @MainActor
    func testProductionHomeWaitsForOnDeckBeforeEnablingItsInitialRail() async {
        let work = Work(
            id: UUID(), kind: .movie, title: "Test Movie A", sortTitle: "Test Movie A",
            addedAt: Date(), monitored: false, availability: .available
        )
        let progressGate = HomeProgressGate()
        let model = TVHomeViewModel(apiClient: HomeSettleAPIClient(work: work, progressGate: progressGate))

        await model.load()
        XCTAssertEqual(model.state, .loaded)
        XCTAssertFalse(model.onDeckResolved)
        XCTAssertFalse(model.homeInitialFocusReady, "Home must not expose the fallback rail before On Deck resolves")

        await progressGate.release()
        for _ in 0..<50 where !model.onDeckResolved {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(model.onDeckResolved)
        XCTAssertTrue(model.homeInitialFocusReady)
    }

    @MainActor
    func testHomeShowsFallbackAfterOnDeckRequestFails() async {
        let work = Work(
            id: UUID(), kind: .movie, title: "Test Movie A", sortTitle: "Test Movie A",
            addedAt: Date(), monitored: false, availability: .available
        )
        let progressGate = HomeProgressGate()
        let model = TVHomeViewModel(
            apiClient: HomeSettleAPIClient(work: work, progressGate: progressGate, failProgress: true)
        )

        await model.load()
        for _ in 0..<50 where !model.homeInitialFocusReady {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(model.homeInitialFocusReady)
        XCTAssertFalse(model.onDeckResolved, "a failed request must not be reported as successful")
    }

    @MainActor
    func testCancelledOnDeckRequestCannotOverwriteTheNewerHomeSnapshot() async {
        func work(_ title: String) -> Work {
            Work(id: UUID(), kind: .movie, title: title, sortTitle: title, addedAt: Date(), monitored: false, availability: .available)
        }
        func progress(for work: Work) -> WatchProgress {
            WatchProgress(
                mediaFileID: UUID(), workID: work.id, positionMS: 50, durationMS: 100,
                state: .partWatched, updatedAt: Date()
            )
        }

        let fallback = work("Test Movie A")
        let staleDeck = work("Test Movie B")
        let currentDeck = work("Test Movie C")
        let firstRequestGate = HomeProgressGate()
        let requests = HomeProgressRequests(firstGate: firstRequestGate, laterRows: [progress(for: currentDeck)])
        let client = HomeSettleAPIClient(
            work: fallback,
            progressGate: HomeProgressGate(),
            progressRequests: requests,
            worksByID: [staleDeck.id: staleDeck, currentDeck.id: currentDeck]
        )
        let model = TVHomeViewModel(apiClient: client)

        await model.load()
        for _ in 0..<50 {
            if await requests.requestCount() >= 1 { break }
            try? await Task.sleep(for: .milliseconds(10))
        }
        await model.load()
        for _ in 0..<50 where !model.onDeckResolved {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(model.onDeck.map(\.id), [currentDeck.id])
        XCTAssertEqual(model.progress[currentDeck.id], 0.5)

        await firstRequestGate.release([progress(for: staleDeck)])
        try? await Task.sleep(for: .milliseconds(50))
        XCTAssertTrue(model.onDeckResolved, "the cancelled older request cannot change the current request status")
        XCTAssertEqual(model.onDeck.map(\.id), [currentDeck.id], "a cancelled older request cannot replace the current On Deck rail")
        XCTAssertNil(model.progress[staleDeck.id], "a cancelled older request cannot overwrite current progress")
    }

    /// Same values as the web's `defaultProfileAvatarPreset` (hash of the user id modulo six presets).
    /// Every client renders the account's server preference; the id hash is only the fallback when none is set.
    func testAvatarSourceFollowsTheServerPreference() throws {
        let user = "aefbc393-ee42-4de9-81d5-6177f8738cff"
        let hashed = TVProfileAvatar.presetIndex(for: user)

        XCTAssertEqual(TVProfileAvatarSource.resolve(preference: nil, userID: user), .preset(index: hashed))
        XCTAssertEqual(
            TVProfileAvatarSource.resolve(preference: ProfileAvatarPreference(kind: .preset, value: "alien"), userID: user),
            .preset(index: TVProfileAvatar.order.firstIndex(of: "alien")!)
        )
        // An id the web does not know falls back to the hash instead of drawing nothing.
        XCTAssertEqual(
            TVProfileAvatarSource.resolve(preference: ProfileAvatarPreference(kind: .preset, value: "unicorn"), userID: user),
            .preset(index: hashed)
        )
        let jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
        XCTAssertEqual(
            TVProfileAvatarSource.resolve(preference: ProfileAvatarPreference(kind: .custom, value: jpeg), userID: user),
            .custom(dataURL: jpeg)
        )
        XCTAssertEqual(
            TVProfileAvatarSource.resolve(preference: ProfileAvatarPreference(kind: .custom, value: "https://example.com/a.jpg"), userID: user),
            .preset(index: hashed)
        )
    }

    func testCustomAvatarDecodesAJPEGDataURL() throws {
        XCTAssertNil(TVProfileAvatarSource.image(fromDataURL: "data:image/png;base64,AAAA"))
        XCTAssertNil(TVProfileAvatarSource.image(fromDataURL: "data:image/jpeg;base64,not-an-image"))
    }

    func testAvatarPresetFollowsTheWebHash() {
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "user-1"), 1)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "user-2"), 2)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "aefbc393-ee42-4de9-81d5-6177f8738cff"), 2)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: "00000000-0000-4000-8000-000000000001"), 5)
        XCTAssertEqual(TVProfileAvatar.presetIndex(for: ""), 0)
    }

    func testSVGPathParsesRelativeAndImplicitCommands() {
        let box = TVSVGPath.parse("M10 10h20v20h-20Z").boundingRect
        XCTAssertEqual(box.minX, 10, accuracy: 0.001)
        XCTAssertEqual(box.maxX, 30, accuracy: 0.001)
        XCTAssertEqual(box.maxY, 30, accuracy: 0.001)
        // `m` followed by more pairs continues with relative line-tos.
        let moved = TVSVGPath.parse("m5 5 10 0 0 10").boundingRect
        XCTAssertEqual(moved.maxX, 15, accuracy: 0.001)
        XCTAssertEqual(moved.maxY, 15, accuracy: 0.001)
    }

    func testRuntimeAndDateFormatsMatchTheWeb() {
        XCTAssertEqual(TVWebFormat.runtime(ms: 6_000), "1 min")
        XCTAssertEqual(TVWebFormat.runtime(ms: 104 * 60_000), "1h 44m")
        XCTAssertEqual(TVWebFormat.runtime(ms: 120 * 60_000), "2h")
        XCTAssertNil(TVWebFormat.runtime(ms: nil))
        XCTAssertEqual(TVWebFormat.date("2020-06-01"), "1 Jun 2020")
        XCTAssertEqual(TVWebFormat.clock(ms: 125_000), "2:05")
    }

    func testTitleWrapBreaksAtWordBoundaries() {
        let lines = TVTextWrap.lines(
            "Sample Series 1",
            weight: 600,
            size: 69.12,
            kern: -4.98,
            width: 379.5
        )
        XCTAssertEqual(lines.joined(separator: " "), "Sample Series 1")
        XCTAssertGreaterThan(lines.count, 1)
    }
}

private actor HomeProgressGate {
    private var continuation: CheckedContinuation<[WatchProgress], Never>?
    private var releasedRows: [WatchProgress]?

    func wait() async -> [WatchProgress] {
        if let releasedRows { return releasedRows }
        return await withCheckedContinuation { continuation = $0 }
    }

    func release(_ rows: [WatchProgress] = []) {
        releasedRows = rows
        continuation?.resume(returning: rows)
        continuation = nil
    }
}

private actor HomeProgressRequests {
    private let firstGate: HomeProgressGate
    private let laterRows: [WatchProgress]
    private var requests = 0

    init(firstGate: HomeProgressGate, laterRows: [WatchProgress]) {
        self.firstGate = firstGate
        self.laterRows = laterRows
    }

    func load() async -> [WatchProgress] {
        requests += 1
        if requests == 1 { return await firstGate.wait() }
        return laterRows
    }

    func requestCount() -> Int { requests }
}

private struct HomeSettleAPIClient: PlayarrAPIClient {
    let work: Work
    let progressGate: HomeProgressGate
    var progressRequests: HomeProgressRequests? = nil
    var worksByID: [UUID: Work] = [:]
    var failProgress = false
    let baseURL = URL(string: "https://playarr.example")!

    init(
        work: Work,
        progressGate: HomeProgressGate,
        progressRequests: HomeProgressRequests? = nil,
        worksByID: [UUID: Work] = [:],
        failProgress: Bool = false
    ) {
        self.work = work
        self.progressGate = progressGate
        self.progressRequests = progressRequests
        self.worksByID = worksByID
        self.failProgress = failProgress
    }

    func fetchHealth() async throws {}
    func fetchReadiness() async throws {}
    func fetchVersion() async throws -> VersionEnvelope {
        VersionEnvelope(serverVersion: "0.1.0", apiVersion: "v1")
    }
    func login(_ body: LoginRequest) async throws -> LoginResponse { throw APIError.unauthorized(nil) }
    func browseCatalog(kind: WorkKind?, genre: String?, tag: String?, sort: String?, limit: Int?, offset: Int?) async throws -> CatalogPage {
        CatalogPage(items: [work])
    }
    func searchCatalog(query: String, limit: Int?) async throws -> [Work] { [] }
    func fetchWork(id: UUID) async throws -> WorkDetail { WorkDetail(work: worksByID[id] ?? work, children: .movie) }
    func playbackInfo(
        mediaFileID: UUID,
        containers: [String],
        videoCodecs: [String],
        audioCodecs: [String],
        maxBitrateBps: Int64?,
        profile: String?
    ) async throws -> PlaybackInfoResponse {
        PlaybackInfoResponse(mode: .direct, url: "/api/v1/playback/file", durationMS: 120_000, sessionID: nil)
    }
    func listWatchProgress() async throws -> [WatchProgress] {
        if failProgress { throw HomeProgressLoadFailure() }
        if let progressRequests { return await progressRequests.load() }
        return await progressGate.wait()
    }
    func sendWebhook(instanceID: UUID, payload: Data) async throws {}
    func resolvedURL(forPath path: String) -> URL? { URL(string: path, relativeTo: baseURL)?.absoluteURL }
}

private struct HomeProgressLoadFailure: Error {}

/// Player remote behaviour: BACK sequence, SELECT on the scrubber, focus across seeks, direct mount.
final class TVPlayerInteractionTests: XCTestCase {
    func testBackClosesMenuThenControlsThenExits() {
        var state = TVPlayerInteraction()
        state.openQualityMenu()
        XCTAssertEqual(state.back(), .closedMenu)
        XCTAssertEqual(state.focus, .quality, "focus returns to the control that opened the panel")
        XCTAssertTrue(state.controlsVisible)
        XCTAssertEqual(state.back(), .hidControls)
        XCTAssertEqual(state.back(), .exit)
    }

    func testBackWithControlsOpenHidesThemFirst() {
        var state = TVPlayerInteraction()
        XCTAssertEqual(state.back(), .hidControls)
        XCTAssertFalse(state.controlsVisible)
        XCTAssertEqual(state.back(), .exit)
    }

    func testSelectOnScrubberOnlyTogglesPlayPause() {
        var state = TVPlayerInteraction(focus: .scrubber)
        XCTAssertEqual(state.select(), .togglePlayPause)
        XCTAssertEqual(state.focus, .scrubber)
        XCTAssertFalse(state.menuOpen)
    }

    func testSelectWithHiddenControlsOnlyRevealsThem() {
        var state = TVPlayerInteraction(focus: .scrubber, controlsVisible: false)
        XCTAssertNil(state.select())
        XCTAssertTrue(state.controlsVisible)
    }

    func testScrubberKeepsFocusAcrossRepeatedSeeks() {
        var state = TVPlayerInteraction(focus: .scrubber)
        for _ in 0..<20 {
            state.seeked()
            XCTAssertEqual(state.focus, .scrubber)
        }
    }

    func testPlayMountsTheChromeDirectlyWithOnlyASpinnerWhileNegotiating() {
        XCTAssertEqual(TVPlayerStage.resolve(.idle), .chrome(videoAttached: false, spinner: true))
        XCTAssertEqual(TVPlayerStage.resolve(.negotiating), .chrome(videoAttached: false, spinner: true))
        XCTAssertEqual(TVPlayerStage.resolve(.ready), .chrome(videoAttached: true, spinner: false))
        XCTAssertEqual(TVPlayerStage.resolve(.failed("x")), .failed("x"))
    }
}
