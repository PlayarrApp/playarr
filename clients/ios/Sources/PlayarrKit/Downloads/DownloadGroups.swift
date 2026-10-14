import Foundation

/// The Downloads page's grouping, ported from web's `downloadGroups.ts`: TV downloads as series, then season, then
/// episode (sorted by number); every other kind stays a flat record. Filters and sort follow the same names as web.
public struct DownloadAggregate: Equatable {
    public var count = 0, running = 0, paused = 0, ready = 0, failed = 0
    public var bytesDownloaded: Int64 = 0
    /// nil while any total is still unknown.
    public var totalBytes: Int64?
    /// 0 to 100, or nil while a total is unknown and nothing is finished.
    public var percent: Int?
}

public struct EpisodeIdentity: Equatable {
    public var seriesTitle: String
    public var seasonNumber: Int
    public var episodeNumber: Int
}

public struct EpisodeNode {
    public var record: DownloadRecord
    public var episodeNumber: Int
}

public struct SeasonNode {
    public var key: String
    public var seasonNumber: Int
    public var episodes: [EpisodeNode]
    public var records: [DownloadRecord]
    public var aggregate: DownloadAggregate
}

public struct SeriesNode {
    public var key: String
    public var workID: UUID
    public var title: String
    public var seasons: [SeasonNode]
    public var records: [DownloadRecord]
    public var aggregate: DownloadAggregate
}

public enum DownloadListItem {
    case record(DownloadRecord)
    case series(SeriesNode)
}

public enum DownloadKindFilter: String, CaseIterable, Sendable { case all, movies, tv, music }
public enum DownloadStatusFilter: String, CaseIterable, Sendable { case all, downloading, paused, done, failed }
public enum DownloadSort: String, CaseIterable, Sendable { case recent, title, size }

public struct DownloadFilters: Equatable, Sendable {
    public var kind: DownloadKindFilter = .all
    public var status: DownloadStatusFilter = .all
    public var sort: DownloadSort = .recent
    public init() {}
    public var activeCount: Int { (kind != .all ? 1 : 0) + (status != .all ? 1 : 0) + (sort != .recent ? 1 : 0) }
}

public enum DownloadGroups {
    public static func isRunning(_ record: DownloadRecord) -> Bool {
        [.queued, .preparing, .downloading].contains(record.state)
    }

    public static func isFailed(_ record: DownloadRecord) -> Bool { record.state == .failed }

    public static func aggregate(_ records: [DownloadRecord]) -> DownloadAggregate {
        var result = DownloadAggregate()
        var total: Int64? = 0
        for record in records {
            result.count += 1
            // A finished download counts as fully fetched whatever its byte counter says.
            let size = record.totalBytes ?? (record.state == .completed ? record.bytesWritten : nil)
            result.bytesDownloaded += record.state == .completed && size != nil ? size! : record.bytesWritten
            total = (total == nil || size == nil) ? nil : total! + size!
            if isRunning(record) { result.running += 1 }
            else if record.state == .paused { result.paused += 1 }
            else if record.state == .completed { result.ready += 1 }
            else if isFailed(record) { result.failed += 1 }
        }
        result.totalBytes = total
        if let total, total > 0 {
            result.percent = min(100, Int((Double(result.bytesDownloaded) / Double(total) * 100).rounded()))
        } else if result.count > 0 && result.ready == result.count {
            result.percent = 100
        }
        return result
    }

    public static func episodeIdentity(_ record: DownloadRecord) -> EpisodeIdentity? {
        guard record.workKind == "series", let series = record.seriesTitle, let season = record.seasonNumber,
              let episode = record.episodeNumber else { return nil }
        return EpisodeIdentity(seriesTitle: series, seasonNumber: season, episodeNumber: episode)
    }

    /// Groups placed where their first member appeared, so the caller's ordering still shows through.
    public static func tree(_ records: [DownloadRecord]) -> [DownloadListItem] {
        var items: [DownloadListItem] = []
        var order: [UUID] = []
        var seasonsBySeries: [UUID: [Int: [EpisodeNode]]] = [:]
        var titles: [UUID: String] = [:]
        var firstIndex: [UUID: Int] = [:]
        for record in records {
            guard let identity = episodeIdentity(record) else { items.append(.record(record)); continue }
            if firstIndex[record.workID] == nil {
                firstIndex[record.workID] = items.count
                order.append(record.workID)
                titles[record.workID] = identity.seriesTitle
                items.append(.record(record)) // placeholder, replaced below
            }
            seasonsBySeries[record.workID, default: [:]][identity.seasonNumber, default: []]
                .append(EpisodeNode(record: record, episodeNumber: identity.episodeNumber))
        }
        for work in order {
            let seasons = (seasonsBySeries[work] ?? [:]).keys.sorted().map { number -> SeasonNode in
                let episodes = seasonsBySeries[work]![number]!.sorted { $0.episodeNumber < $1.episodeNumber }
                let recs = episodes.map(\.record)
                return SeasonNode(key: "season:\(work):\(number)", seasonNumber: number, episodes: episodes, records: recs, aggregate: aggregate(recs))
            }
            let all = seasons.flatMap(\.records)
            items[firstIndex[work]!] = .series(SeriesNode(
                key: "series:\(work)", workID: work, title: titles[work] ?? "", seasons: seasons, records: all, aggregate: aggregate(all)
            ))
        }
        return items
    }

    private static func matches(_ record: DownloadRecord, kind: DownloadKindFilter) -> Bool {
        switch kind {
        case .all: true
        case .movies: record.workKind == "movie" || record.workKind == "site"
        case .tv: record.workKind == "series"
        case .music: record.workKind == "artist"
        }
    }

    private static func matches(_ record: DownloadRecord, status: DownloadStatusFilter) -> Bool {
        switch status {
        case .all: true
        case .downloading: isRunning(record)
        case .paused: record.state == .paused
        case .done: record.state == .completed
        case .failed: isFailed(record)
        }
    }

    /// Applies kind and status, then sorts: recent is newest request first, title A to Z, size largest first.
    public static func filterAndSort(_ records: [DownloadRecord], _ filters: DownloadFilters) -> [DownloadRecord] {
        let kept = records.filter { matches($0, kind: filters.kind) && matches($0, status: filters.status) }
        let size = { (r: DownloadRecord) in r.totalBytes ?? r.bytesWritten }
        let titleOf = { (r: DownloadRecord) in (episodeIdentity(r)?.seriesTitle ?? r.title).lowercased() }
        switch filters.sort {
        case .recent: return kept.sorted { $0.createdAt > $1.createdAt }
        case .title: return kept.sorted { titleOf($0).localizedStandardCompare(titleOf($1)) == .orderedAscending }
        case .size: return kept.sorted { size($0) > size($1) }
        }
    }
}
