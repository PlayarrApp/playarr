import Foundation
import Observation
import PlayarrKit

/// View model for the catalog detail screen — `GET /api/v1/catalog/{id}`,
/// which returns the `Work` plus its full kind-specific tree
/// (seasons/episodes for a series, albums/tracks for an artist, books for
/// an author; nothing extra for a movie), plus the real, resolved
/// `media_file_id` for each playable leaf (`WorkDetail.mediaFileID` for a
/// movie's own leaf; `EpisodeDetail`/`TrackDetail`/`BookDetail.mediaFileID`
/// for series/artist/author children) — see `OpenAPISchemas.swift`'s
/// "Round D update" note for how that's wired now that the backend
/// actually resolves it (`MediaFileRepo::find_by_leaf`), which replaces
/// this screen's earlier `PlayerView`-manual-entry-only path (some sibling
/// Playarr clients' Round B passes worked around the missing cross-link by
/// reusing a movie `Work`'s own `id` as a stand-in `media_file_id`; this
/// client's Round B never did that — it left `PlayerView`'s ID field fully
/// manual instead — so there's no such substitution to remove here, only
/// the manual-only limitation itself, which `WorkDetailView` now replaces
/// with the real per-leaf id whenever one has synced).
@MainActor
@Observable
public final class WorkDetailViewModel {
    public enum LoadState: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var detail: WorkDetail?
    public private(set) var credits = WorkCredits(cast: [], crew: [])
    public private(set) var similarWorks: [Work] = []

    private let apiClient: PlayarrAPIClient
    public let workID: UUID

    public init(apiClient: PlayarrAPIClient, workID: UUID) {
        self.apiClient = apiClient
        self.workID = workID
    }

    /// Resolves the tablet's initial series detail selection from the resume target,
    /// falling back to the first playable episode in catalogue order.
    static func initialSeriesEpisode(
        seasons: [SeasonDetail],
        resumeTarget: SeriesResumeTarget?
    ) -> (season: SeasonDetail, episode: EpisodeDetail)? {
        let playable = seasons.flatMap { season in
            season.episodes.filter { $0.mediaFileID != nil }.map { (season, $0) }
        }
        if let target = resumeTarget,
           let next = playable.first(where: { $0.1.id == target.episodeID })
            ?? playable.first(where: { $0.1.mediaFileID == target.mediaFileID }) {
            return (next.0, next.1)
        }
        guard let first = playable.first else { return nil }
        return (first.0, first.1)
    }

    public func load() async {
        loadState = .loading
        do {
            async let fetchedDetail = apiClient.fetchWork(id: workID)
            async let fetchedCredits = apiClient.fetchWorkCredits(id: workID)
            async let fetchedSimilar = apiClient.fetchSimilarWorks(id: workID, limit: 20)
            detail = try await fetchedDetail
            loadState = .loaded
            credits = (try? await fetchedCredits) ?? WorkCredits(cast: [], crew: [])
            let similar = ((try? await fetchedSimilar) ?? []).filter { $0.id != workID && ($0.kind == .movie || $0.kind == .series) }
            similarWorks = similar.isEmpty ? await genreFallback(for: detail?.work) : similar
        } catch let error as APIError {
            loadState = .failed(error.displayMessage)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }

    /// Web fallback when `/similar` is empty: library titles ranked by shared genres, kind, then year.
    private func genreFallback(for target: Work?) async -> [Work] {
        guard let target else { return [] }
        var pages: [CatalogPage] = []
        if target.genres.isEmpty {
            if let page = try? await apiClient.browseCatalog(kind: target.kind, sort: "date_added", limit: 100) { pages = [page] }
        } else {
            for genre in target.genres.prefix(3) {
                if let page = try? await apiClient.browseCatalog(genre: genre, limit: 100) { pages.append(page) }
            }
        }
        var candidates: [UUID: Work] = [:]
        for work in pages.flatMap(\.items)
        where work.id != target.id && (work.kind == .movie || work.kind == .series) && work.availability == .available {
            candidates[work.id] = work
        }
        let genres = Set(target.genres.map { $0.trimmingCharacters(in: .whitespaces).lowercased() })
        func year(_ work: Work) -> Double? { work.releaseDate.flatMap { Double($0.prefix(4)) } }
        func score(_ work: Work) -> Double {
            let shared = work.genres.filter { genres.contains($0.trimmingCharacters(in: .whitespaces).lowercased()) }.count
            let near = year(target).flatMap { t in year(work).map { max(0, 5 - abs(t - $0) / 5) } } ?? 0
            return Double(shared) * 100 + (work.kind == target.kind ? 10 : 0) + near
        }
        return Array(
            candidates.values.sorted { score($0) != score($1) ? score($0) > score($1) : $0.sortTitle < $1.sortTitle }.prefix(20)
        )
    }
}
