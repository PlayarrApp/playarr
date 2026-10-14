import XCTest
@testable import PlayarrKit

@MainActor
final class DownloadGroupsTests: XCTestCase {
    private func episode(_ work: UUID, season: Int, episode: Int, state: DownloadState = .completed) -> DownloadRecord {
        let record = DownloadRecord(mediaFileID: UUID(), workID: work, title: "E\(episode)")
        record.workKind = "series"; record.seriesTitle = "Show"; record.seasonNumber = season; record.episodeNumber = episode
        record.state = state; record.totalBytes = 100; record.bytesWritten = state == .completed ? 100 : 40
        return record
    }

    func testGroupsSeriesSeasonEpisodeInOrder() {
        let work = UUID()
        let movie = DownloadRecord(mediaFileID: UUID(), workID: UUID(), title: "Film")
        let items = DownloadGroups.tree([episode(work, season: 2, episode: 1), movie, episode(work, season: 1, episode: 2), episode(work, season: 1, episode: 1)])
        XCTAssertEqual(items.count, 2)
        guard case .series(let series) = items[0] else { return XCTFail("series first (placed where its first member appeared)") }
        XCTAssertEqual(series.seasons.map(\.seasonNumber), [1, 2])
        XCTAssertEqual(series.seasons[0].episodes.map(\.episodeNumber), [1, 2])
        if case .record = items[1] {} else { XCTFail("the film stays a flat record") }
    }

    func testAggregateCountsAndPercent() {
        let work = UUID()
        let aggregate = DownloadGroups.aggregate([episode(work, season: 1, episode: 1), episode(work, season: 1, episode: 2, state: .downloading)])
        XCTAssertEqual(aggregate.ready, 1)
        XCTAssertEqual(aggregate.running, 1)
        XCTAssertEqual(aggregate.percent, 70)
    }

    func testFiltersAndSort() {
        let work = UUID()
        let done = episode(work, season: 1, episode: 1)
        let active = episode(work, season: 1, episode: 2, state: .downloading)
        var filters = DownloadFilters()
        filters.status = .downloading
        XCTAssertEqual(DownloadGroups.filterAndSort([done, active], filters).count, 1)
        filters.status = .all; filters.kind = .movies
        XCTAssertTrue(DownloadGroups.filterAndSort([done, active], filters).isEmpty)
        XCTAssertEqual(filters.activeCount, 1)
    }
}
