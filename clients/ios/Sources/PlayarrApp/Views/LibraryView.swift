import PlayarrKit
import SwiftUI
import UIKit

enum LibraryFocusMetrics {
    static let tabletCardScale: CGFloat = 1.015
    static let tabletArtworkScale: CGFloat = 1.025
    static let tabletLift: CGFloat = -5
}

struct LibraryView: View {
    @State private var viewModel: LibraryViewModel
    /// Hardware-keyboard focus (Tab and arrows): the ring follows it, and starts on the first card as on the web.
    @FocusState private var focusedWork: UUID?
    /// Arrow keys move this card index in the phone grid; the ring and the scroll follow it.
    @State private var keyIndex: Int?
    @State private var visibleWorkID: UUID?
    @State private var alphabetJumpTask: Task<Void, Never>?
    @FocusState private var gridKeys: Bool
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    let title: String
    @Environment(\.playarrGoHome) private var goHome
    @AppStorage(PlayarrArtworkPrefs.sizeKey) private var artworkSize = "medium"
    @State private var showingFilters = false
    /// Works this profile has watched or part-watched (an explicit unseen row does not count, as on web); a grid card for any other work shows the web's unseen dot.
    @State private var progressedWorkIDs: Set<UUID>?
    @State private var filtersOpen = false
    @State private var downloadTarget: Work?
    @Environment(\.colorScheme) private var scheme
    @State private var actionsWork: Work?
    /// Web moves focus into an open drawer, so no grid card keeps its focus ring or lift behind it.
    private var drawerOpen: Bool { showingFilters || actionsWork != nil }
    @State private var openWork: Work?
    private var isPhoneIdiom: Bool { UIDevice.current.userInterfaceIdiom == .phone }

    init(kind: WorkKind?, apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository, title: String? = nil, initialQuery: String? = nil) {
        let viewModel = LibraryViewModel(apiClient: apiClient)
        if let initialQuery { viewModel.searchText = initialQuery }
        viewModel.selectedKind = kind
        viewModel.isSearchMode = kind == nil
        _viewModel = State(initialValue: viewModel)
        #if DEBUG
        _showingFilters = State(initialValue: ParityLaunch.screen == "filters")
        if ParityLaunch.covers { viewModel.viewMode = .cover }
        #endif
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.title = title ?? kind?.displayName ?? "Search"
    }

    init(viewModel: LibraryViewModel, apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository) {
        _viewModel = State(initialValue: viewModel)
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        self.title = viewModel.selectedKind?.displayName ?? "Library"
    }

