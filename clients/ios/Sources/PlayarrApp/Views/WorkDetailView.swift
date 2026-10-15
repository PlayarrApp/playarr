import PlayarrKit
import SwiftUI
import CoreText
import UIKit
import os

struct WorkDetailView: View {
    @State private var viewModel: WorkDetailViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @Environment(VisibleWorkDetailRoutes.self) private var visibleDetailRoutes: VisibleWorkDetailRoutes?
    @State private var playlists: [Playlist] = []
    @State private var playlistMessage: String?
    @State private var actionMessageTitle = "Playlists"
    @State private var watchlistListed = false
    @State private var watchlistTitleKey: String?
    @State private var watchlistBusy = false
    @State private var watchlistLoaded = false
    @State private var watchlistLoadFailed = false
    @State private var selectedAlbumID: UUID?
    @State private var selectedTabletEpisodeID: UUID?
    @State private var tabletResumeEpisodeID: UUID?
    @State private var tabletResumeAction: String?
    @State private var tabletResumePlanLoaded = false
    @State private var tabletEpisodeSelectionTouched = false
    @FocusState private var focusedTabletEpisodeID: UUID?
    @State private var initialTabletScrollWorkID: UUID?
    @State private var tabletMovieModel: WMDetailModel?
    @State private var showingTabletPlayback = false
    /// Media files this profile has any progress on; an episode with none shows the web's unseen dot.
    @State private var progressedMediaFileIDs: Set<UUID>?
    @State private var showingTabletDownload = false
    @FocusState private var playFocused: Bool
    @State private var visibleDetailRouteID = UUID()
    @State private var isVisible = false

    init(
        viewModel: WorkDetailViewModel,
        apiClient: PlayarrAPIClient,
        downloadRepository: DownloadRepository
    ) {
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
    }

    /// Builds the `DownloadCandidate` `DownloadOptionsSheet`/
    /// `DownloadRepository.enqueue` need for one playable leaf under this
    /// work — every row builder below funnels through this rather than
    /// constructing `DownloadCandidate` inline.
    private func candidate(mediaFileID: UUID, title: String, subtitle: String?, season: Int32? = nil, episode: Int32? = nil) -> DownloadCandidate {
        DownloadCandidate(
            mediaFileID: mediaFileID,
            workID: viewModel.workID,
            title: title,
            subtitle: subtitle,
            posterURLString: viewModel.detail?.work.images.first(where: { $0.kind == .poster })?.url,
            workKind: viewModel.detail?.work.kind.rawValue,
            seriesTitle: season == nil ? nil : viewModel.detail?.work.title,
            seasonNumber: season.map(Int.init),
            episodeNumber: episode.map(Int.init)
        )
    }

    var body: some View {
        Group {
            switch viewModel.loadState {
            case .idle, .loading:
                PlayarrLoadingView(title: "Loading title…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load this title", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                if let detail = viewModel.detail { detailContent(detail) }
            }
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
            guard !Task.isCancelled, isVisible else { return }
            updateVisibleDetailRoute()
            let loadedPlaylists = (try? await apiClient.listPlaylists()) ?? []
            guard !Task.isCancelled, isVisible else { return }
            playlists = loadedPlaylists
            if selectedAlbumID == nil,
               case .artist(let albums) = viewModel.detail?.children {
                selectedAlbumID = albums.first?.album.id
            }
        }
        .alert(actionMessageTitle, isPresented: Binding(
            get: { playlistMessage != nil },
            set: { if !$0 { playlistMessage = nil } }
        )) { Button("OK") { playlistMessage = nil } } message: { Text(playlistMessage ?? "") }
        .toolbarBackground(.hidden, for: .navigationBar)
        .navigationBarTitleDisplayMode(.inline)
        .playarrChromeHidden(!(viewModel.detail.map { $0.work.kind == .movie || $0.work.kind == .series } ?? false))
        .onAppear {
            isVisible = true
            updateVisibleDetailRoute()
        }
        .onChange(of: viewModel.detail?.work.kind) { _, _ in updateVisibleDetailRoute() }
        .onDisappear {
            isVisible = false
            visibleDetailRoutes?.deactivate(id: visibleDetailRouteID)
        }
    }

    private func updateVisibleDetailRoute() {
        guard isVisible, let visibleDetailRoutes else { return }
        guard let kind = viewModel.detail?.work.kind else {
            visibleDetailRoutes.deactivate(id: visibleDetailRouteID)
            return
        }
        visibleDetailRoutes.activate(id: visibleDetailRouteID, kind: kind)
    }

    private func detailContent(_ detail: WorkDetail) -> some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            ZStack(alignment: .topLeading) {
                if phone && usesWebLayout(detail) {
                    WMDetailPage(
                        detail: detail,
                        apiClient: apiClient,
                        downloadRepository: downloadRepository,
                        similar: viewModel.similarWorks,
                        onBack: { dismiss() }
                    )
                } else if phone {
                    phoneDetail(detail, proxy: proxy)
                } else {
                    tabletDetail(detail, proxy: proxy)
                }

                if !phone && (detail.work.kind == .movie || detail.work.kind == .series) {
                    tabletDetailHeader(detail, proxy: proxy)
                } else if !(phone && usesWebLayout(detail)) { Button { dismiss() } label: {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .frame(width: phone ? 42 : 46, height: phone ? 42 : 46)
                        .background(PlayarrStyle.surfaceStrong.opacity(0.7), in: Circle())
                        .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                }
                .buttonStyle(.plain)
                .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
                .padding(.top, phone ? max(56, WM.safeTop + 6) : min(76, max(38, proxy.size.height * 0.062)))
                }
            }
        }
        .background(PlayarrStyle.surface.ignoresSafeArea())
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    /// Films and series on a phone use the web mobile title page.
    private func usesWebLayout(_ detail: WorkDetail) -> Bool {
        UIDevice.current.userInterfaceIdiom == .phone && (detail.work.kind == .movie || detail.work.kind == .series)
    }

