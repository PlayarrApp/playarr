import Foundation
import Observation
import PlayarrKit

/// View model for `LibraryView`, backed by the catalog and search endpoints.
/// The filters follow the web catalogue contract, including kind, sort,
/// order, and audio or subtitle language.
@MainActor
@Observable
public final class LibraryViewModel {
    public enum ViewMode: String, CaseIterable, Sendable { case list, screen, cover, coverFlow = "cover-flow" }
    public enum SearchScope: String, CaseIterable, Sendable { case all, movie, series, site, artist, playlist }
    public enum LoadState: Equatable, Sendable {
        case idle
        case loading
        case loaded
        case empty
        case failed(String)
    }

    public private(set) var loadState: LoadState = .idle
    public private(set) var works: [Work] = []
    public private(set) var total: Int64?
    public private(set) var playlists: [Playlist] = []
    public var selectedKind: WorkKind?
    public var searchText: String = ""
    public var viewMode: ViewMode = .screen
    public var sort = "title"
    public var order = "asc"
    public var searchScope: SearchScope = .all
    public var isSearchMode = false
    public private(set) var isLoadingMore = false
    public private(set) var languageFacets: LanguageFacets?
    public private(set) var languageFacetError: String?
    public private(set) var isLoadingLanguageFacets = false
    public private(set) var selectedAudioLanguages: [String] = []
    public private(set) var selectedSubtitleLanguages: [String] = []

    /// The web library's alphabet rail uses the first ASCII letter of the
    /// accent-folded sort title, with every other initial grouped under `#`.
    static func alphabetLetter(for title: String) -> String {
        let decomposed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            .decomposedStringWithCompatibilityMapping
            .unicodeScalars
            .filter { !(0x0300...0x036F).contains(Int($0.value)) }
        guard let first = String(String.UnicodeScalarView(decomposed)).first else { return "#" }
        let initial = String(first).uppercased()
        return initial.count == 1 && initial >= "A" && initial <= "Z" ? initial : "#"
    }

    static func alphabetLetter(for work: Work) -> String {
        alphabetLetter(for: work.sortTitle.isEmpty ? work.title : work.sortTitle)
    }

    static func alphabetLetters(order: String) -> [String] {
        let letters = ["#"] + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".map(String.init)
        return order == "desc" ? Array(letters.reversed()) : letters
    }

    public var canLoadMore: Bool {
        guard searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        if let total { return Int64(works.count) < total }
        return receivedFullPage
    }

    private let apiClient: PlayarrAPIClient
    private let pageSize = 200
    private var loadRequestID = 0
    private var languageFacetRequestID = 0
    private var languageSelectionRevision = 0
    private var receivedFullPage = false

    public init(apiClient: PlayarrAPIClient) {
        self.apiClient = apiClient
    }