    var body: some View {
        Group {
            if viewModel.isSearchMode && UIDevice.current.userInterfaceIdiom == .phone {
                phoneSearch
            } else {
            switch viewModel.loadState {
            case .idle, .loading:
                PlayarrLoadingView(title: viewModel.searchText.isEmpty ? "Loading \(title.lowercased())…" : "Searching…")
            case .failed(let message):
                PlayarrFailureView(title: "Couldn’t load \(title.lowercased())", message: message) {
                    Task { await viewModel.load() }
                }
            case .empty:
                stage { emptyState }
            case .loaded:
                stage { libraryContent }
            }
            }
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
            if progressedWorkIDs == nil {
                progressedWorkIDs = Set(((try? await apiClient.listWatchProgress()) ?? []).filter { $0.state != .unseen }.map(\.workID))
            }
            #if DEBUG
            // Parity "actions": the first card's actions sheet, which a long press opens.
            if ParityLaunch.screen == "actions", actionsWork == nil { actionsWork = viewModel.works.first }
            #endif
        }
        .navigationBarHidden(true)
        #if DEBUG
        .parityScreenLoad(parityLoadState)
        #endif
        .overlay {
            // Phones: a full-page panel; iPad: the web tablet's 360 pt drawer on the right.
            HStack(spacing: 0) {
                if !isPhoneIdiom { Spacer(minLength: 0) }
                if showingFilters {
                    WMLibraryFiltersPanel(viewModel: viewModel) { showingFilters = false; Task { await viewModel.load() } }
                        .frame(maxWidth: isPhoneIdiom ? .infinity : 360)
                } else if let work = actionsWork {
                    WMTitleActionsPanel(
                        work: work, apiClient: apiClient,
                        onPlay: { actionsWork = nil; openWork = work },
                        onDownload: { actionsWork = nil; downloadTarget = work },
                        onClose: { actionsWork = nil }
                    )
                    .frame(maxWidth: isPhoneIdiom ? .infinity : 360)
                }
            }
        }
        .navigationDestination(isPresented: Binding(get: { openWork != nil }, set: { if !$0 { openWork = nil } })) {
            if let work = openWork {
                WorkDetailView(viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id), apiClient: apiClient, downloadRepository: downloadRepository)
            }
        }
        .sheet(item: $downloadTarget) { work in
            WorkDownloadSheet(work: work, apiClient: apiClient, downloadRepository: downloadRepository)
        }
    }

    #if DEBUG
    private var parityLoadState: ParityScreenLoad {
        switch viewModel.loadState {
        case .loaded, .empty:
            if ParityLaunch.screen == "actions", actionsWork == nil { return .loading }
            return .ready
        case .failed: return .failed
        case .idle, .loading: return .loading
        }
    }
    #endif

    private struct SearchChip: Identifiable {
        let label: String
        let scope: LibraryViewModel.SearchScope
        let x: CGFloat
        let width: CGFloat
        var id: String { label }
    }

    private static let searchChips: [SearchChip] = [
        SearchChip(label: "All", scope: .all, x: 72, width: 35),
        SearchChip(label: "Movies", scope: .movie, x: 112, width: 48),
        SearchChip(label: "Series", scope: .series, x: 168, width: 44),
        SearchChip(label: "Playlists", scope: .playlist, x: 218, width: 51),
    ]

    /// Web mobile search: pill field, filter chip, type chips and a two-column
    /// result grid (numbers from the web layout dump).
    private var phoneSearch: some View {
        ZStack(alignment: .topLeading) {
            WM.page
            WMKeyArt(work: viewModel.works.first, apiClient: apiClient, lightOpacity: 0.41, webMask: true)
            ScrollView(.vertical) {
                ZStack(alignment: .topLeading) {
                    HStack(spacing: 12) {
                        WMIconView(icon: .search, color: WM.muted, size: 16)
                        TextField("", text: $viewModel.searchText, prompt: Text("Search").foregroundColor(WM.muted))
                            .font(WM.font(16))
                            .foregroundStyle(WM.ink)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.search)
                            .accessibilityIdentifier("search-field")
                            .onSubmit { Task { await viewModel.load() } }
                            .onChange(of: viewModel.searchText) { _, value in
                                if value.isEmpty { Task { await viewModel.load() } }
                            }
                    }
                    .padding(.leading, 15)
                    .padding(.trailing, 16)
                    .frame(width: 358, height: 50)
                    .background(WM.chip, in: Capsule())
                    .overlay(Capsule().stroke(WM.pink.opacity(0.7), lineWidth: 2))
                    .shadow(color: WM.pink.opacity(0.22), radius: 5)
                    .offset(x: 16, y: 90)

                    Button { withAnimation { filtersOpen.toggle() } } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "slider.horizontal.3")
                                .font(.system(size: 11, weight: .semibold))
                                .foregroundStyle(WM.pink)
                            WMText("Filters", 8, 760, lh: 12)
                            WMText("\(scopeLabel(viewModel.searchScope)) · All libraries", 6.72, 400, color: WM.muted, lh: 10.08)
                        }
                        .padding(.leading, 25)
                        .frame(width: 145, height: 42, alignment: .leading)
                        .background(WM.chip.opacity(0.66), in: Capsule())
                        .wmChipShadow()
                    }
                    .buttonStyle(.plain)
                    .offset(x: 16, y: 150)

                    if filtersOpen {
                    WMText("Type", 6.72, 740, color: WM.muted, lh: 10.08).offset(x: 16, y: 188)
                    ForEach(Self.searchChips) { chip in
                        let active = viewModel.searchScope == chip.scope
                        Button {
                            viewModel.searchScope = chip.scope
                            Task { await viewModel.load() }
                        } label: {
                            WMText(chip.label, 7.04, 680, color: active ? WM.ink : WM.muted, lh: 10.56)
                                .frame(width: chip.width, height: active ? 33 : 31)
                                .background(
                                    active ? WM.adaptive(light: (226, 214, 218), dark: (64, 33, 43)) : WM.ink.opacity(0.06),
                                    in: Capsule()
                                )
                        }
                        .buttonStyle(.plain)
                        .offset(x: chip.x, y: active ? 183 : 184)
                    }
                    }

                    VStack(alignment: .leading, spacing: 0) {
                        LazyVGrid(
                            columns: [
                                GridItem(.fixed(173), spacing: 12, alignment: .top),
                                GridItem(.fixed(173), spacing: 12, alignment: .top),
                            ],
                            alignment: .leading,
                            spacing: 22
                        ) {
                            ForEach(Array(viewModel.works.enumerated()), id: \.element.id) { index, work in
                                NavigationLink {
                                    WorkDetailView(
                                        viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                        apiClient: apiClient,
                                        downloadRepository: downloadRepository
                                    )
                                } label: {
                                    WMSearchCard(work: work, apiClient: apiClient, focused: focusedWork.map { $0 == work.id } ?? false)
                                }
                                .buttonStyle(.plain)
                                .focusable()
                                .focused($focusedWork, equals: work.id)
                                .focusEffectDisabled()
                                .accessibilityIdentifier("search-work-\(work.id.uuidString)")
                                .accessibilityLabel(work.title)
                            }
                        }
                        .padding(.leading, 16)
                        .padding(.top, 30)
                        if case .loaded = viewModel.loadState {
                            WMText("OTHER SOURCES", 8, 720, color: WM.muted, lh: 12, ls: 0.56)
                                .padding(.leading, 16).padding(.top, 19.5)
                            WMText("Nothing found in other sources.", 8.8, 400, color: WM.muted, lh: 13.2)
                                .padding(.leading, 16).padding(.top, 12)
                        }
                    }
                    .offset(y: 321)
                }
                .frame(maxWidth: .infinity, minHeight: 844, alignment: .topLeading)
                .padding(.bottom, 130)
            }
            .scrollIndicators(.hidden)
            .keepInsideSafeArea()

            ZStack(alignment: .topLeading) {
                WMHeaderCircleButton(width: 42, height: 38, glyph: "←", action: goHome)
                    .offset(x: 16, y: WM.topInset + 2)
                WMText("Search", 21.6, 580, lh: 32.4, ls: -0.972)
                    .offset(x: 68, y: WM.topInset + 5)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    private func scopeLabel(_ scope: LibraryViewModel.SearchScope) -> String {
        switch scope {
        case .all: "All"
        case .movie: "Movies"
        case .series: "Series"
        case .site: "Sites"
        case .artist: "Music"
        case .playlist: "Playlists"
        }
    }

    private func stage<Content: View>(@ViewBuilder content: @escaping () -> Content) -> some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            ZStack(alignment: .topLeading) {
                let preview = LibraryOverlayParity.previewWork(
                    actionsWork: actionsWork,
                    focusedWork: viewModel.works.first(where: { $0.id == focusedWork }),
                    works: viewModel.works
                )
                if !phone, let preview {
                    PlayarrArtwork(work: preview, kind: .backdrop, apiClient: apiClient)
                        .frame(width: proxy.size.width * 0.52, height: proxy.size.height)
                        .clipped() // scaledToFill art overflowed the frame and drew a grey band over the grid
                        .opacity(scheme == .dark ? 0.1 : 0.04) // web light: the preview art is nearly invisible on the white page
                        .overlay {
                            LinearGradient(
                                colors: [PlayarrStyle.surface.opacity(0.2), PlayarrStyle.surface],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        }
                    previewCopy(preview, viewportWidth: proxy.size.width)
                        .frame(width: proxy.size.width * 0.24, alignment: .leading)
                        .padding(.leading, proxy.size.width * 0.088)
                        .padding(.top, proxy.size.height * 0.24)
                        .zIndex(2)
                }

                content().zIndex(1)

                if phone && !viewModel.isSearchMode {
                    WMLibraryHeader(
                        title: title,
                        detail: "\((viewModel.total ?? Int64(viewModel.works.count)).formatted(.number.grouping(.automatic))) \(viewModel.selectedKind == .artist ? "artists" : "titles")",
                        onBack: goHome,
                        onFilters: { showingFilters = true }
                    )
                    .zIndex(3)
                } else if !phone && title != "Search" {
                    tabletHeader(proxy: proxy).zIndex(3)
                } else {
                    pageHeading(phone: phone, proxy: proxy).zIndex(3)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .background(PlayarrStyle.surface.ignoresSafeArea())
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    private var libraryContent: some View {
        GeometryReader { proxy in
            if PlayarrLayout.isPhone(proxy.size) && !viewModel.isSearchMode && viewModel.viewMode != .coverFlow {
                phoneGrid
            } else {
                stageLibraryContent
            }
        }
    }

    /// Web mobile library: two 173x97 columns under the page header.
    private var phoneGrid: some View {
        ScrollViewReader { proxy in
            ZStack(alignment: .topLeading) {
                WMKeyArt(work: viewModel.works.first, apiClient: apiClient, lightOpacity: 0)
                phoneGridScroll
                alphabetRail(proxy)
            }
        }
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    /// Web tablet letter rail: 44 pt targets that scroll when the 27 letters do not fit (the first 16 show).
    private func tabletAlphabetRail(_ proxy: ScrollViewProxy, height: CGFloat) -> some View {
        let displayedLetters = LibraryViewModel.alphabetLetters(order: viewModel.order)
        let activeWork = visibleWorkID.flatMap { id in viewModel.works.first { $0.id == id } }
            ?? focusedWork.flatMap { id in viewModel.works.first { $0.id == id } }
            ?? viewModel.works.first
        let activeLetter = activeWork.map(LibraryViewModel.alphabetLetter(for:)) ?? "#"
        return ScrollView(.vertical) {
            VStack(spacing: 0) {
                ForEach(displayedLetters, id: \.self) { letter in
                    ZStack {
                        if letter == activeLetter { Circle().fill(WM.ink.opacity(0.78)).frame(width: 20, height: 20) }
                        Text(letter).font(WM.font(8.8, 700)).foregroundStyle(letter == activeLetter ? PlayarrStyle.background : WM.muted)
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        alphabetJumpTask?.cancel()
                        alphabetJumpTask = Task {
                            guard let first = await viewModel.firstWork(atOrAfterAlphabetLetter: letter) else { return }
                            guard !Task.isCancelled else { return }
                            focusedWork = first.id
                            proxy.scrollTo(first.id, anchor: .center)
                        }
                    }
                }
            }
        }
        .scrollIndicators(.hidden)
        .frame(width: 44, height: max(0, height))
    }

    /// Web phone letter rail: 27 letters share the height between the page header and the bottom nav, in the 15 pt gutter.
    private func alphabetRail(_ proxy: ScrollViewProxy) -> some View {
        let letters = ["#"] + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".map(String.init)
        // Web marks the letter of the focused tile, which is the first one on arrival.
        let initial = viewModel.works.first?.title.first.map { String($0).uppercased() } ?? "#"
        let activeLetter = ("A"..."Z").contains(initial) ? initial : "#"
        return GeometryReader { geo in
            ScrollView(.vertical) { VStack(spacing: 0) {
                ForEach(letters, id: \.self) { letter in
                    ZStack {
                        if letter == activeLetter { Circle().fill(WM.ink.opacity(0.78)).frame(width: 22, height: 22) }
                        Text(letter).font(WM.font(9.5, 700)).foregroundStyle(letter == activeLetter ? PlayarrStyle.background : WM.muted)
                    }
                    .frame(width: 44).frame(height: 25)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        let first = viewModel.works.first { work in
                            let initial = work.title.first.map { String($0).uppercased() } ?? "#"
                            return letter == "#" ? !("A"..."Z").contains(initial) : initial == letter
                        }
                        if let first { withAnimation { proxy.scrollTo(first.id, anchor: .top) } }
                    }
                }
            } }
            .scrollIndicators(.hidden)
            .frame(width: 44, height: max(0, geo.size.height - 90 - 84), alignment: .top)
            .offset(x: geo.size.width - 48, y: 87.5)
        }
    }

    private func phoneGridFocused(index: Int) -> Bool {
        #if DEBUG
        switch ParityLaunch.focus {
        case "last": return index == viewModel.works.count - 1
        case "top": return index == 1
        case "first": return index == 0
        default: break
        }
        #endif
        return index == 0
    }

    private var phoneGridScroll: some View {
        ScrollViewReader { reader in
        ScrollView(.vertical) {
            LazyVGrid(
                columns: Array(repeating: GridItem(.fixed(WMLibraryCard.width), spacing: 12, alignment: .top), count: WMArtwork.columns),
                alignment: .leading,
                spacing: 21
            ) {
                ForEach(Array(viewModel.works.enumerated()), id: \.element.id) { index, work in
                    NavigationLink {
                        WorkDetailView(
                            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                            apiClient: apiClient,
                            downloadRepository: downloadRepository
                        )
                    } label: {
                        WMLibraryCard(work: work, apiClient: apiClient, focused: keyIndex.map { $0 == index } ?? (focusedWork.map { $0 == work.id } ?? phoneGridFocused(index: index)), cover: viewModel.viewMode == .cover)
                    }
                    .id(work.id)
                    .buttonStyle(.plain)
                    .focusable()
                    .focused($focusedWork, equals: work.id)
                    .focusEffectDisabled()
                    .simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in actionsWork = work })
                    .task {
                        if work.id == viewModel.works.last?.id { await viewModel.loadMore() }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 84 + WM.topShift)
            .padding(.bottom, 130)
        }
        .focusable()
        .focused($gridKeys)
        .focusEffectDisabled()
        .onAppear { gridKeys = true }
        .onKeyPress(phases: [.down, .repeat]) { press in
            let count = viewModel.works.count
            guard count > 0 else { return .ignored }
            var at = keyIndex ?? 0
            switch press.key {
            case .rightArrow: at = min(count - 1, at + 1)
            case .leftArrow: at = max(0, at - 1)
            case .downArrow: at = min(count - 1, at + WMArtwork.columns)
            case .upArrow: at = max(0, at - WMArtwork.columns)
            default: return .ignored
            }
            keyIndex = at
            withAnimation(.easeInOut(duration: 0.2)) { reader.scrollTo(viewModel.works[at].id, anchor: .center) }
            return .handled
        }
        .scrollIndicators(.hidden)
        .refreshable { await viewModel.load() }
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
        .keepInsideSafeArea()
        .webEdgeFade(.vertical, size: 38) // web scroll-edge fade, 38 pt on phones
        .task(id: viewModel.works.count) {
            #if DEBUG
            guard ParityLaunch.focus == "last", let last = viewModel.works.last else { return }
            // The grid pages in as it nears the end: wait for the last page to settle, then scroll to its last card.
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            reader.scrollTo(last.id, anchor: UnitPoint(x: 0.5, y: 0.8)) // above the nav pill, so the ring is in frame
            #endif
        }
        }
    }

    private var stageLibraryContent: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            let panelWidth = phone ? proxy.size.width : proxy.size.width * 0.65
            let step = phone ? 0 : PlayarrArtworkPrefs.columnStep(artworkSize)
            let columnCount = viewModel.viewMode == .list ? 1 : max(1, (viewModel.viewMode == .cover ? (phone ? 3 : 5) : (phone ? 2 : 3)) + step)
            // Web tablet: the grid starts at 557 of 1366 pt and the three 229 pt columns end 85 pt before the panel edge.
            let viewportWidth = proxy.size.width
            let viewportHeight = proxy.size.height
            let gutter: CGFloat = phone ? 16 : max(28, viewportWidth * 0.058)
            let matchesWebScreenGrid = !phone && viewModel.viewMode == .screen
            let railInset: CGFloat = phone ? 16 : min(max(28, viewportWidth * 0.028), 54)
            let controlEdge = max(min(max(5, viewportWidth * 0.0065), 14), 0)
            let controlGap = min(max(18, viewportWidth * 0.015), 30)
            let trailing: CGFloat = phone ? 16 : matchesWebScreenGrid
                ? controlEdge + max(min(max(48, viewportWidth * 0.036), 62), 56) + controlGap
                : max(80, viewportWidth * 0.065)
            let gap: CGFloat = phone ? 12 : matchesWebScreenGrid
                ? min(max(14, viewportWidth * 0.0135), 28)
                : min(28, viewportWidth * 0.0135)
            let cardRail = viewportWidth * 0.62
            let cardWidth = phone
                ? (panelWidth - gutter - trailing - gap * CGFloat(columnCount - 1)) / CGFloat(columnCount)
                : matchesWebScreenGrid
                    ? (cardRail - railInset - trailing - gap * CGFloat(columnCount - 1)) / CGFloat(columnCount)
                    : (panelWidth - gutter - trailing - gap * CGFloat(columnCount - 1)) / CGFloat(columnCount)

            Group {
                if viewModel.viewMode == .coverFlow {
                    ScrollView(.horizontal) {
                        LazyHStack(spacing: -34) {
                            ForEach(Array(viewModel.works.enumerated()), id: \.element.id) { index, work in
                                NavigationLink {
                                    WorkDetailView(
                                        viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                        apiClient: apiClient,
                                        downloadRepository: downloadRepository
                                    )
                                } label: {
                                    PlayarrArtwork(work: work, kind: .poster, apiClient: apiClient)
                                        .frame(width: phone ? 176 : 220, height: phone ? 264 : 330)
                                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                        .overlay(alignment: .bottomLeading) {
                                            Text(work.title)
                                                .font(.caption.weight(.bold)).foregroundStyle(.white)
                                                .lineLimit(2).padding(12)
                                                .frame(maxWidth: .infinity, alignment: .leading)
                                                .background(.black.opacity(0.48))
                                        }
                                        .rotation3DEffect(.degrees(index.isMultiple(of: 2) ? 7 : -7), axis: (x: 0, y: 1, z: 0))
                                        .shadow(color: .black.opacity(0.34), radius: 18, y: 10)
                                }
                                .buttonStyle(.plain)
                                .simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in actionsWork = work })
                                .task { if work.id == viewModel.works.last?.id { await viewModel.loadMore() } }
                            }
                        }
                        .scrollTargetLayout()
                        .padding(.horizontal, gutter + 24)
                    }
                    .contentMargins(.top, phone ? 112 : max(150, proxy.size.height * 0.19), for: .scrollContent)
                    .contentMargins(.bottom, phone ? 130 : 70, for: .scrollContent)
                    .scrollTargetBehavior(.viewAligned)
                } else {
                    ScrollViewReader { scrollProxy in
                    ScrollView(.vertical) {
                        LazyVGrid(
                    columns: Array(repeating: GridItem(.fixed(cardWidth), spacing: gap, alignment: .top), count: columnCount),
                    alignment: .leading,
                    spacing: phone ? 24 : matchesWebScreenGrid ? min(max(22, viewportHeight * 0.025), 36) : 27
                        ) {
                    ForEach(viewModel.playlists) { playlist in
                        NavigationLink {
                            PlaylistDetailView(playlist: playlist, apiClient: apiClient, downloadRepository: downloadRepository)
                        } label: {
                            playlistSearchCard(playlist, width: cardWidth)
                        }
                        .buttonStyle(.plain)
                    }
                    ForEach(viewModel.works) { work in
                        NavigationLink {
                            WorkDetailView(
                                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                                apiClient: apiClient,
                                downloadRepository: downloadRepository
                            )
                        } label: {
                            if viewModel.viewMode == .list {
                                libraryListRow(work, width: cardWidth)
                            } else {
                                let focused = (!drawerOpen && work.id == (focusedWork ?? viewModel.works.first?.id))
                                PlayarrMediaCard(work: work, apiClient: apiClient, width: cardWidth, showsSubtitle: false, focused: !phone && focused)
                                    .overlay(alignment: .topTrailing) {
                                        if !phone, let seen = progressedWorkIDs, !seen.contains(work.id) {
                                            WMUnseenDot().padding(.top, 7).padding(.trailing, 7)
                                        }
                                    }
                                    .overlay(alignment: .top) {
                                        if focused {
                                            WMFocusRing(
                                                width: phone ? cardWidth : cardWidth * LibraryFocusMetrics.tabletArtworkScale,
                                                height: phone ? cardWidth * 9 / 16 : cardWidth * 9 / 16 * LibraryFocusMetrics.tabletArtworkScale,
                                                cornerRadius: min(13, max(8, cardWidth * 0.058)) * (phone ? 1 : LibraryFocusMetrics.tabletArtworkScale)
                                            )
                                                .frame(width: cardWidth, height: cardWidth * 9 / 16)
                                        }
                                    }
                            }
                        }
                        .focusable(!phone)
                        .focused($focusedWork, equals: work.id)
                        .background {
                            GeometryReader { geometry in
                                Color.clear.preference(
                                    key: LibraryWorkFrameKey.self,
                                    value: [work.id: geometry.frame(in: .named("library-work-grid"))]
                                )
                            }
                        }
                        .scaleEffect(
                            !phone && viewModel.viewMode != .list && (!drawerOpen && work.id == (focusedWork ?? viewModel.works.first?.id))
                                ? LibraryFocusMetrics.tabletCardScale : 1,
                            anchor: .center
                        )
                        .offset(
                            y: !phone && viewModel.viewMode != .list && (!drawerOpen && work.id == (focusedWork ?? viewModel.works.first?.id))
                                ? LibraryFocusMetrics.tabletLift : 0
                        )
                        .buttonStyle(.plain)
                        .simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in actionsWork = work })
                        .task {
                            if work.id == viewModel.works.last?.id { await viewModel.loadMore() }
                        }
                    }
                    if viewModel.isLoadingMore { ProgressView().tint(PlayarrStyle.pink).frame(width: cardWidth, height: 80) }
                        }
                        .padding(.leading, gutter)
                        .padding(.trailing, trailing)
                        .padding(.top, phone ? 92 + WM.topShift : max(128, proxy.size.height * 0.15))
                        .padding(.bottom, phone ? 118 : max(48, proxy.size.height * 0.06))
                    }
                    .scrollClipDisabled() // the first tile's focus ring and glow are not cut at the grid edge
                    .webEdgeFade(.vertical, enabled: !phone)
                    .coordinateSpace(name: "library-work-grid")
                    .onPreferenceChange(LibraryWorkFrameKey.self) { frames in
                        guard !phone else { return }
                        visibleWorkID = LibraryViewModel.visibleWorkID(
                            works: viewModel.works,
                            frames: frames,
                            viewportHeight: viewportHeight
                        )
                    }
                    .overlay(alignment: .topTrailing) {
                        if !phone && !viewModel.isSearchMode && viewModel.sort == "title" && viewModel.viewMode != .list {
                            tabletAlphabetRail(scrollProxy, height: proxy.size.height - 263 - 24)
                                .padding(.trailing, 16).padding(.top, 263)
                        }
                    }
                    }
                }
            }
            .frame(width: panelWidth, height: proxy.size.height)
            .background {
                if phone {
                    PlayarrStyle.surface.opacity(0.96)
                } else if scheme == .dark {
                    LinearGradient(
                        colors: [.clear, PlayarrStyle.surface.opacity(0.92), PlayarrStyle.surface],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                } else {
                    let railFrost = Color(red: 239.64 / 255, green: 238.2 / 255, blue: 238.68 / 255)
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: railFrost.opacity(0.68), location: 0.12),
                            .init(color: railFrost.opacity(0.88), location: 0.34),
                            .init(color: railFrost.opacity(0.96), location: 0.62),
                            .init(color: railFrost, location: 1)
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                }
            }
            .offset(x: phone ? 0 : proxy.size.width * 0.35)
            .onDisappear {
                alphabetJumpTask?.cancel()
                alphabetJumpTask = nil
            }
            .refreshable { await viewModel.load() }
            .scrollIndicators(.hidden)
        }
    }

    private func previewCopy(_ work: Work, viewportWidth: CGFloat) -> some View {
        let year = WorkDetailView.tabletYearRangeLabel(releaseDate: work.releaseDate, endDate: work.endDate)
        let genres = work.genres.prefix(2).joined(separator: " · ")
        let meta = [year, genres.isEmpty ? nil : genres].compactMap { $0 }.joined(separator: "   ")
        return VStack(alignment: .leading, spacing: 0) {
            WMText((work.genres.first ?? work.kind.displayName).uppercased(), 8.6, 800, color: PlayarrStyle.pink, lh: 13, ls: 1.1)
                .padding(.bottom, 20)
            let isPad = UIDevice.current.userInterfaceIdiom == .pad
            let titleSize: CGFloat = isPad ? min(max(35.2, viewportWidth * 0.036), 80) : 42
            let titleWeight = isPad ? 560 : 400
            let titleFont = DesignFont.uiFont(
                family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: titleSize, weight: titleWeight, fixedAxes: DesignFont.nunitoAxes
            )
            let nativeLineHeight = titleFont?.lineHeight ?? titleSize * 1.36
            let pitchCorrection = titleSize * 0.9 - nativeLineHeight
            let nineChWidth = titleFont.map { ("000000000" as NSString).size(withAttributes: [.font: $0]).width } ?? titleSize * 4.5
            let titleTracking = isPad ? -titleSize * 0.072 : -1.5
            let titleWidth = isPad ? min(viewportWidth * 0.24, nineChWidth) : 215
            let balancedLines = isPad ? titleFont.flatMap { BalancedTitleLayout.lines(for: work.title, font: $0, tracking: titleTracking, maxWidth: titleWidth) } : nil
            if isPad, let balancedLines {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(balancedLines.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(WM.font(titleSize, titleWeight))
                            .tracking(titleTracking)
                            .foregroundStyle(PlayarrStyle.ink)
                            .lineLimit(1)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(height: titleSize * 0.9, alignment: .top)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(work.title)
            } else {
                Text(work.title)
                    .font(WM.font(titleSize, titleWeight))
                    .tracking(titleTracking)
                    .lineSpacing(pitchCorrection)
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(isPad ? nil : 3)
                    .frame(width: isPad ? titleWidth : nil, alignment: .leading)
                    .frame(maxWidth: isPad ? nil : 215, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: isPad)
                    .padding(.bottom, pitchCorrection)
            }
            WMText(meta, 10, 600, color: PlayarrStyle.inkSoft, lh: 15)
                .padding(.top, 26)
            if let overview = work.overview {
                let overviewSize: CGFloat = isPad ? min(max(16 * 0.64, viewportWidth * 0.0072), 16 * 0.92) : 11.5
                let overviewFont = isPad
                    ? DesignFont.uiFont(
                        family: "Nunito Sans",
                        postScriptName: DesignFont.nunitoPostScriptName,
                        size: overviewSize,
                        weight: 600,
                        fixedAxes: DesignFont.nunitoAxes
                    )
                    : nil
                let overviewWidth = isPad
                    ? (overviewFont.map { (String(repeating: "0", count: 42) as NSString).size(withAttributes: [.font: $0]).width } ?? overviewSize * 23.5)
                    : 0
                let overviewLineHeight = overviewFont?.lineHeight ?? overviewSize * 1.36
                Text(overview)
                    .font(isPad ? WM.font(overviewSize, 600) : WM.font(11.5, 500))
                    .foregroundStyle(isPad ? WM.detailMuted : PlayarrStyle.inkSoft)
                    .lineSpacing(isPad ? max(0, overviewSize * 1.58 - overviewLineHeight) : 2.5)
                    .lineLimit(5)
                    .frame(maxWidth: isPad ? overviewWidth : nil, alignment: .leading)
                    .padding(.top, 20)
            }
        }
    }

    /// Web tablet page header (measured at 1366 pt): back circle at x 122, title at x 182, "N TITLES" below, and the
    /// Filters button (icon over its label) at the right edge.
    private func tabletHeader(proxy: GeometryProxy) -> some View {
        let scale = proxy.size.width / 1366
        return ZStack(alignment: .topLeading) {
            WMHeaderCircleButton(width: 43, height: 43, glyph: "←", action: goHome).offset(x: 122 * scale, y: 55 * scale)
            WMTitleWithDetail(
                detail: viewModel.total.map { "\($0.formatted(.number.grouping(.automatic))) \(viewModel.selectedKind == .artist ? "artists" : "titles")" },
                maxWidth: max(0, (proxy.size.width > 1100 ? proxy.size.width * 0.24 : proxy.size.width * 0.6) - 182 * scale - 4), size: 9.92, gap: 15
            ) {
                WMText(title, max(19.2, 24 * scale), 520, lh: 36, ls: -1)
            }
            .offset(x: 182 * scale, y: 57 * scale)
            HStack {
                Spacer()
                Button { showingFilters = true } label: {
                    VStack(spacing: 7) {
                        Image(systemName: "slider.horizontal.3").font(.system(size: 15, weight: .semibold))
                        Text("Filters").font(WM.font(8, 700))
                    }
                    .foregroundStyle(WM.inkSoft)
                    .frame(width: 45, height: 70)
                    .background(WM.chip.opacity(0.66), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(WM.line.opacity(0.14), lineWidth: 1))
                }
                .buttonStyle(.plain)
            }
            .padding(.trailing, 16 * scale).offset(y: min(max(116, proxy.size.height * 0.14), 164))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func pageHeading(phone: Bool, proxy: GeometryProxy) -> some View {
        HStack(spacing: phone ? 10 : 15) {
            Text(title)
                .font(.custom("Avenir Next", fixedSize: phone ? 22 : min(34, proxy.size.width * 0.0175)).weight(.medium))
                .tracking(phone ? -1 : -1.5)
                .foregroundStyle(PlayarrStyle.ink)
                .lineLimit(1)
            if !phone, let total = viewModel.total {
                WMHeaderDetail(text: "\(total) titles", gap: 14)
            }

            Spacer()

            if title == "Search" {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                    TextField("Search your library", text: $viewModel.searchText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .onSubmit { Task { await viewModel.load() } }
                        .onChange(of: viewModel.searchText) { _, value in
                            if value.isEmpty { Task { await viewModel.load() } }
                        }
                }
                .font(.custom("Avenir Next", fixedSize: 12))
                .foregroundStyle(PlayarrStyle.inkSoft)
                .padding(.horizontal, 12)
                .frame(width: phone ? 150 : 220, height: phone ? 42 : 44)
                .background(PlayarrStyle.surfaceStrong.opacity(0.72))
                .overlay { Rectangle().stroke(PlayarrStyle.lineStrong, lineWidth: 1) }
                Menu {
                    ForEach(LibraryViewModel.SearchScope.allCases, id: \.self) { scope in
                        Button {
                            viewModel.searchScope = scope
                            Task { await viewModel.load() }
                        } label: {
                            if scope == viewModel.searchScope { Label(searchScopeLabel(scope), systemImage: "checkmark") }
                            else { Text(searchScopeLabel(scope)) }
                        }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                        .frame(width: 42, height: 42)
                }
                .buttonStyle(.plain)
                .foregroundStyle(PlayarrStyle.inkSoft)
            } else {
                PlayarrHeaderPill(label: "Filters", systemImage: "slider.horizontal.3", iconOnly: phone) { showingFilters = true }
            }
        }
        .padding(.leading, phone ? 16 : max(102, proxy.size.width * 0.08))
        .padding(.trailing, phone ? 66 : max(22, proxy.size.width * 0.024))
        .padding(.top, phone ? max(56, WM.safeTop + 6) : min(66, max(34, proxy.size.height * 0.052)))
    }

    private func playlistSearchCard(_ playlist: Playlist, width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(LinearGradient(colors: [PlayarrStyle.pink.opacity(0.3), PlayarrStyle.surfaceStrong], startPoint: .topLeading, endPoint: .bottomTrailing))
                Image(systemName: playlist.mediaType == .audio ? "music.note.list" : "play.rectangle")
                    .font(.system(size: min(44, width * 0.2), weight: .light)).foregroundStyle(PlayarrStyle.pink)
            }
            .frame(width: width, height: viewModel.viewMode == .list ? 96 : width * 1.42)
            Text(playlist.name).font(.subheadline.weight(.semibold)).foregroundStyle(PlayarrStyle.ink).lineLimit(1)
            Text("Playlist").font(.caption2.weight(.semibold)).foregroundStyle(PlayarrStyle.muted)
        }
    }

    private func searchScopeLabel(_ scope: LibraryViewModel.SearchScope) -> String {
        switch scope {
        case .all: "Everything"
        case .movie: "Movies"
        case .series: "Series"
        case .site: "Sites"
        case .artist: "Music"
        case .playlist: "Playlists"
        }
    }

    private func libraryListRow(_ work: Work, width: CGFloat) -> some View {
        HStack(spacing: 14) {
            PlayarrArtwork(work: work, kind: .poster, apiClient: apiClient)
                .frame(width: 62, height: 86)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 5) {
                Text(work.title).font(.subheadline.weight(.semibold)).lineLimit(2)
                Text(work.genres.prefix(2).joined(separator: " · "))
                    .font(.caption2).foregroundStyle(PlayarrStyle.muted).lineLimit(1)
                Text(work.addedAt.formatted(date: .abbreviated, time: .omitted))
                    .font(.caption2).foregroundStyle(PlayarrStyle.muted)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption.bold()).foregroundStyle(PlayarrStyle.muted)
        }
        .foregroundStyle(PlayarrStyle.ink)
        .frame(width: width)
        .frame(minHeight: 96)
        .padding(.horizontal, 12)
        .background(PlayarrStyle.surfaceStrong.opacity(0.62))
        .overlay { Rectangle().stroke(PlayarrStyle.line, lineWidth: 1) }
    }

    private var filterSheet: some View {
        NavigationStack {
            Form {
                Section("View") {
                    Picker("View", selection: $viewModel.viewMode) {
                        Label("List", systemImage: "list.bullet").tag(LibraryViewModel.ViewMode.list)
                        Label("Screen", systemImage: "rectangle.grid.2x2").tag(LibraryViewModel.ViewMode.screen)
                        Label("Covers", systemImage: "square.grid.3x3").tag(LibraryViewModel.ViewMode.cover)
                        if viewModel.selectedKind == .artist {
                            Label("Flow", systemImage: "rectangle.on.rectangle.angled").tag(LibraryViewModel.ViewMode.coverFlow)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                Section("Sort") {
                    Picker("Sort by", selection: $viewModel.sort) {
                        Text("Title").tag("title")
                        Text("Date added").tag("date_added")
                    }
                    Picker("Order", selection: $viewModel.order) {
                        Text(viewModel.sort == "title" ? "A–Z" : "Oldest first").tag("asc")
                        Text(viewModel.sort == "title" ? "Z–A" : "Newest first").tag("desc")
                    }
                    .pickerStyle(.segmented)
                }
            }
            .scrollContentBackground(.hidden)
            .background(PlayarrStyle.background)
            .navigationTitle("Library filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        showingFilters = false
                        Task { await viewModel.load() }
                    }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "sparkle.magnifyingglass")
                .font(.system(size: 38, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text(viewModel.searchText.isEmpty ? "Nothing here yet" : "No results")
                .font(.custom("Avenir Next", fixedSize: 20).weight(.bold))
            if !viewModel.searchText.isEmpty {
                Text("Try another title, artist, genre, or tag.")
                    .font(.custom("Avenir Next", fixedSize: 12))
                    .foregroundStyle(PlayarrStyle.inkSoft)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(PlayarrStyle.ink)
    }
}

private struct LibraryWorkFrameKey: PreferenceKey {
    static var defaultValue: [UUID: CGRect] = [:]

    static func reduce(value: inout [UUID: CGRect], nextValue: () -> [UUID: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        LibraryView(kind: .movie, apiClient: apiClient, downloadRepository: DownloadRepository(apiClient: apiClient))
    }
}