    private func phoneDetail(_ detail: WorkDetail, proxy: GeometryProxy) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                PlayarrArtwork(work: detail.work, kind: .backdrop, apiClient: apiClient)
                    .frame(height: min(520, proxy.size.height * 0.58))
                    .opacity(0.58)
                    .overlay {
                        LinearGradient(
                            colors: [.clear, PlayarrStyle.surface.opacity(0.25), PlayarrStyle.surface],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    }

                VStack(alignment: .leading, spacing: 28) {
                    detailCopy(detail, phone: true)
                    children(for: detail.children)
                    discoveryContent
                }
                .padding(.horizontal, 16)
                .offset(y: -max(150, proxy.size.height * 0.24))
                .padding(.bottom, 112 - max(-150, -proxy.size.height * 0.24))
            }
        }
        .scrollIndicators(.hidden)
        .keepInsideSafeArea()
    }

    /// Web tablet title page header (1366 pt): back circle at x 122, the library name at x 182, the title as a pink kicker below.
    private func tabletDetailHeader(_ detail: WorkDetail, proxy: GeometryProxy) -> some View {
        let scale = proxy.size.width / 1366
        // The title stops at the shell clock (stage chrome puts it at 24% of the width), as on the web.
        let room = max(0, (proxy.size.width > 1100 ? proxy.size.width * 0.24 : proxy.size.width * 0.6) - 182 * scale - 4) // the web fits the detail up to the shell clock (24% of the width)
        return ZStack(alignment: .topLeading) {
            WMHeaderCircleButton(width: 43, height: 43, glyph: "←") { dismiss() }.offset(x: 122 * scale, y: 55 * scale)
            WMTitleWithDetail(detail: detail.work.title, maxWidth: room, size: 9.92, gap: 15) {
                WMText(detail.work.kind == .movie ? "Movies" : "Series", max(19.2, 24 * scale), 520, lh: 36, ls: -1)
            }
            .offset(x: 182 * scale, y: 57 * scale)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func tabletDetail(_ detail: WorkDetail, proxy: GeometryProxy) -> some View {
        ScrollViewReader { scrollProxy in
            ZStack(alignment: .topLeading) {
                PlayarrArtwork(work: detail.work, kind: .backdrop, apiClient: apiClient)
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .opacity(scheme == .dark ? (detail.work.kind == .movie || detail.work.kind == .series ? 0.06 : 0.3) : 0.07)
                    .overlay {
                        LinearGradient(
                            colors: [PlayarrStyle.surface.opacity(0.48), .clear, PlayarrStyle.surface.opacity(0.18)],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }

                detailCopy(
                    detail,
                    phone: false,
                    tabletScale: proxy.size.width / 1366,
                    tabletVerticalScale: proxy.size.height / 1024
                )
                    .frame(width: min(proxy.size.width * 0.24, 455), alignment: .leading)
                    .padding(.leading, proxy.size.width * 0.088)
                    .padding(.top, proxy.size.height * 0.24)

                if hasVisibleChildren(detail.children) || hasDiscoveryContent || detail.work.kind == .movie {
                    ScrollView(.vertical) {
                        VStack(alignment: .leading, spacing: 30) {
                            children(for: detail.children, tabletScale: proxy.size.width / 1366)
                            if detail.work.kind == .movie {
                                tabletMovieRails(detail, tabletScale: proxy.size.width / 1366)
                            } else {
                                discoveryContent
                            }
                        }
                        .padding(.leading, proxy.size.width * 0.088)
                        .padding(.top, proxy.size.height * (detail.work.kind == .series || detail.work.kind == .movie ? 0.5 : 0.25))
                        .padding(.bottom, proxy.size.height * 0.5)
                    }
                    .frame(width: proxy.size.width * 0.62, height: proxy.size.height)
                    .background {
                        LinearGradient(
                            colors: [.clear, PlayarrStyle.surface.opacity(0.92), PlayarrStyle.surface],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    }
                    .scrollIndicators(.hidden)
                    .webEdgeFade(.vertical)
                    .offset(x: proxy.size.width * 0.38)
                    .task(id: detail.work.id) {
                        guard case .series(let seasons) = detail.children else { return }
                        // Returning from the player re-runs this task: keep the user's scroll and selection.
                        guard initialTabletScrollWorkID != detail.work.id else {
                            await loadTabletWatchlist(detail.work)
                            return
                        }
                        let firstPaint = WorkDetailViewModel.initialSeriesEpisode(seasons: seasons, resumeTarget: nil)
                        if selectedTabletEpisodeID == nil, !tabletEpisodeSelectionTouched {
                            selectedTabletEpisodeID = firstPaint?.episode.id
                            await Task.yield()
                            guard !Task.isCancelled else { return }
                            if !tabletEpisodeSelectionTouched {
                                centreTabletEpisode(scrollProxy, seasons: seasons)
                            }
                        }

                        let resumePlan = try? await apiClient.fetchSeriesResumePlan(seriesID: detail.work.id)
                        guard !Task.isCancelled else { return }
                        tabletResumeAction = resumePlan?.action
                        let initial = WorkDetailViewModel.initialSeriesEpisode(
                            seasons: seasons,
                            resumeTarget: resumePlan?.target
                        )
                        tabletResumeEpisodeID = initial?.episode.id
                        tabletResumePlanLoaded = true
                        if !tabletEpisodeSelectionTouched {
                            selectedTabletEpisodeID = initial?.episode.id
                            if initial?.episode.id != firstPaint?.episode.id {
                                await Task.yield()
                                guard !Task.isCancelled else { return }
                                if !tabletEpisodeSelectionTouched {
                                    centreTabletEpisode(scrollProxy, seasons: seasons)
                                }
                            }
                        }
                        initialTabletScrollWorkID = detail.work.id
                        await loadTabletWatchlist(detail.work)
                    }
                    .onChange(of: focusedTabletEpisodeID) { _, episodeID in
                        guard let episodeID else { return }
                        tabletEpisodeSelectionTouched = true
                        selectedTabletEpisodeID = episodeID
                    }
                }
            }
            .coordinateSpace(name: "tabletDetailLayoutDiagnostics")
            .task(id: detail.work.id) {
                guard detail.work.kind == .series, progressedMediaFileIDs == nil else { return }
                let progress = (try? await apiClient.listWatchProgress()) ?? []
                progressedMediaFileIDs = Set(progress.map(\.mediaFileID))
            }
            .task(id: detail.work.id) {
                guard detail.work.kind == .movie, tabletMovieModel == nil else { return }
                let model = WMDetailModel(apiClient: apiClient, work: detail.work)
                tabletMovieModel = model
                await model.load(mediaFileID: detail.mediaFileID, runtimeMs: detail.runtimeMs)
            }
        }
    }

    private var hasDiscoveryContent: Bool {
        !viewModel.credits.cast.isEmpty || !viewModel.credits.crew.isEmpty || !viewModel.similarWorks.isEmpty
    }

    @ViewBuilder
    private var discoveryContent: some View {
        if !viewModel.credits.cast.isEmpty {
            creditRail(title: "Cast", credits: Array(viewModel.credits.cast.prefix(16)))
        }
        if !viewModel.credits.crew.isEmpty {
            creditRail(title: "Crew", credits: Array(viewModel.credits.crew.prefix(12)))
        }
        if !viewModel.similarWorks.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text("More like this")
                    .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 12) {
                        ForEach(viewModel.similarWorks) { work in
                            NavigationLink {
                                WorkDetailView(
                                    viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                    apiClient: apiClient,
                                    downloadRepository: downloadRepository
                                )
                            } label: {
                                PlayarrMediaCard(work: work, apiClient: apiClient, width: 126)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .scrollIndicators(.hidden)
            }
        }
    }

    private func creditRail(title: String, credits: [Credit]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)
            ScrollView(.horizontal) {
                LazyHStack(spacing: 10) {
                    ForEach(credits) { credit in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(credit.person.name).font(.caption.weight(.semibold)).lineLimit(1)
                            Text(credit.character ?? credit.job ?? credit.department ?? "")
                                .font(.caption2).foregroundStyle(PlayarrStyle.muted).lineLimit(1)
                        }
                        .foregroundStyle(PlayarrStyle.ink)
                        .padding(.horizontal, 13)
                        .frame(width: 150, height: 58, alignment: .leading)
                        .background(PlayarrStyle.surfaceStrong.opacity(0.68), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
    }

    private func hasVisibleChildren(_ children: WorkChildren) -> Bool {
        switch children {
        case .movie:
            false
        case .series(let seasons):
            !seasons.isEmpty
        case .artist(let albums):
            !albums.isEmpty
        case .author(let books):
            !books.isEmpty
        }
    }

    @ViewBuilder
    private func detailCopy(
        _ detail: WorkDetail,
        phone: Bool,
        tabletScale: CGFloat = 1,
        tabletVerticalScale: CGFloat = 1
    ) -> some View {
        if !phone, detail.work.kind == .series, let selected = selectedTabletEpisode(in: detail) {
            tabletSeriesCopy(
                detail,
                selected: selected,
                tabletScale: tabletScale,
                tabletVerticalScale: tabletVerticalScale
            )
        } else if !phone, detail.work.kind == .movie {
            tabletMovieCopy(detail, tabletScale: tabletScale, tabletVerticalScale: tabletVerticalScale)
        } else {
        VStack(alignment: .leading, spacing: 0) {
            Text(detail.work.kind.displayName.uppercased())
                .font(.custom("Avenir Next", fixedSize: phone ? 10.5 : 10).weight(.heavy))
                .tracking(1.2)
                .foregroundStyle(PlayarrStyle.pink)
                .padding(.bottom, phone ? 12 : 22)

            Text(detail.work.title)
                .font(.custom("Avenir Next", fixedSize: phone ? 42 : 52).weight(.medium))
                .tracking(phone ? -3 : -3.75)
                .lineSpacing(-5)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(3)

            if !detail.work.genres.isEmpty {
                Text(detail.work.genres.prefix(3).joined(separator: "  •  "))
                    .font(.custom("Avenir Next", fixedSize: phone ? 11 : 9.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .padding(.top, phone ? 14 : 22)
            }

            if let overview = detail.work.overview, !overview.isEmpty {
                Text(overview)
                    .font(.custom("Avenir Next", fixedSize: phone ? 12 : 10.5))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineSpacing(phone ? 5 : 4)
                    .lineLimit(phone ? 5 : 6)
                    .padding(.top, phone ? 12 : 18)
            }

            if let mediaFileID = detail.mediaFileID {
                HStack(spacing: 12) {
                    NavigationLink {
                        PlayerView(
                            apiClient: apiClient,
                            downloadRepository: downloadRepository,
                            initialMediaFileID: mediaFileID.uuidString,
                            initialTitle: detail.work.title,
                            suggestionsWorkID: detail.work.id
                        )
                    } label: {
                        Label("Play", systemImage: "play.fill").frame(minWidth: 112)
                    }
                    .buttonStyle(PlayarrPrimaryButtonStyle())

                    DownloadTriggerButton(
                        candidates: [candidate(mediaFileID: mediaFileID, title: detail.work.title, subtitle: nil)],
                        apiClient: apiClient,
                        downloadRepository: downloadRepository
                    )
                    .frame(width: 46, height: 46)
                    .foregroundStyle(PlayarrStyle.ink)
                    .background(PlayarrStyle.surfaceStrong.opacity(0.82), in: Circle())
                    .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }

                    if !writablePlaylists(for: detail.work).isEmpty {
                        Menu {
                            ForEach(writablePlaylists(for: detail.work)) { playlist in
                                Button(playlist.name) { add(detail.work, to: playlist) }
                            }
                        } label: {
                            Image(systemName: "plus")
                                .frame(width: 46, height: 46)
                                .foregroundStyle(PlayarrStyle.ink)
                                .background(PlayarrStyle.surfaceStrong.opacity(0.82), in: Circle())
                                .overlay { Circle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                        }
                    }
                }
                .padding(.top, phone ? 24 : 30)
            }
        }
        }
    }

    /// Web tablet film page (1366 pt): genre kicker, a two-line title, one meta line, the synopsis, then Download,
    /// Playback and Play in a row with the watchlist and playlist pills beneath.
    private func tabletMovieCopy(_ detail: WorkDetail, tabletScale: CGFloat, tabletVerticalScale: CGFloat) -> some View {
        let work = detail.work
        let titleFont = min(80, max(35.2, 3.6 * 1366 / 100)) * tabletScale
        let titleNativeLineHeight = DesignFont.uiFont(
            family: "Nunito Sans",
            postScriptName: DesignFont.nunitoPostScriptName,
            size: titleFont,
            weight: 560,
            fixedAxes: DesignFont.nunitoAxes
        )?.lineHeight ?? titleFont * 1.36
        // CSS line-height .9: match its pitch and drop the last line's extra leading, as the series copy does.
        let titleLineHeightCorrection = titleFont * 0.9 - titleNativeLineHeight
        let metaFont = DesignFont.font(7.68 * tabletScale, 400)
        let runtime = detail.runtimeMs.map { Self.runtimeLabel($0) }
        let year = work.releaseDate.flatMap { Int($0.prefix(4)) }.map(String.init)
        let released = work.releaseDate.flatMap(Self.airDateLabel).map { "Released \($0)" }
        let meta = (["Movie", runtime, year, released] + work.genres.prefix(3).map { Optional($0) }).compactMap { $0 }
        return VStack(alignment: .leading, spacing: 0) {
            Text((work.genres.first ?? "Movie").uppercased())
                .font(DesignFont.font(8.75 * tabletScale, 820))
                .tracking(0.08 * 8.75 * tabletScale)
                .foregroundStyle(PlayarrStyle.brandInk)
                .padding(.bottom, 26 * tabletScale)
            Text(work.title)
                .font(DesignFont.font(titleFont, 560))
                .tracking(-0.072 * titleFont)
                .lineSpacing(titleLineHeightCorrection)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(2)
                .frame(maxWidth: 190 * tabletScale * 1.3, alignment: .leading)
                .padding(.bottom, titleLineHeightCorrection)
            HStack(spacing: 13.6 * tabletScale) {
                ForEach(Array(meta.enumerated()), id: \.offset) { _, item in
                    Text(item).fixedSize(horizontal: true, vertical: false)
                }
            }
            .font(metaFont)
            .foregroundStyle(PlayarrStyle.muted)
            .padding(.top, 22 * tabletVerticalScale)
            if let overview = work.overview, !overview.isEmpty {
                Text(overview)
                    .font(DesignFont.font(9.28 * tabletScale, 400))
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .lineSpacing(5 * tabletScale)
                    .lineLimit(5)
                    .frame(maxWidth: Self.nunitoChWidth(42, pointSize: 9.28 * tabletScale) ?? .infinity, alignment: .leading)
                    .padding(.top, 21.5 * tabletVerticalScale)
            }
            if let mediaFileID = detail.mediaFileID {
                VStack(alignment: .leading, spacing: 12 * tabletScale) {
                    HStack(spacing: 12.294 * tabletScale) {
                        Button { showingTabletDownload = true } label: {
                            tabletSeriesActionLabel("Download", systemImage: "arrow.down", tabletScale: tabletScale)
                        }
                        .buttonStyle(.plain)
                        Button { showingTabletPlayback = true } label: {
                            tabletSeriesActionLabel("Playback", systemImage: "slider.horizontal.3", tabletScale: tabletScale)
                        }
                        .buttonStyle(.plain)
                        NavigationLink {
                            PlayerView(
                                apiClient: apiClient,
                                downloadRepository: downloadRepository,
                                initialMediaFileID: mediaFileID.uuidString,
                                initialTitle: work.title,
                                suggestionsWorkID: work.id
                            )
                        } label: {
                            Label("Play", systemImage: "play.fill")
                                .font(DesignFont.font(8.463 * tabletScale, 610))
                                .padding(.horizontal, 21.6 * tabletScale)
                                .frame(minWidth: 116.109 * tabletScale, minHeight: 57.359 * tabletScale)
                                .background(PlayarrStyle.ink, in: Capsule())
                                .foregroundStyle(PlayarrStyle.background)
                                // Web: the film page opens with Play focused, drawn as a 3 px ring a few points off the pill.
                                .overlay {
                                    if playFocused {
                                        Capsule().stroke(scheme == .dark ? Color.white : PlayarrStyle.ink, lineWidth: 3 * tabletScale)
                                            .padding(-6 * tabletScale)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .focused($playFocused)
                        .onAppear { playFocused = true }
                    }
                    HStack(spacing: 12.294 * tabletScale) {
                        Button { Task { await tabletMovieModel?.toggleWatchlist() } } label: {
                            tabletSeriesActionLabel(
                                tabletMovieModel?.listed == true ? "Remove from watchlist" : "Add to watchlist",
                                systemImage: tabletMovieModel?.listed == true ? "checkmark" : "plus",
                                tabletScale: tabletScale
                            )
                        }
                        .buttonStyle(.plain)
                        Menu {
                            let availablePlaylists = writablePlaylists(for: work)
                            if availablePlaylists.isEmpty { Text("No playlists yet") }
                            ForEach(availablePlaylists) { playlist in
                                Button(playlist.name) { add(work, to: playlist) }
                            }
                        } label: {
                            tabletSeriesActionLabel("Add to Playlist", systemImage: "plus", tabletScale: tabletScale)
                        }
                        .fixedSize()
                    }
                }
                .fixedSize(horizontal: true, vertical: false)
                .padding(.top, 33 * tabletVerticalScale)
            }
        }
        .sheet(isPresented: $showingTabletDownload) {
            if let mediaFileID = detail.mediaFileID {
                DownloadOptionsSheet(
                    candidates: [candidate(mediaFileID: mediaFileID, title: work.title, subtitle: nil)],
                    apiClient: apiClient,
                    downloadRepository: downloadRepository
                )
            }
        }
        .sheet(isPresented: $showingTabletPlayback) {
            if let mediaFileID = detail.mediaFileID {
                PlaybackSettingsSheet(apiClient: apiClient, mediaFileID: mediaFileID, title: work.title)
            }
        }
    }

    /// Chapters then Cast with round headshots, at the web's tablet positions.
    @ViewBuilder
    private func tabletMovieRails(_ detail: WorkDetail, tabletScale: CGFloat) -> some View {
        if let model = tabletMovieModel, !model.chapters.isEmpty, let mediaFileID = detail.mediaFileID {
            VStack(alignment: .leading, spacing: 0) {
                Text("Chapters")
                    .font(DesignFont.font(12.567 * tabletScale, 610))
                    .foregroundStyle(PlayarrStyle.ink)
                Text(model.chaptersFromServer ? "\(model.chapters.count) chapters" : "\(model.chapters.count) scene markers")
                    .font(DesignFont.font(7.36 * tabletScale, 400))
                    .foregroundStyle(PlayarrStyle.muted)
                    .padding(.top, 4 * tabletScale)
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 17 * tabletScale) {
                        ForEach(model.chapters) { chapter in
                            NavigationLink {
                                PlayerView(
                                    apiClient: apiClient,
                                    downloadRepository: downloadRepository,
                                    initialMediaFileID: mediaFileID.uuidString,
                                    initialTitle: detail.work.title,
                                    suggestionsWorkID: detail.work.id
                                )
                            } label: {
                                VStack(alignment: .leading, spacing: 8 * tabletScale) {
                                    ZStack(alignment: .bottomTrailing) {
                                        WMRemoteImage(
                                            apiClient: apiClient,
                                            sources: [WMRemoteImage.Source(
                                                path: "/api/v1/media/\(mediaFileID.uuidString.lowercased())/thumbnail",
                                                query: ["position_ms": String(chapter.startMS)]
                                            )]
                                        )
                                        .frame(width: 192 * tabletScale, height: 108 * tabletScale)
                                        .background(Color.black.opacity(0.5))
                                        Text(String(format: "%02d", chapter.index + 1))
                                            .font(DesignFont.font(11 * tabletScale, 560))
                                            .foregroundStyle(.white)
                                            .padding(.trailing, 10 * tabletScale).padding(.bottom, 8 * tabletScale)
                                    }
                                    .frame(width: 192 * tabletScale, height: 108 * tabletScale)
                                    .clipShape(RoundedRectangle(cornerRadius: 10 * tabletScale, style: .continuous))
                                    HStack(spacing: 9 * tabletScale) {
                                        Text(Self.clockLabel(chapter.startMS))
                                            .font(DesignFont.font(7 * tabletScale, 700))
                                            .foregroundStyle(PlayarrStyle.muted)
                                        Text(chapter.title ?? "Chapter \(chapter.index + 1)")
                                            .font(DesignFont.font(8 * tabletScale, 610))
                                            .foregroundStyle(PlayarrStyle.ink)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.top, 26 * tabletScale)
                }
                .scrollIndicators(.hidden)
                .webEdgeFade(.horizontal)
            }
        }
        if !viewModel.credits.cast.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                Text("Cast")
                    .font(DesignFont.font(12.567 * tabletScale, 610))
                    .foregroundStyle(PlayarrStyle.ink)
                Text("\(viewModel.credits.cast.count) people")
                    .font(DesignFont.font(7.36 * tabletScale, 400))
                    .foregroundStyle(PlayarrStyle.muted)
                    .padding(.top, 4 * tabletScale)
                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 56 * tabletScale) {
                        ForEach(Array(viewModel.credits.cast.prefix(24))) { credit in
                            VStack(spacing: 6 * tabletScale) {
                                Group {
                                    if credit.person.headshotURL != nil {
                                        // The server's resizing proxy, never the metadata provider's original (as the web does).
                                        WMRemoteImage(apiClient: apiClient, sources: [WMRemoteImage.Source(
                                            path: "/api/v1/artwork/person/\(credit.person.id.uuidString.lowercased())",
                                            query: ["w": "240"]
                                        )])
                                    } else {
                                        Circle().fill(PlayarrStyle.surfaceStrong)
                                    }
                                }
                                .frame(width: 74 * tabletScale, height: 74 * tabletScale)
                                .clipShape(Circle())
                                Text(credit.person.name)
                                    .font(DesignFont.font(8 * tabletScale, 700))
                                    .foregroundStyle(PlayarrStyle.ink)
                                    .lineLimit(1)
                                Text(credit.character ?? credit.job ?? "")
                                    .font(DesignFont.font(6.4 * tabletScale, 400))
                                    .foregroundStyle(PlayarrStyle.muted)
                                    .lineLimit(1)
                            }
                            .frame(width: 74 * tabletScale)
                        }
                    }
                    .padding(.top, 30 * tabletScale)
                }
                .scrollIndicators(.hidden)
                .webEdgeFade(.horizontal)
            }
            .padding(.top, 70 * tabletScale)
        }
    }

    static func clockLabel(_ ms: Int64) -> String {
        let total = Int(ms / 1000)
        let hours = total / 3600, minutes = (total % 3600) / 60, seconds = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, seconds) : String(format: "%d:%02d", minutes, seconds)
    }

    private func selectedTabletEpisode(in detail: WorkDetail) -> (season: SeasonDetail, episode: EpisodeDetail)? {
        guard case .series(let seasons) = detail.children else { return nil }
        return seasons.first { season in
            season.episodes.contains { $0.id == selectedTabletEpisodeID }
        }.flatMap { season in
            season.episodes.first { $0.id == selectedTabletEpisodeID }.map { (season, $0) }
        }
    }

    private func tabletSeriesCopy(
        _ detail: WorkDetail,
        selected: (season: SeasonDetail, episode: EpisodeDetail),
        tabletScale: CGFloat,
        tabletVerticalScale: CGFloat
    ) -> some View {
        let seasonNumber = selected.season.season.seasonNumber
        let episode = selected.episode.episode
        let episodeTitle = episode.title ?? "Episode \(episode.episodeNumber)"
        let resumeEpisode = resumeTabletEpisode(in: detail)
        let runtime = selected.episode.runtimeMs ?? episode.runtimeMinutes.map { Int64($0) * 60_000 }
        let dateValue = episode.airDate ?? detail.work.releaseDate
        let dateLabel = dateValue.flatMap(Self.airDateLabel)
        let dateQualifier = episode.airDate == nil ? "Premiered" : "Aired"
        let yearRange = Self.tabletYearRangeLabel(releaseDate: detail.work.releaseDate, endDate: detail.work.endDate)
        let synopsis = episode.overview ?? selected.season.season.overview ?? detail.work.overview
        // These are the web's resolved CSS-pixel values at the guarded 1366px viewport, converted to native points below.
        let titleFont = min(80, max(35.2, 3.6 * 1366 / 100)) * tabletScale
        let titleWebLineHeight = titleFont * 0.9
        let titleNativeLineHeight = DesignFont.uiFont(
            family: "Nunito Sans",
            postScriptName: DesignFont.nunitoPostScriptName,
            size: titleFont,
            weight: 560,
            fixedAxes: DesignFont.nunitoAxes
        )?.lineHeight ?? UIFont(name: "AvenirNext-Medium", size: titleFont)?.lineHeight ?? titleFont
        let titleLineHeightCorrection = titleWebLineHeight - titleNativeLineHeight
        // Calibrated from run 38358999998 native frames against the guarded 1366×1024 web rectangles.
        // Each gap targets the web element's y-coordinate after accounting for the preceding native box height.
        let kickerToTitleGap = 26.484 * tabletScale // web title.y - web kicker.y - native kicker.height
        let titleToSubtitleGap = 17.982 * tabletScale // web subtitle.y - native title bottom after the measured kicker/title gap
        let subtitleToMetadataGap = 22.375 * tabletVerticalScale // web metadata.y - web subtitle.y - native subtitle.height
        let metadataToSynopsisGap = 21.5 * tabletVerticalScale // web synopsis.y - web metadata.y - native metadata.height
        let synopsisFontSize = 9.28 * tabletScale
        let synopsisUIFont = DesignFont.uiFont(
            family: "Nunito Sans",
            postScriptName: DesignFont.nunitoPostScriptName,
            size: synopsisFontSize,
            weight: 400,
            fixedAxes: DesignFont.nunitoAxes
        )
        let synopsisLayout = Self.tabletSynopsisLayoutMetrics(
            fontSize: synopsisFontSize,
            nativeLineHeight: synopsisUIFont?.lineHeight ?? synopsisFontSize,
            hasSynopsis: synopsis?.isEmpty == false
        )
        return VStack(alignment: .leading, spacing: 0) {
            Text("S\(String(format: "%02d", seasonNumber)) · E\(String(format: "%02d", episode.episodeNumber))")
                .font(DesignFont.font(8.75 * tabletScale, 820))
                .tracking(0.08 * 8.75 * tabletScale)
                .foregroundStyle(PlayarrStyle.brandInk)
                .overlay {
                    TabletDetailFrameDiagnostic(element: "kicker", isSettled: tabletResumePlanLoaded, colorScheme: scheme)
                }
                .padding(.bottom, kickerToTitleGap)
            Text(detail.work.title)
                .font(DesignFont.font(titleFont, 560))
                .tracking(-0.072 * titleFont)
                .lineSpacing(titleLineHeightCorrection)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(2)
                .overlay {
                    TabletTitleLayoutDiagnostic(
                        stage: "natural",
                        fontSize: titleFont,
                        appliedCorrection: titleLineHeightCorrection,
                        isSettled: tabletResumePlanLoaded,
                        colorScheme: scheme
                    )
                }
                // CSS uses line-height: .9. Match its line pitch and remove the final native line's extra leading.
                .padding(.bottom, titleLineHeightCorrection)
                .overlay {
                    TabletTitleLayoutDiagnostic(
                        stage: "adjusted",
                        fontSize: titleFont,
                        appliedCorrection: titleLineHeightCorrection,
                        isSettled: tabletResumePlanLoaded,
                        colorScheme: scheme
                    )
                }
            Text(episodeTitle)
                .font(DesignFont.font(15.026 * tabletScale, 570))
                .tracking(-0.035 * 15.026 * tabletScale)
                .foregroundStyle(PlayarrStyle.inkSoft)
                .lineLimit(1)
                .overlay {
                    TabletDetailFrameDiagnostic(element: "subtitle", isSettled: tabletResumePlanLoaded, colorScheme: scheme)
                }
                .padding(.top, titleToSubtitleGap)
            HStack(alignment: .firstTextBaseline, spacing: 13.6 * tabletScale) {
                Text(selected.season.season.title ?? "Season \(seasonNumber)")
                    .font(DesignFont.font(7.68 * tabletScale, 680))
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .fixedSize(horizontal: true, vertical: false)
                Text("S\(String(format: "%02d", seasonNumber)) · E\(String(format: "%02d", episode.episodeNumber))")
                    .fixedSize(horizontal: true, vertical: false)
                if let runtime, runtime > 0 { Text(Self.runtimeLabel(runtime)).fixedSize(horizontal: true, vertical: false) }
                if let yearRange { Text(yearRange).fixedSize(horizontal: true, vertical: false) }
                if let dateLabel { Text("\(dateQualifier) \(dateLabel)").fixedSize(horizontal: true, vertical: false) }
                ForEach(Array(detail.work.genres.prefix(3).enumerated()), id: \.offset) { _, genre in
                    Text(genre).fixedSize(horizontal: true, vertical: false)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .font(DesignFont.font(7.68 * tabletScale, 400))
            .foregroundStyle(PlayarrStyle.muted)
            .overlay {
                TabletDetailFrameDiagnostic(element: "metadata", isSettled: tabletResumePlanLoaded, colorScheme: scheme)
            }
            .padding(.top, subtitleToMetadataGap)
            if let synopsis, !synopsis.isEmpty {
                Text(synopsis)
                    .font(DesignFont.font(synopsisFontSize, 400))
                    .foregroundStyle(PlayarrStyle.muted)
                    .lineSpacing(synopsisLayout.lineSpacing)
                    .lineLimit(5)
                    .frame(maxWidth: Self.nunitoChWidth(42, pointSize: synopsisFontSize) ?? .infinity, alignment: .leading)
                    .overlay {
                        TabletDetailFrameDiagnostic(element: "synopsis", isSettled: tabletResumePlanLoaded, colorScheme: scheme)
                    }
                    .padding(.top, metadataToSynopsisGap)
                    .padding(.bottom, synopsisLayout.trailingPadding)
            }
            if let resumeEpisode, let mediaFileID = resumeEpisode.episode.mediaFileID {
                // Guarded web geometry measured a 116.109 x 57.359px primary action, 104px secondary minimum and 12.294px gap.
                HStack(spacing: 12.294 * tabletScale) {
                    NavigationLink {
                        PlayerView(
                            apiClient: apiClient,
                            downloadRepository: downloadRepository,
                            initialMediaFileID: mediaFileID.uuidString,
                            initialTitle: resumeEpisode.episode.episode.title ?? "Episode \(resumeEpisode.episode.episode.episodeNumber)",
                            suggestionsWorkID: detail.work.id,
                            queue: episodeFollowing(resumeEpisode.episode.id),
                            subtitle: PlaybackQueueBuilder.episodeSubtitle(
                                series: detail.work.title,
                                season: resumeEpisode.season.season.seasonNumber,
                                episode: resumeEpisode.episode.episode.episodeNumber
                            )
                        )
                    } label: {
                        Label(tabletResumeLabel, systemImage: "play.fill")
                            .font(DesignFont.font(8.463 * tabletScale, 610))
                            .padding(.horizontal, 21.6 * tabletScale)
                            .frame(minWidth: 116.109 * tabletScale, minHeight: 57.359 * tabletScale)
                            .background(PlayarrStyle.ink, in: Capsule())
                            .foregroundStyle(PlayarrStyle.background)
                    }
                    .buttonStyle(.plain)
                    .disabled(!tabletResumePlanLoaded)
                    .opacity(!tabletResumePlanLoaded ? 0.55 : 1)

                    if watchlistLoaded {
                        Button {
                            Task { await toggleWatchlist(detail.work) }
                        } label: {
                            tabletSeriesActionLabel(
                                watchlistListed ? "Remove from watchlist" : "Add to watchlist",
                                systemImage: watchlistListed ? "checkmark" : "plus",
                                tabletScale: tabletScale
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(watchlistBusy)
                    } else {
                        Button {
                            Task { await loadTabletWatchlist(detail.work) }
                        } label: {
                            tabletSeriesActionLabel(
                                watchlistLoadFailed ? "Retry watchlist" : "Loading watchlist",
                                systemImage: watchlistLoadFailed ? "arrow.clockwise" : "ellipsis",
                                tabletScale: tabletScale
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(watchlistBusy || !watchlistLoadFailed)
                    }

                    Menu {
                        let availablePlaylists = writablePlaylists(for: detail.work)
                        if availablePlaylists.isEmpty { Text("No playlists yet") }
                        ForEach(availablePlaylists) { playlist in
                            Button(playlist.name) { add(detail.work, to: playlist) }
                        }
                    } label: {
                        tabletSeriesActionLabel("Add to Playlist", systemImage: "plus", tabletScale: tabletScale)
                    }
                    .fixedSize()
                }
                .fixedSize(horizontal: true, vertical: false)
                .overlay {
                    TabletDetailFrameDiagnostic(element: "actions", isSettled: tabletResumePlanLoaded, colorScheme: scheme)
                }
                .padding(.top, synopsisLayout.actionsTopMargin * tabletVerticalScale)
            }
        }
    }

    private var tabletResumeLabel: String {
        switch tabletResumeAction {
        case .some("resume"): "Resume"
        case .some("restart"): "Watch again"
        default: "Start"
        }
    }

    private func resumeTabletEpisode(in detail: WorkDetail) -> (season: SeasonDetail, episode: EpisodeDetail)? {
        guard let id = tabletResumeEpisodeID, case .series(let seasons) = detail.children else { return nil }
        return seasons.first { season in
            season.episodes.contains { $0.id == id }
        }.flatMap { season in
            season.episodes.first { $0.id == id }.map { (season, $0) }
        }
    }

    private func tabletSeriesActionLabel(_ title: String, systemImage: String, tabletScale: CGFloat) -> some View {
        Label(title, systemImage: systemImage)
            .font(DesignFont.font(7.9228 * tabletScale, 610))
            .foregroundStyle(PlayarrStyle.ink)
            .lineLimit(1)
            .padding(.horizontal, 16 * tabletScale)
            .frame(minWidth: 104 * tabletScale, minHeight: 57.359 * tabletScale)
            .background(PlayarrStyle.surfaceStrong.opacity(0.72), in: Capsule())
            .shadow(color: PlayarrStyle.ink.opacity(0.12), radius: 19 * tabletScale)
            .contentShape(Capsule())
    }

    static func runtimeLabel(_ runtimeMs: Int64) -> String {
        let totalMinutes = max(1, Int((Double(runtimeMs) / 60_000).rounded()))
        let hours = totalMinutes / 60
        let minutes = totalMinutes % 60
        if hours == 0 { return "\(totalMinutes) min" }
        return minutes == 0 ? "\(hours)h" : "\(hours)h \(minutes)m"
    }

    static func tabletYearRangeLabel(releaseDate: String?, endDate: String?) -> String? {
        guard let releaseDate, let start = Int(releaseDate.prefix(4)) else { return nil }
        guard let endDate, let end = Int(endDate.prefix(4)), end > start else { return String(start) }
        return "\(start)–\(end)"
    }

    static func tabletSynopsisLayoutMetrics(
        fontSize: CGFloat,
        nativeLineHeight: CGFloat,
        hasSynopsis: Bool
    ) -> (lineSpacing: CGFloat, trailingPadding: CGFloat, actionsTopMargin: CGFloat) {
        guard hasSynopsis else { return (0, 0, 12) }
        // SwiftUI lineSpacing separates baselines; match the CSS line box and supply its final-line remainder.
        let lineSpacing = fontSize * 1.58 - nativeLineHeight
        return (lineSpacing, lineSpacing, 12)
    }

    private static func nunitoChWidth(_ characterCount: Int, pointSize: CGFloat) -> CGFloat? {
        guard let font = DesignFont.uiFont(
            family: "Nunito Sans",
            postScriptName: DesignFont.nunitoPostScriptName,
            size: pointSize,
            weight: 400,
            fixedAxes: DesignFont.nunitoAxes
        ) else { return nil }

        var character: UniChar = 48
        var glyph: CGGlyph = 0
        guard CTFontGetGlyphsForCharacters(font as CTFont, &character, &glyph, 1) else { return nil }
        var advance = CGSize.zero
        guard CTFontGetAdvancesForGlyphs(font as CTFont, .horizontal, &glyph, &advance, 1) > 0 else { return nil }
        return CGFloat(characterCount) * advance.width
    }

    static func airDateLabel(_ value: String) -> String? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withFullDate]
        parser.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = parser.date(from: String(value.prefix(10))) else { return nil }

        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.timeZone = TimeZone(secondsFromGMT: 0)!
        formatter.setLocalizedDateFormatFromTemplate("dMMMy")
        return formatter.string(from: date)
    }

    private func centreTabletEpisode(_ proxy: ScrollViewProxy, seasons: [SeasonDetail]) {
        guard let id = selectedTabletEpisodeID,
              let season = seasons.first(where: { $0.episodes.contains { $0.id == id } }) else {
            if let first = seasons.first {
                proxy.scrollTo(first.season.id, anchor: .center)
            }
            return
        }
        DispatchQueue.main.async {
            proxy.scrollTo(season.season.id, anchor: .center)
            proxy.scrollTo(id, anchor: .center)
        }
    }

    private func writablePlaylists(for work: Work) -> [Playlist] {
        let mediaType: PlaylistMediaType = work.kind == .artist ? .audio : .video
        return playlists.filter { !$0.isSystem && $0.mediaType == mediaType }
    }

    private func add(_ work: Work, to playlist: Playlist) {
        Task {
            actionMessageTitle = "Playlists"
            do {
                _ = try await apiClient.addPlaylistItem(
                    playlistID: playlist.id,
                    body: AddPlaylistItemRequest(workID: work.id)
                )
                playlistMessage = "Added to \(playlist.name)."
            } catch let error as APIError {
                playlistMessage = error.displayMessage
            } catch {
                playlistMessage = error.localizedDescription
            }
        }
    }

    private func toggleWatchlist(_ work: Work) async {
        guard !watchlistBusy else { return }
        watchlistBusy = true
        defer { watchlistBusy = false }
        let client = WatchlistClient(transport: apiClient)
        let snapshot = TitleSnapshot(work: work)
        do {
            if watchlistListed {
                var key = watchlistTitleKey
                if key == nil {
                    key = try await client.resolve(snapshot).title.titleKey
                    guard !Task.isCancelled else { return }
                }
                if let key { try await client.remove(titleKey: key) }
                guard !Task.isCancelled else { return }
                watchlistListed = false
                watchlistTitleKey = key
            } else {
                let added = try await client.add(snapshot)
                guard !Task.isCancelled else { return }
                watchlistListed = true
                watchlistTitleKey = added.title.titleKey
            }
        } catch let error as APIError {
            actionMessageTitle = "Watchlist"
            playlistMessage = error.displayMessage
        } catch {
            actionMessageTitle = "Watchlist"
            playlistMessage = error.localizedDescription
        }
    }

    private func loadTabletWatchlist(_ work: Work) async {
        guard !watchlistBusy, !watchlistLoaded else { return }
        watchlistBusy = true
        defer { watchlistBusy = false }
        do {
            let resolved = try await WatchlistClient(transport: apiClient).resolve(TitleSnapshot(work: work))
            guard !Task.isCancelled else { return }
            watchlistListed = resolved.inWatchlist
            watchlistTitleKey = resolved.title.titleKey
            watchlistLoaded = true
            watchlistLoadFailed = false
        } catch let error as APIError {
            guard !Task.isCancelled else { return }
            watchlistLoadFailed = true
            actionMessageTitle = "Watchlist"
            playlistMessage = error.displayMessage
        } catch {
            guard !Task.isCancelled else { return }
            watchlistLoadFailed = true
            actionMessageTitle = "Watchlist"
            playlistMessage = error.localizedDescription
        }
    }

    @ViewBuilder
    private func children(for children: WorkChildren, tabletScale: CGFloat? = nil) -> some View {
        switch children {
        case .movie:
            EmptyView()
        case .series(let seasons):
            let spacing = tabletScale.map { (251.46875 - 304.28125) * $0 } ?? 34
            let displayedSeasons = tabletScale == nil
                ? seasons
                : seasons.filter { $0.episodes.contains { $0.mediaFileID != nil } }
            VStack(alignment: .leading, spacing: spacing) {
                ForEach(displayedSeasons, id: \.season.id) { season in
                    seasonEpisodeTrack(
                        season,
                        tabletScale: tabletScale,
                        selectedEpisodeID: selectedTabletEpisodeID,
                        focusedEpisodeID: $focusedTabletEpisodeID,
                        onSelectEpisode: { id in
                            tabletEpisodeSelectionTouched = true
                            selectedTabletEpisodeID = id
                        }
                    )
                        .id(season.season.id)
                }
            }
        case .artist(let albums):
            albumCoverFlow(albums)
        case .author(let books):
            VStack(alignment: .leading, spacing: 12) {
                Text("Books")
                    .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                ForEach(books) { book in
                    playableRow(title: book.book.title, subtitle: "Book", mediaFileID: book.mediaFileID)
                }
            }
        }
    }

    private func albumCoverFlow(_ albums: [AlbumDetail]) -> some View {
        let selected = albums.first(where: { $0.album.id == selectedAlbumID }) ?? albums.first
        return VStack(alignment: .leading, spacing: 22) {
            Text("Albums")
                .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                .foregroundStyle(PlayarrStyle.ink)

            ScrollView(.horizontal) {
                LazyHStack(spacing: -20) {
                    ForEach(Array(albums.enumerated()), id: \.element.album.id) { index, album in
                        Button { selectedAlbumID = album.album.id } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                PlayarrAlbumArtwork(
                                    artistWorkID: album.album.artistWorkID,
                                    albumID: album.album.id,
                                    apiClient: apiClient
                                )
                                .frame(width: 164, height: 164)
                                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(selectedAlbumID == album.album.id ? PlayarrStyle.pink : PlayarrStyle.lineStrong, lineWidth: selectedAlbumID == album.album.id ? 3 : 1)
                                }
                                Text(album.album.title).font(.caption.weight(.semibold)).lineLimit(1)
                                Text(album.album.releaseDate?.prefix(4) ?? Substring(album.album.albumType.rawValue.replacingOccurrences(of: "_", with: " ")))
                                    .font(.caption2).foregroundStyle(PlayarrStyle.muted)
                            }
                            .frame(width: 174, alignment: .leading)
                            .foregroundStyle(PlayarrStyle.ink)
                            .scaleEffect(selectedAlbumID == album.album.id ? 1.06 : 0.88)
                            .rotation3DEffect(
                                .degrees(selectedAlbumID == album.album.id ? 0 : (album.album.id == albums.first?.album.id ? 10 : -10)),
                                axis: (x: 0, y: 1, z: 0)
                            )
                            .zIndex(selectedAlbumID == album.album.id ? Double(albums.count + 1) : Double(albums.count - index))
                            .animation(.snappy, value: selectedAlbumID)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)

            if let selected {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(selected.album.title).font(.title3.weight(.semibold))
                        Text("\(selected.tracks.filter { $0.mediaFileID != nil }.count) playable tracks")
                            .font(.caption).foregroundStyle(PlayarrStyle.muted)
                    }
                    Spacer()
                    if let first = selected.tracks.first(where: { $0.mediaFileID != nil }), let mediaFileID = first.mediaFileID {
                        NavigationLink {
                            PlayerView(
                                apiClient: apiClient,
                                downloadRepository: downloadRepository,
                                initialMediaFileID: mediaFileID.uuidString,
                                initialTitle: first.track.title,
                                suggestionsWorkID: viewModel.detail?.work.id,
                                queue: PlaybackQueueBuilder.tracks(after: first.id, in: selected.tracks, albumTitle: selected.album.title),
                                advance: .immediate,
                                subtitle: selected.album.title
                            )
                        } label: { Label("Play", systemImage: "play.fill") }
                            .buttonStyle(PlayarrPrimaryButtonStyle())
                    }
                    DownloadTriggerButton(
                        candidates: selected.tracks.compactMap { track in
                            track.mediaFileID.map { candidate(mediaFileID: $0, title: track.track.title, subtitle: selected.album.title) }
                        },
                        apiClient: apiClient,
                        downloadRepository: downloadRepository
                    )
                    .accessibilityLabel("Download all tracks in this album")
                }
                .foregroundStyle(PlayarrStyle.ink)

                VStack(spacing: 0) {
                    let playableTracks = selected.tracks.filter { $0.mediaFileID != nil }
                    ForEach(Array(playableTracks.enumerated()), id: \.element.id) { index, track in
                        musicTrackRow(track, following: PlaybackQueueBuilder.tracks(after: track.id, in: playableTracks, albumTitle: selected.album.title), album: selected.album.title)
                        if index < playableTracks.count - 1 {
                            Divider().overlay(PlayarrStyle.line)
                        }
                    }
                }
                .background(PlayarrStyle.surfaceStrong.opacity(0.48), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(PlayarrStyle.line, lineWidth: 1) }
            }
        }
    }

    /// Next episodes in series order (rest of season, then later seasons).
    private func episodeFollowing(_ episodeID: UUID) -> [PlaybackQueueEntry] {
        guard let detail = viewModel.detail, case .series(let seasons) = detail.children else { return [] }
        return PlaybackQueueBuilder.episodes(after: episodeID, seriesTitle: detail.work.title, seasons: seasons)
    }

    private func seasonEpisodeTrack(
        _ season: SeasonDetail,
        tabletScale: CGFloat? = nil,
        selectedEpisodeID: UUID? = nil,
        focusedEpisodeID: FocusState<UUID?>.Binding,
        onSelectEpisode: @escaping (UUID) -> Void = { _ in }
    ) -> some View {
        let cardWidth = tabletScale.map { 196.015 * $0 } ?? 210
        let cardHeight = tabletScale.map { 110.252 * $0 } ?? 118
        // The web tablet rails list playable episodes only (WorkDetail.tsx playableEpisodes); phone keeps every episode.
        let railEpisodes = tabletScale == nil ? season.episodes : season.episodes.filter { $0.mediaFileID != nil }
        // At 1366x1024 the web track heading is 33.875pt, its scroller starts 26.25pt below it, and artwork starts 42pt into the scroller.
        let tabletHeadingHeight: CGFloat = 33.875
        let tabletScrollTop: CGFloat = 26.25
        let tabletArtInset: CGFloat = 42
        let glowRoom: CGFloat = 24
        let trackSpacing = tabletScale.map { (tabletScrollTop - tabletHeadingHeight) * $0 } ?? 10
        return VStack(alignment: .leading, spacing: trackSpacing) {
            if let tabletScale {
                VStack(alignment: .leading, spacing: 4 * tabletScale) {
                    Text(season.season.title ?? "Season \(season.season.seasonNumber)")
                        .font(DesignFont.font(12.567 * tabletScale, 610))
                        .tracking(-0.377 * tabletScale)
                        .foregroundStyle(PlayarrStyle.ink)
                    Text("\(railEpisodes.count) episodes")
                        .font(DesignFont.font(7.36 * tabletScale, 400))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: tabletHeadingHeight * tabletScale, alignment: .topLeading)
                .padding(.trailing, 32.784 * tabletScale)
            } else {
                HStack(alignment: .firstTextBaseline) {
                    Text(season.season.title ?? "Season \(season.season.seasonNumber)")
                        .font(.custom("Avenir Next", fixedSize: 18).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.ink)
                    Spacer()
                    Text("\(season.episodes.count) episodes")
                        .font(.custom("Avenir Next", fixedSize: 10).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.muted)
                    seasonDownloadButton(season)
                }
            }

            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(railEpisodes) { episode in
                        episodeCard(
                            episode,
                            seasonNumber: season.season.seasonNumber,
                            cardWidth: cardWidth,
                            cardHeight: cardHeight,
                            selected: episode.id == selectedEpisodeID,
                            tabletScale: tabletScale,
                            focusedEpisodeID: focusedEpisodeID,
                            onSelect: { onSelectEpisode(episode.id) }
                        )
                    }
                }
                // Focus ring, glow and lift need room inside the clip: grow the scroller by `glow` above and below
                // (cancelled by the negative padding, so the layout does not move) and pad the end of the rail, so
                // the first card's left glow and the last card clear the rail edges (leading room is cancelled the same way). The
                // rail stays clipped, so scrolled cards leak at most the glow strip.
                .padding(.top, tabletScale.map { (tabletArtInset + glowRoom) * $0 } ?? 8)
                .padding(.bottom, tabletScale.map { glowRoom * $0 } ?? 8)
                .padding(.leading, tabletScale.map { glowRoom * $0 } ?? 0)
                .padding(.trailing, tabletScale.map { 2 * glowRoom * $0 } ?? 0)
            }
            .frame(height: tabletScale.map { (278.03125 + 2 * glowRoom) * $0 }, alignment: .topLeading)
            .webEdgeFade(.horizontal, enabled: tabletScale != nil) // the web fades the rail end to 30% over 64 pt (page-layout.css)
            .padding(.vertical, tabletScale.map { -glowRoom * $0 } ?? 0)
            .padding(.leading, tabletScale.map { -glowRoom * $0 } ?? 0)
            .scrollClipDisabled(tabletScale == nil) // phone: the selected episode's ring, glow and lift are not cut by the rail (#1274)
            .scrollIndicators(.hidden)
        }
        .frame(height: tabletScale.map { 304.28125 * $0 }, alignment: .topLeading)
    }

    private func seasonDownloadButton(_ season: SeasonDetail) -> some View {
        DownloadTriggerButton(
            candidates: season.episodes.compactMap { episode in
                episode.mediaFileID.map {
                    candidate(
                        mediaFileID: $0,
                        title: episode.episode.title ?? "Episode \(episode.episode.episodeNumber)",
                        subtitle: season.season.title ?? "Season \(season.season.seasonNumber)",
                        season: season.season.seasonNumber,
                        episode: episode.episode.episodeNumber
                    )
                }
            },
            apiClient: apiClient,
            downloadRepository: downloadRepository
        )
        .foregroundStyle(PlayarrStyle.muted)
        .accessibilityLabel("Download all episodes in this season")
    }

    @ViewBuilder
    private func episodeCard(
        _ detail: EpisodeDetail,
        seasonNumber: Int32,
        cardWidth: CGFloat = 210,
        cardHeight: CGFloat = 118,
        selected: Bool = false,
        tabletScale: CGFloat? = nil,
        focusedEpisodeID: FocusState<UUID?>.Binding,
        onSelect: @escaping () -> Void = {}
    ) -> some View {
        let episode = detail.episode
        let title = episode.title ?? "Episode \(episode.episodeNumber)"
        let label = "S\(String(format: "%02d", seasonNumber)) · E\(String(format: "%02d", episode.episodeNumber))"

        Group {
            if let mediaFileID = detail.mediaFileID {
                NavigationLink {
                    PlayerView(
                        apiClient: apiClient,
                        downloadRepository: downloadRepository,
                        initialMediaFileID: mediaFileID.uuidString,
                        initialTitle: title,
                        suggestionsWorkID: viewModel.detail?.work.id,
                        queue: episodeFollowing(detail.id),
                        subtitle: PlaybackQueueBuilder.episodeSubtitle(
                            series: viewModel.detail?.work.title ?? "",
                            season: seasonNumber,
                            episode: episode.episodeNumber
                        )
                    )
                } label: {
                    episodeCardLabel(
                        detail: detail,
                        title: title,
                        label: label,
                        playable: true,
                        cardWidth: cardWidth,
                        cardHeight: cardHeight,
                        selected: selected,
                        tabletScale: tabletScale
                    )
                }
                .buttonStyle(.plain)
                .focused(focusedEpisodeID, equals: detail.id)
                .contextMenu {
                    Button("Download", systemImage: "arrow.down.circle") {
                        downloadRepository.enqueue(
                            candidates: [candidate(mediaFileID: mediaFileID, title: title, subtitle: label, season: seasonNumber, episode: episode.episodeNumber)],
                            profile: nil,
                            keepUntil: .forever
                        )
                    }
                }
            } else {
                Button(action: onSelect) {
                    episodeCardLabel(
                        detail: detail,
                        title: title,
                        label: label,
                        playable: false,
                        cardWidth: cardWidth,
                        cardHeight: cardHeight,
                        selected: selected,
                        tabletScale: tabletScale
                    )
                }
                .buttonStyle(.plain)
                .focused(focusedEpisodeID, equals: detail.id)
            }
        }
    }

    private func episodeCardLabel(
        detail: EpisodeDetail,
        title: String,
        label: String,
        playable: Bool,
        cardWidth: CGFloat = 210,
        cardHeight: CGFloat = 118,
        selected: Bool = false,
        tabletScale: CGFloat? = nil
    ) -> some View {
        let scale = tabletScale ?? 1
        let cardRadius = tabletScale.map { 9.562 * $0 } ?? 12
        let focusColor = PlayarrStyle.brandInk
        return VStack(alignment: .leading, spacing: tabletScale == nil ? 7 : 0) {
            ZStack(alignment: .bottomLeading) {
                if let work = viewModel.detail?.work {
                    WMRemoteImage(apiClient: apiClient, sources: episodeArtworkSources(detail, workID: work.id))
                        .frame(width: cardWidth, height: cardHeight)
                        .background(PlayarrStyle.surfaceStrong.opacity(0.7))
                } else {
                    PlayarrStyle.surfaceStrong
                }
                LinearGradient(colors: [.clear, .black.opacity(0.68)], startPoint: .center, endPoint: .bottom)
                if let tabletScale {
                    Text(String(format: "%02d", detail.episode.episodeNumber))
                        .font(DesignFont.font(13.66 * tabletScale, 560))
                        .foregroundStyle(.white)
                        .padding(.trailing, 12 * tabletScale)
                        .padding(.bottom, 8 * tabletScale)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                } else {
                    HStack {
                        Text(label)
                            .font(.custom("Avenir Next", fixedSize: 10).weight(.heavy))
                            .foregroundStyle(.white)
                        Spacer()
                        Image(systemName: playable ? "play.fill" : "clock")
                            .font(.caption.bold())
                            .foregroundStyle(.white)
                            .frame(width: 30, height: 30)
                            .background(.black.opacity(0.56), in: Circle())
                    }
                    .padding(10)
                }
                if let tabletScale, playable, let seen = progressedMediaFileIDs,
                   let file = detail.mediaFileID, !seen.contains(file) {
                    WMUnseenDot()
                        .padding(.top, 7 * tabletScale).padding(.trailing, 7 * tabletScale)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                }
            }
            .frame(width: cardWidth, height: cardHeight)
            .clipShape(RoundedRectangle(cornerRadius: cardRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: cardRadius, style: .continuous)
                    .stroke(
                        tabletScale == nil ? (selected ? PlayarrStyle.pink : PlayarrStyle.lineStrong) : (selected ? focusColor : .clear),
                        lineWidth: tabletScale == nil ? (selected ? 3 : 1) : (selected ? 3 * scale : 0)
                    )
            }
            .scaleEffect(selected && tabletScale != nil ? 1.025 : 1)
            .shadow(color: selected && tabletScale != nil ? focusColor.opacity(0.45) : .clear, radius: selected ? 10 * scale : 0)
            if let tabletScale {
                HStack(alignment: .firstTextBaseline, spacing: 8.8 * tabletScale) {
                    Text(label)
                        .font(DesignFont.font(6.278 * tabletScale, 700))
                        .foregroundStyle(PlayarrStyle.muted)
                        .fixedSize()
                    Text(title)
                        .font(DesignFont.font(8.196 * tabletScale, 610))
                        .foregroundStyle(PlayarrStyle.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .padding(.top, 11.52 * tabletScale)
            } else {
                Text(title)
                    .font(.custom("Avenir Next", fixedSize: 12.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(1)
                Text(playable ? "Episode" : "Not available yet")
                    .font(.custom("Avenir Next", fixedSize: 10).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted)
            }
        }
        .frame(width: cardWidth, alignment: .leading)
        .contentShape(Rectangle())
        .offset(y: selected && tabletScale != nil ? -7 * scale : 0)
        .animation(.easeOut(duration: 0.24), value: selected)
    }

    private func episodeArtworkSources(_ episode: EpisodeDetail, workID: UUID) -> [WMRemoteImage.Source] {
        var sources = [WMRemoteImage.Source(
            path: "/api/v1/artwork/episode/\(workID.uuidString.lowercased())/\(episode.id.uuidString.lowercased())/thumb"
        )]
        if let mediaFileID = episode.mediaFileID {
            sources.append(WMRemoteImage.Source(path: "/api/v1/media/\(mediaFileID.uuidString.lowercased())/thumbnail"))
        }
        return sources
    }

    @ViewBuilder
    private func musicTrackRow(_ detail: TrackDetail, following: [PlaybackQueueEntry], album: String) -> some View {
        if let mediaFileID = detail.mediaFileID {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: detail.track.title,
                    suggestionsWorkID: viewModel.detail?.work.id,
                    queue: following,
                    advance: .immediate,
                    subtitle: album
                )
            } label: {
                HStack(spacing: 14) {
                    Text(String(format: "%02d", detail.track.trackNumber))
                        .font(.custom("Avenir Next", fixedSize: 11).weight(.bold))
                        .monospacedDigit()
                        .foregroundStyle(PlayarrStyle.muted)
                        .frame(width: 28)
                    Text(detail.track.title)
                        .font(.custom("Avenir Next", fixedSize: 13).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.ink)
                        .lineLimit(1)
                    Spacer()
                    if let seconds = detail.track.durationSeconds {
                        Text(Self.duration(seconds))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(PlayarrStyle.muted)
                    }
                    Image(systemName: "play.fill")
                        .font(.caption.bold())
                        .foregroundStyle(PlayarrStyle.pink)
                }
                .padding(.horizontal, 16)
                .frame(minHeight: 52)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Download", systemImage: "arrow.down.circle") {
                    downloadRepository.enqueue(
                        candidates: [candidate(mediaFileID: mediaFileID, title: detail.track.title, subtitle: nil)],
                        profile: nil,
                        keepUntil: .forever
                    )
                }
            }
        }
    }

    private static func duration(_ seconds: Int32) -> String {
        String(format: "%d:%02d", seconds / 60, seconds % 60)
    }

    @ViewBuilder
    private func playableRow(title: String, subtitle: String, mediaFileID: UUID?) -> some View {
        if let mediaFileID {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: mediaFileID.uuidString,
                    initialTitle: title,
                    suggestionsWorkID: viewModel.detail?.work.id
                )
            } label: {
                rowLabel(title: title, subtitle: subtitle, playable: true)
            }
            .buttonStyle(.plain)
            .contextMenu {
                Button("Download", systemImage: "arrow.down.circle") {
                    downloadRepository.enqueue(
                        candidates: [candidate(mediaFileID: mediaFileID, title: title, subtitle: subtitle)],
                        profile: nil,
                        keepUntil: .forever
                    )
                }
            }
        } else {
            rowLabel(title: title, subtitle: subtitle, playable: false)
        }
    }

    private func rowLabel(title: String, subtitle: String, playable: Bool) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(playable ? PlayarrStyle.ink : PlayarrStyle.ink.opacity(0.22))
                Image(systemName: playable ? "play.fill" : "clock")
                    .foregroundStyle(.white)
            }
            .frame(width: 48, height: 48)

            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(playable ? subtitle : "Not available yet")
                    .font(.caption)
                    .foregroundStyle(PlayarrStyle.muted)
            }
            Spacer()
            if playable {
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(PlayarrStyle.muted)
            }
        }
        .foregroundStyle(PlayarrStyle.ink)
        .padding(.horizontal, 14)
        .frame(minHeight: 58)
        .background(PlayarrStyle.surfaceStrong.opacity(0.68), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        WorkDetailView(
            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: UUID()),
            apiClient: apiClient,
            downloadRepository: DownloadRepository(apiClient: apiClient)
        )
    }
}

/// Emits numeric SwiftUI text-layout diagnostics without participating in layout.
private struct TabletTitleLayoutDiagnostic: View {
    private static let logger = Logger(subsystem: "PlayarrApp", category: "TitleLayoutDiagnostic")

    let stage: String
    let fontSize: CGFloat
    let appliedCorrection: CGFloat
    let isSettled: Bool
    let colorScheme: ColorScheme
    @State private var lastMeasurement: String?

    var body: some View {
        GeometryReader { proxy in
            Color.clear
                .onAppear { record(proxy.size, frame: proxy.frame(in: .named("tabletDetailLayoutDiagnostics"))) }
                .onChange(of: proxy.size) { _, size in record(size, frame: proxy.frame(in: .named("tabletDetailLayoutDiagnostics"))) }
                .onChange(of: isSettled) { _, _ in record(proxy.size, frame: proxy.frame(in: .named("tabletDetailLayoutDiagnostics"))) }
        }
    }

    private func record(_ size: CGSize, frame: CGRect) {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["PLAYARR_LAYOUT_DIAGNOSTICS"] == "1",
              isSettled, size.width > 0, size.height > 0 else { return }
        let uiFont = DesignFont.uiFont(
            family: "Nunito Sans",
            postScriptName: DesignFont.nunitoPostScriptName,
            size: fontSize,
            weight: 560,
            fixedAxes: DesignFont.nunitoAxes
        ) ?? UIFont.systemFont(ofSize: fontSize)
        let estimatedLineCount = max(1, Int((size.height / max(uiFont.lineHeight, 1)).rounded()))
        let signature = String(format: "%@|%.2f|%.2f|%.2f|%.2f|%.2f|%.2f|%.2f", stage, frame.minX, frame.minY, size.width, size.height, fontSize, uiFont.lineHeight, appliedCorrection)
        guard signature != lastMeasurement else { return }
        lastMeasurement = signature
        Self.logger.info("PLAYARR_IOS_TITLE_LAYOUT_DIAGNOSTIC element=title stage=\(stage, privacy: .public) x=\(Double(frame.minX), format: .fixed(precision: 2), privacy: .public) y=\(Double(frame.minY), format: .fixed(precision: 2), privacy: .public) width=\(Double(size.width), format: .fixed(precision: 2), privacy: .public) height=\(Double(size.height), format: .fixed(precision: 2), privacy: .public) fontSize=\(Double(fontSize), format: .fixed(precision: 2), privacy: .public) ascender=\(Double(uiFont.ascender), format: .fixed(precision: 2), privacy: .public) descender=\(Double(uiFont.descender), format: .fixed(precision: 2), privacy: .public) leading=\(Double(uiFont.leading), format: .fixed(precision: 2), privacy: .public) lineHeight=\(Double(uiFont.lineHeight), format: .fixed(precision: 2), privacy: .public) webTargetLineHeight=\(Double(fontSize * 0.9), format: .fixed(precision: 2), privacy: .public) appliedCorrection=\(Double(appliedCorrection), format: .fixed(precision: 2), privacy: .public) estimatedLineCount=\(estimatedLineCount, privacy: .public) theme=\(colorScheme == .dark ? "dark" : "light", privacy: .public)")
        #endif
    }
}

private struct TabletDetailFrameDiagnostic: View {
    private static let logger = Logger(subsystem: "PlayarrApp", category: "TitleLayoutDiagnostic")

    let element: String
    let isSettled: Bool
    let colorScheme: ColorScheme
    @State private var lastMeasurement: String?

    var body: some View {
        GeometryReader { proxy in
            Color.clear
                .onAppear { record(proxy.frame(in: .named("tabletDetailLayoutDiagnostics"))) }
                .onChange(of: proxy.size) { _, _ in record(proxy.frame(in: .named("tabletDetailLayoutDiagnostics"))) }
                .onChange(of: isSettled) { _, _ in record(proxy.frame(in: .named("tabletDetailLayoutDiagnostics"))) }
        }
    }

    private func record(_ frame: CGRect) {
        #if DEBUG
        guard ProcessInfo.processInfo.environment["PLAYARR_LAYOUT_DIAGNOSTICS"] == "1",
              isSettled, frame.width > 0, frame.height > 0 else { return }
        let signature = String(format: "%@|%.2f|%.2f|%.2f|%.2f", element, frame.minX, frame.minY, frame.width, frame.height)
        guard signature != lastMeasurement else { return }
        lastMeasurement = signature
        Self.logger.info("PLAYARR_IOS_TITLE_LAYOUT_DIAGNOSTIC element=\(element, privacy: .public) x=\(Double(frame.minX), format: .fixed(precision: 2), privacy: .public) y=\(Double(frame.minY), format: .fixed(precision: 2), privacy: .public) width=\(Double(frame.width), format: .fixed(precision: 2), privacy: .public) height=\(Double(frame.height), format: .fixed(precision: 2), privacy: .public) theme=\(colorScheme == .dark ? "dark" : "light", privacy: .public)")
        #endif
    }
}
