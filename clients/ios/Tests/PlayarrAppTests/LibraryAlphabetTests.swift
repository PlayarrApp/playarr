import Foundation
import PlayarrKit
@testable import PlayarrApp
import XCTest

@MainActor
final class LibraryAlphabetTests: XCTestCase {
    func testAlphabetUsesSortTitleAndMatchesWebCompatibilityNormalization() {
        let work = Work(
            id: UUID(),
            kind: .artist,
            title: "Sample Work",
            sortTitle: " Éclair",
            addedAt: Date(),
            monitored: true,
            availability: .available
        )

        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: work), "E")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "  Ｓample"), "S")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "  ７Sample"), "#")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "  ﬀoo"), "F")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: "   42 Sample"), "#")
        XCTAssertEqual(LibraryViewModel.alphabetLetter(for: ""), "#")
    }

    func testAlphabetRailUsesCatalogueOrder() {
        XCTAssertEqual(LibraryViewModel.alphabetLetters(order: "asc").first, "#")
        XCTAssertEqual(LibraryViewModel.alphabetLetters(order: "asc").last, "Z")
        XCTAssertEqual(LibraryViewModel.alphabetLetters(order: "desc").first, "Z")
        XCTAssertEqual(LibraryViewModel.alphabetLetters(order: "desc").last, "#")
    }

    func testAlphabetJumpLoadsPagesUntilLetterAppearsWithUnknownTotal() async {
        let firstPage = (0..<200).map { work("A Sample Item \($0)") }
        let secondPage = (200..<400).map { work("A Sample Item \($0)") }
        let target = work("Z Sample Item")
        let apiClient = PagedLibraryAPIClient(items: firstPage + secondPage + [target], total: nil)
        let viewModel = LibraryViewModel(apiClient: apiClient)
        viewModel.selectedKind = .movie

        await viewModel.load()
        let result = await viewModel.firstWork(atOrAfterAlphabetLetter: "Z")

        XCTAssertEqual(result?.id, target.id)
        XCTAssertEqual(viewModel.works.count, 401)
    }

    func testAlphabetJumpFallsBackToLastLoadedWorkAtEndOfCatalogue() async {
        let firstPage = (0..<200).map { work("A Sample Item \($0)") }
        let last = work("B Sample Item")
        let apiClient = PagedLibraryAPIClient(items: firstPage + [last], total: 201)
        let viewModel = LibraryViewModel(apiClient: apiClient)
        viewModel.selectedKind = .movie

        await viewModel.load()
        let result = await viewModel.firstWork(atOrAfterAlphabetLetter: "Y")

        XCTAssertEqual(result?.id, last.id)
        XCTAssertEqual(viewModel.works.count, 201)
    }

    func testAlphabetJumpUsesTargetFromPageAlreadyLoadingEvenWhenItIsNotTheLastItem() async {
        let firstPage = (0..<200).map { work("A Sample Item \($0)") }
        let target = work("Z A Target")
        let remaining = (0..<199).map { work("Z Z Item \($0)") }
        let gate = PageResponseGate()
        let apiClient = PagedLibraryAPIClient(items: firstPage + [target] + remaining, total: 400, gate: gate)
        let viewModel = LibraryViewModel(apiClient: apiClient)
        viewModel.selectedKind = .movie
        await viewModel.load()

        let pageLoad = Task { await viewModel.loadMore() }
        await gate.waitUntilRequested()
        let jumpStarted = AsyncStream<Void>.makeStream()
        let jump = Task {
            jumpStarted.continuation.yield(())
            return await viewModel.firstWork(atOrAfterAlphabetLetter: "Z")
        }
        var startedIterator = jumpStarted.stream.makeAsyncIterator()
        _ = await startedIterator.next()
        await gate.release()

        await pageLoad.value
        let jumpedTo = await jump.value
        XCTAssertEqual(jumpedTo?.id, target.id)
        XCTAssertNotEqual(viewModel.works.last?.id, target.id)
    }

    func testAlphabetRailTracksPartiallyVisibleTopWorkAtWebTrackingLine() {
        let first = work("A Sample Item")
        let second = work("B Sample Item")
        let third = work("C Sample Item")

        XCTAssertEqual(
            LibraryViewModel.visibleWorkID(
                works: [first, second, third],
                frames: [
                    first.id: CGRect(x: 0, y: -30, width: 100, height: 100),
                    second.id: CGRect(x: 0, y: 80, width: 100, height: 100),
                    third.id: CGRect(x: 0, y: 80, width: 100, height: 100)
                ],
                viewportHeight: 800
            ),
            first.id
        )
    }

    func testAlphabetRailUsesRowBeforeTrackingLineWhenLineFallsInGridGap() {
        let preceding = work("A Sample Item")
        let following = work("B Sample Item")

        XCTAssertEqual(
            LibraryViewModel.visibleWorkID(
                works: [preceding, following],
                frames: [
                    preceding.id: CGRect(x: 0, y: 0, width: 100, height: 50),
                    following.id: CGRect(x: 0, y: 70, width: 100, height: 50)
                ],
                viewportHeight: 800
            ),
            preceding.id
        )
    }

    private func work(_ title: String) -> Work {
        Work(
            id: UUID(),
            kind: .movie,
            title: title,
            sortTitle: title,
            addedAt: Date(timeIntervalSince1970: 0),
            monitored: true,
            availability: .available
        )
    }
}

private struct PagedLibraryAPIClient: PlayarrAPIClient {
    let items: [Work]
    let total: Int64?
    var gate: PageResponseGate? = nil
    let baseURL = URL(string: "https://playarr.example")!

    func fetchHealth() async throws {}
    func fetchReadiness() async throws {}
    func fetchVersion() async throws -> VersionEnvelope { VersionEnvelope(serverVersion: "0.1.0", apiVersion: "v1") }
    func login(_ body: LoginRequest) async throws -> LoginResponse { throw APIError.unauthorized(nil) }
    func browseCatalog(
        kind: WorkKind?, genre: String?, tag: String?, sort: String?, limit: Int?, offset: Int?
    ) async throws -> CatalogPage {
        let start = offset ?? 0
        if start > 0 { await gate?.holdPage() }
        let end = min(start + (limit ?? 200), items.count)
        guard start < end else { return CatalogPage(items: [], total: total) }
        return CatalogPage(items: Array(items[start..<end]), total: total)
    }
    func searchCatalog(query: String, limit: Int?) async throws -> [Work] { [] }
    func fetchWork(id: UUID) async throws -> WorkDetail { throw APIError.notFound(nil) }
    func playbackInfo(
        mediaFileID: UUID,
        containers: [String],
        videoCodecs: [String],
        audioCodecs: [String],
        maxBitrateBps: Int64?,
        profile: String?
    ) async throws -> PlaybackInfoResponse { throw APIError.notFound(nil) }
    func sendWebhook(instanceID: UUID, payload: Data) async throws {}
    func resolvedURL(forPath path: String) -> URL? { URL(string: path, relativeTo: baseURL)?.absoluteURL }
}

private actor PageResponseGate {
    private var requested = false
    private var continuation: CheckedContinuation<Void, Never>?
    private var requestWaiter: CheckedContinuation<Void, Never>?

    func holdPage() async {
        requested = true
        requestWaiter?.resume()
        requestWaiter = nil
        await withCheckedContinuation { continuation in
            self.continuation = continuation
        }
    }

    func waitUntilRequested() async {
        guard !requested else { return }
        await withCheckedContinuation { requestWaiter in
            self.requestWaiter = requestWaiter
        }
    }

    func release() {
        continuation?.resume()
        continuation = nil
    }
}