    /// Loads (or reloads) the current page: a catalog search if
    /// `searchText` is non-empty, otherwise a filtered/sorted browse.
    public func load() async {
        loadRequestID += 1
        let requestID = loadRequestID
        loadState = .loading
        let trimmedQuery = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if trimmedQuery.isEmpty && isSearchMode {
                works = []
                playlists = []
                total = nil
                loadState = .empty
                return
            }
            if trimmedQuery.isEmpty {
                playlists = []
                let page: CatalogPage
                if !selectedAudioLanguages.isEmpty || !selectedSubtitleLanguages.isEmpty {
                    page = try await apiClient.browseCatalog(
                        kind: selectedKind,
                        sort: sort,
                        order: order,
                        audioLang: selectedAudioLanguages,
                        subtitleLang: selectedSubtitleLanguages,
                        limit: pageSize,
                        offset: 0
                    )
                } else if let selectedKind {
                    page = try await apiClient.browseLibrary(
                        kind: selectedKind,
                        sort: sort,
                        order: order,
                        availableOnly: true,
                        limit: pageSize,
                        offset: 0
                    )
                } else {
                    page = try await apiClient.browseCatalog(
                        kind: nil, genre: nil, tag: nil, sort: sort,
                        limit: pageSize, offset: 0
                    )
                }
                guard requestID == loadRequestID else { return }
                works = selectedKind == nil ? page.items : ordered(page.items)
                total = page.total
                receivedFullPage = page.items.count == pageSize
            } else {
                async let foundWorks = apiClient.searchCatalog(query: trimmedQuery, limit: pageSize)
                async let foundPlaylists = apiClient.listPlaylists()
                let allWorks = try await foundWorks
                let allPlaylists = (try? await foundPlaylists) ?? []
                guard requestID == loadRequestID else { return }
                works = allWorks.filter { work in
                    switch searchScope {
                    case .all: true
                    case .movie: work.kind == .movie
                    case .series: work.kind == .series
                    case .site: work.kind == .site
                    case .artist: work.kind == .artist
                    case .playlist: false
                    }
                }
                playlists = (searchScope == .all || searchScope == .playlist)
                    ? allPlaylists.filter { $0.name.localizedCaseInsensitiveContains(trimmedQuery) }
                    : []
                total = nil
            }
            loadState = works.isEmpty && playlists.isEmpty ? .empty : .loaded
        } catch let error as APIError {
            if requestID == loadRequestID { loadState = .failed(error.displayMessage) }
        } catch {
            if requestID == loadRequestID { loadState = .failed(error.localizedDescription) }
        }
    }

    /// The web orders a library on the client using numeric, case-insensitive,
    /// accent-insensitive comparison of `sort_title`.
    private func ordered(_ items: [Work]) -> [Work] {
        let ascending = order == "asc"
        if sort == "date_added" {
            return items.sorted { ascending ? $0.addedAt < $1.addedAt : $0.addedAt > $1.addedAt }
        }
        let options: String.CompareOptions = [.numeric, .caseInsensitive, .diacriticInsensitive]
        return items.sorted {
            let result = ($0.sortTitle.isEmpty ? $0.title : $0.sortTitle).compare($1.sortTitle.isEmpty ? $1.title : $1.sortTitle, options: options)
            return ascending ? result == .orderedAscending : result == .orderedDescending
        }
    }

    public func loadMore() async {
        let hasLanguageFilter = !selectedAudioLanguages.isEmpty || !selectedSubtitleLanguages.isEmpty
        guard !isLoadingMore, canLoadMore, selectedKind != nil || hasLanguageFilter else { return }
        let requestID = loadRequestID
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page: CatalogPage
            if !selectedAudioLanguages.isEmpty || !selectedSubtitleLanguages.isEmpty {
                page = try await apiClient.browseCatalog(
                    kind: selectedKind,
                    sort: sort,
                    order: order,
                    audioLang: selectedAudioLanguages,
                    subtitleLang: selectedSubtitleLanguages,
                    limit: pageSize,
                    offset: works.count
                )
            } else if let selectedKind {
                page = try await apiClient.browseLibrary(
                    kind: selectedKind,
                    sort: sort,
                    order: order,
                    availableOnly: true,
                    limit: pageSize,
                    offset: works.count
                )
            } else {
                page = try await apiClient.browseCatalog(
                    kind: nil, genre: nil, tag: nil, sort: sort,
                    limit: pageSize, offset: works.count
                )
            }
            guard requestID == loadRequestID else { return }
            let existing = Set(works.map(\.id))
            works.append(contentsOf: page.items.filter { !existing.contains($0.id) })
            works = ordered(works)
            total = page.total ?? total
            receivedFullPage = page.items.count == pageSize
        } catch {
            // Keep the loaded page visible; pull-to-refresh remains available.
        }
    }

    public func loadLanguageFacets() async {
        languageFacetRequestID += 1
        let requestID = languageFacetRequestID
        isLoadingLanguageFacets = true
        languageFacetError = nil
        do {
            let facets = try await apiClient.catalogLanguages(
                kind: selectedKind,
                audioLang: selectedAudioLanguages,
                subtitleLang: selectedSubtitleLanguages
            )
            guard requestID == languageFacetRequestID else { return }
            languageFacets = facets
            isLoadingLanguageFacets = false
        } catch {
            guard requestID == languageFacetRequestID else { return }
            languageFacets = nil
            languageFacetError = error.localizedDescription
            isLoadingLanguageFacets = false
        }
    }

    public func toggleAudioLanguage(_ code: String) async {
        selectedAudioLanguages = toggled(code, in: selectedAudioLanguages)
        languageSelectionRevision += 1
        let revision = languageSelectionRevision
        await load()
        guard revision == languageSelectionRevision else { return }
        await loadLanguageFacets()
    }

    public func toggleSubtitleLanguage(_ code: String) async {
        selectedSubtitleLanguages = toggled(code, in: selectedSubtitleLanguages)
        languageSelectionRevision += 1
        let revision = languageSelectionRevision
        await load()
        guard revision == languageSelectionRevision else { return }
        await loadLanguageFacets()
    }

    public func clearLanguageFilters() async {
        selectedAudioLanguages = []
        selectedSubtitleLanguages = []
        languageSelectionRevision += 1
        let revision = languageSelectionRevision
        await load()
        guard revision == languageSelectionRevision else { return }
        await loadLanguageFacets()
    }

    private func toggled(_ code: String, in selection: [String]) -> [String] {
        if selection.contains(code) { return selection.filter { $0 != code } }
        return (selection + [code]).sorted()
    }

    /// Finds the first work at or after a rail letter in display order, paging to that work or the catalogue end.
    public func firstWork(atOrAfterAlphabetLetter letter: String) async -> Work? {
        let requestID = loadRequestID
        while !Task.isCancelled {
            guard requestID == loadRequestID else { return nil }
            if let target = Self.firstWork(atOrAfterAlphabetLetter: letter, order: order, works: works) {
                return target
            }
            // A visible-card request may already be loading the page with the target.
            while isLoadingMore {
                do {
                    try await Task.sleep(nanoseconds: 20_000_000)
                } catch {
                    return nil
                }
            }
            guard !Task.isCancelled, requestID == loadRequestID else { return nil }
            if let target = Self.firstWork(atOrAfterAlphabetLetter: letter, order: order, works: works) {
                return target
            }
            guard canLoadMore else { return works.last }
            let previousCount = works.count
            await loadMore()
            guard !Task.isCancelled, requestID == loadRequestID else { return nil }
            if works.count == previousCount {
                return Self.firstWork(atOrAfterAlphabetLetter: letter, order: order, works: works) ?? works.last
            }
        }
        return nil
    }

    static func firstWork(atOrAfterAlphabetLetter letter: String, order: String, works: [Work]) -> Work? {
        let orderedLetters = alphabetLetters(order: order)
        guard let targetPosition = orderedLetters.firstIndex(of: letter) else { return nil }
        return works.first { work in
            guard let position = orderedLetters.firstIndex(of: alphabetLetter(for: work)) else { return false }
            return position >= targetPosition
        }
    }

    static func visibleWorkID(works: [Work], frames: [UUID: CGRect], viewportHeight: CGFloat) -> UUID? {
        let trackingLine = min(64, viewportHeight * 0.1)
        let positions = works.enumerated().compactMap { index, work -> (index: Int, id: UUID, frame: CGRect)? in
            guard let frame = frames[work.id] else { return nil }
            return (index, work.id, frame)
        }
        if let crossing = positions
            .filter({ $0.frame.minY <= trackingLine && $0.frame.maxY >= trackingLine })
            .min(by: { $0.index < $1.index }) {
            return crossing.id
        }
        let visible = positions.filter { $0.frame.maxY > 0 && $0.frame.minY < viewportHeight }
        if let preceding = visible
            .filter({ $0.frame.minY <= trackingLine })
            .max(by: {
                $0.frame.minY == $1.frame.minY ? $0.index > $1.index : $0.frame.minY < $1.frame.minY
            }) {
            return preceding.id
        }
        return visible.min(by: { $0.index < $1.index })?.id
    }
}
