import PlayarrKit
import SwiftUI

enum HomeLayout {
    static let phoneGutter: CGFloat = 16
    static let phoneTopOffset: CGFloat = 78

    static func backdropHeight(viewportHeight: CGFloat, phone: Bool) -> CGFloat {
        phone ? viewportHeight * 0.55 : viewportHeight
    }

    static func carouselHeight(cardWidth: CGFloat, phone: Bool) -> CGFloat {
        cardWidth * 9 / 16 + (phone ? 52 : 46)
    }

    static func railWidth(viewportWidth: CGFloat, phone: Bool) -> CGFloat {
        phone ? viewportWidth : viewportWidth * 0.549 // web tablet: rails start at 616 pt of 1366 (cards at 640)
    }

    static func cardWidth(viewportWidth: CGFloat, phone: Bool) -> CGFloat {
        phone ? min(210, viewportWidth * 0.46) : viewportWidth * 0.167 // 228 pt at 1366
    }
}

struct HomeView: View {
    let viewModel: HomeViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var downloadTarget: Work?
    /// Hardware-keyboard focus (Tab and arrows): the ring follows it, and starts on the first card as on the web.
    @FocusState private var focusedWork: UUID?
    @Environment(\.colorScheme) private var scheme
    @AppStorage(WMArtwork.homeViewKey) private var homeView = "thumbnail"
    @State private var motionRail: Int?
    @AppStorage(WMArtwork.sizeKey) private var artworkSize = "medium"

    var body: some View {
        Group {
            switch viewModel.loadState {
            case .idle, .loading:
                PlayarrLoadingView(title: "Preparing your home…")
            case .failed(let message):
                PlayarrFailureView(title: "Home isn’t available", message: message) {
                    Task { await viewModel.load() }
                }
            case .loaded:
                loadedContent
            }
        }
        .sheet(item: $downloadTarget) { work in
            WorkDownloadSheet(work: work, apiClient: apiClient, downloadRepository: downloadRepository)
        }
        .task {
            if case .idle = viewModel.loadState { await viewModel.load() }
        }
    }

    private var loadedContent: some View {
        GeometryReader { proxy in
            if PlayarrLayout.isPhone(proxy.size) {
                phoneContent
            } else {
                stageContent(proxy: proxy)
            }
        }
        .background(PlayarrStyle.surface)
        .ignoresSafeArea(edges: .horizontal)
        .navigationBarHidden(true)
    }

    /// Web mobile home: left-aligned horizontal rails under the page gutter,
    /// 179x101 cards, no featured-title copy (numbers from the web layout dump).
    private var phoneContent: some View {
        ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            WMKeyArt(
                work: viewModel.featuredWork, apiClient: apiClient, lightOpacity: 0.41, webMask: true,
                fadeStops: [(0, 0), (84, 0), (148, 1)]
            )
            ScrollViewReader { vertical in
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(viewModel.rails.enumerated()), id: \.element.id) { index, rail in
                        phoneRail(rail, first: index == 0, index: index).id(rail.id)
                    }
                }
                .padding(.top, 91.67 + WM.topShift)
                .padding(.bottom, 130)
            }
            .task(id: viewModel.rails.count) { await runMotion(vertical) }
            .scrollIndicators(.hidden)
            .refreshable { await viewModel.load() }
            .keepInsideSafeArea()
            .webEdgeFade(.vertical, size: 38)
            }
        }
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    /// Debug parity captures and the navigation UI test can focus the first Series card.
    private func scrollTarget(_ rail: HomeViewModel.Rail, first: Bool, index: Int) -> UUID? {
        #if DEBUG
        if motionRail == index, let last = rail.works.last { return last.id }
        if ParityLaunch.selectsHomeSeries,
           let series = rail.works.first(where: { $0.kind == .series }) { return series.id }
        if ParityLaunch.focus == "last", let last = rail.works.last { return last.id }
        if first, let card = ParityLaunch.homeScrollCard, rail.works.indices.contains(card) { return rail.works[card].id }
        #endif
        return nil
    }

    /// Parity motion script: each step is recorded so the driver bursts frames while the scroll settles.
    private func runMotion(_ vertical: ScrollViewProxy) async {
        #if DEBUG
        guard ParityLaunch.motion, viewModel.rails.count > 1 else { return }
        var step = 0
        func mark() async { step += 1; ParityLaunch.record("motionStep", step); try? await Task.sleep(nanoseconds: 4_000_000_000) }
        try? await Task.sleep(nanoseconds: 16_000_000_000)
        let rails = viewModel.rails
        for i in 1..<rails.count { withAnimation(.easeInOut(duration: 0.6)) { vertical.scrollTo(rails[i].id, anchor: UnitPoint(x: 0, y: 98 / (UIScreen.main.bounds.height - 215))) }; await mark() }
        for i in stride(from: rails.count - 2, through: 0, by: -1) { withAnimation(.easeInOut(duration: 0.6)) { vertical.scrollTo(rails[i].id, anchor: UnitPoint(x: 0, y: 98 / (UIScreen.main.bounds.height - 215))) }; await mark() }
        for i in 0..<rails.count { motionRail = i; await mark() }
        ParityLaunch.record("motionDone", true)
        #endif
    }

    private func phoneRailFocused(first: Bool, index: Int, count: Int) -> Bool {
        #if DEBUG
        if let focus = ParityLaunch.focus { return focus == "last" ? index == count - 1 : index == 0 }
        #endif
        return first && index == 0
    }

    private func phoneRail(_ rail: HomeViewModel.Rail, first: Bool, index railIndex: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            WMText(rail.title, 16, 610, lh: 24, ls: -0.48).padding(.horizontal, 16)
            WMFadingRail(scrollTo: scrollTarget(rail, first: first, index: railIndex), scrollAnchor: (ParityLaunch.focus == "last" || motionRail == railIndex) ? UnitPoint(x: 1 - 16 / UIScreen.main.bounds.width, y: 0.5) : .leading) {
                LazyHStack(alignment: .top, spacing: 12) {
                    ForEach(Array(rail.works.enumerated()), id: \.element.id) { index, work in
                        workLink(work) {
                            WMRailCard(
                                work: work,
                                apiClient: apiClient,
                                unseen: viewModel.progressByWorkID[work.id] == nil,
                                focused: focusedWork.map { $0 == work.id } ?? phoneRailFocused(first: first, index: index, count: rail.works.count),
                                cover: homeView == "cover"
                            )
                        }
                        .id(work.id)
                    }
                }
                .padding(.horizontal, 16)
            }
            .frame(height: WMRailCard.height(cover: homeView == "cover"))
            .padding(.top, 18)
        }
        .padding(.bottom, 45.33)
    }

    private func stageContent(proxy: GeometryProxy) -> some View {
        Group {
            let phone = false
            let backdropHeight = proxy.size.height + proxy.safeAreaInsets.top + proxy.safeAreaInsets.bottom
            ZStack(alignment: .topLeading) {
                stageBackdrop(phone: phone, height: backdropHeight)
                    .ignoresSafeArea()

                if !phone, let featured = viewModel.featuredWork {
                    featuredCopy(featured)
                        .frame(width: proxy.size.width * 0.205, alignment: .leading)
                        .padding(.leading, proxy.size.width * 0.088)
                        .padding(.top, proxy.size.height * 0.24)
                }

                rails(
                    phone: phone,
                    width: proxy.size.width,
                    height: proxy.size.height
                )
                    .frame(
                        width: HomeLayout.railWidth(viewportWidth: proxy.size.width, phone: phone),
                        height: proxy.size.height,
                        alignment: .topLeading
                    )
                    .offset(x: phone ? 0 : proxy.size.width * 0.451)
                    .zIndex(2)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }

    @ViewBuilder
    private func stageBackdrop(phone: Bool, height: CGFloat) -> some View {
        ZStack(alignment: .top) {
            PlayarrStyle.surface
            if let featured = viewModel.featuredWork {
                PlayarrArtwork(work: featured, kind: .backdrop, apiClient: apiClient)
                    .frame(maxWidth: .infinity)
                    .frame(height: HomeLayout.backdropHeight(viewportHeight: height, phone: phone))
                    .opacity(phone ? 0.42 : (scheme == .dark ? 0.22 : 0.12))
            }
            LinearGradient(
                stops: phone
                    ? [
                        .init(color: .clear, location: 0.12),
                        .init(color: PlayarrStyle.surface.opacity(0.34), location: 0.33),
                        .init(color: PlayarrStyle.surface, location: 0.52),
                    ]
                    : [
                        .init(color: PlayarrStyle.surface.opacity(0.12), location: 0),
                        .init(color: PlayarrStyle.surface.opacity(0.36), location: 1),
                    ],
                startPoint: .top,
                endPoint: .bottom
            )
            LinearGradient(
                colors: [PlayarrStyle.surface.opacity(phone ? 0.28 : 0.5), .clear],
                startPoint: .leading,
                endPoint: .trailing
            )
        }
    }

    private func featuredCopy(_ work: Work) -> some View {
        NavigationLink {
            WorkDetailView(
                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                apiClient: apiClient,
                downloadRepository: downloadRepository
            )
        } label: {
            VStack(alignment: .leading, spacing: 13) {
                Text(([work.kind.displayName] + work.genres.prefix(1)).joined(separator: " · ").uppercased())
                    .font(WM.font(8.6, 800))
                    .tracking(1.1)
                    .foregroundStyle(PlayarrStyle.pink)

                Text(work.title)
                    .font(WM.font(46, 400))
                    .tracking(-1.6)
                    .lineSpacing(-4)
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(3)

                if let overview = work.overview {
                    Text(overview)
                        .font(WM.font(11.5, 500))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .lineSpacing(2.5)
                        .lineLimit(4)
                        .frame(maxWidth: 232, alignment: .leading)
                }
            }
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("Download", systemImage: "arrow.down.circle") { downloadTarget = work }
        }
    }

    private func rails(phone: Bool, width: CGFloat, height: CGFloat) -> some View {
        let railWidth = HomeLayout.railWidth(viewportWidth: width, phone: phone)
        return ScrollView(.vertical) {
            LazyVStack(alignment: .leading, spacing: phone ? 24 : 80) {
                ForEach(viewModel.rails) { rail in
                    mediaRail(rail, phone: phone, width: width)
                }
            }
            .frame(width: railWidth, alignment: .leading)
            .padding(.top, phone ? HomeLayout.phoneTopOffset : height * 0.395)
            .padding(.bottom, phone ? 112 : height * 0.5)
        }
        .refreshable { await viewModel.load() }
        .scrollIndicators(.hidden)
        .background {
            if phone {
                LinearGradient(
                    colors: [.clear, PlayarrStyle.surface.opacity(0.94), PlayarrStyle.surface],
                    startPoint: .top,
                    endPoint: .bottom
                )
            } else if scheme == .dark {
                LinearGradient(
                    colors: [.clear, PlayarrStyle.surface.opacity(0.9), PlayarrStyle.surface],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            }
        }
        .frame(
            width: railWidth,
            height: height,
            alignment: .topLeading
        )
    }

    private func mediaRail(_ rail: HomeViewModel.Rail, phone: Bool, width: CGFloat) -> some View {
        let covers = !phone && homeView == "cover"
        // Web: a poster is the Library cover card (5 columns at tablet width, one more or fewer by artwork size); a
        // thumbnail keeps its width but follows the size step the same way.
        let step = phone ? 0 : PlayarrArtworkPrefs.columnStep(artworkSize)
        let thumbWidth = HomeLayout.cardWidth(viewportWidth: width, phone: phone)
        let coverColumns = CGFloat(max(1, 5 + step))
        let posterWidth = (width * 0.65 - max(28, width * 0.058) - max(80, width * 0.065) - min(28, width * 0.0135) * (coverColumns - 1)) / coverColumns
        let mediaCardWidth = covers ? posterWidth : thumbWidth * 3 / CGFloat(max(1, 3 + step))
        let railWidth = HomeLayout.railWidth(viewportWidth: width, phone: phone)
        return VStack(alignment: .leading, spacing: phone ? 8 : 22) {
            VStack(alignment: .leading, spacing: 3) {
                Text(rail.title)
                    .font(phone ? .custom("Avenir Next", fixedSize: 16).weight(.semibold) : WM.font(13.5, 500))
                    .tracking(phone ? -0.4 : -0.2)
                    .foregroundStyle(PlayarrStyle.ink)
                if phone { Text("\(rail.works.count) titles")
                    .font(.custom("Avenir Next", fixedSize: phone ? 10.5 : 8.5).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.muted) }
            }
            .padding(.horizontal, phone ? HomeLayout.phoneGutter : 24)

            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: phone ? 12 : 18) {
                    ForEach(rail.works) { work in
                        workLink(work) {
                            if covers {
                                PlayarrPosterCard(work: work, apiClient: apiClient, width: mediaCardWidth)
                            } else {
                                PlayarrMediaCard(
                                    work: work,
                                    apiClient: apiClient,
                                    progress: viewModel.progressByWorkID[work.id],
                                    width: mediaCardWidth
                                )
                            }
                        }
                    }
                }
                .padding(.horizontal, phone ? HomeLayout.phoneGutter : 24)
                .padding(.vertical, 8)
            }
            .scrollClipDisabled() // card shadows and the focus glow reach past the rail's frame, as on web
            .frame(
                width: railWidth,
                height: covers ? mediaCardWidth * 1.5 + 46 : HomeLayout.carouselHeight(cardWidth: mediaCardWidth, phone: phone),
                alignment: .leading
            )
            .scrollIndicators(.hidden)
        }
        .frame(width: railWidth, alignment: .leading)
    }

    private func workLink<Content: View>(_ work: Work, @ViewBuilder content: () -> Content) -> some View {
        NavigationLink {
            WorkDetailView(
                viewModel: WorkDetailViewModel(apiClient: apiClient, workID: work.id),
                apiClient: apiClient,
                downloadRepository: downloadRepository
            )
        } label: {
            content()
        }
        .buttonStyle(.plain)
        .focusable()
        .focused($focusedWork, equals: work.id)
        .focusEffectDisabled()
        .accessibilityIdentifier(homeWorkAccessibilityID(work))
        .accessibilityLabel(work.title)
        .contextMenu {
            Button("Download", systemImage: "arrow.down.circle") { downloadTarget = work }
        }
    }

    private func homeWorkAccessibilityID(_ work: Work) -> String {
        let kind = work.kind == .series ? "series" : "work"
        return "home-\(kind)-work-\(work.id.uuidString)"
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        HomeView(
            viewModel: HomeViewModel(apiClient: apiClient),
            apiClient: apiClient,
            downloadRepository: DownloadRepository(apiClient: apiClient)
        )
    }
}

/// A horizontal rail with the web's edge fade: once the track has scrolled, a mask fades the cards that pass the page
/// gutter (`.tv-media-track-window.can-scroll-left`: transparent at the window's edge to opaque one gutter in). Cards
/// vanish under it rather than hard-cutting. `scrollTo` moves the track to that card on appear (parity captures).
struct WMFadingRail<Content: View>: View {
    var scrollTo: UUID?
    var scrollAnchor: UnitPoint = .leading
    @ViewBuilder var content: () -> Content
    @State private var offset: CGFloat = 0
    @State private var contentWidth: CGFloat = 0

    /// Web scroll-edge fade (`page-layout.css`): smoothstep ramps. The start side is a clear 16 pt ramp once scrolled; the end
    /// side, while content continues, dims to 30% over 38 pt at the edge (content stays visible going off screen).
    private var maskStops: [Gradient.Stop] {
        let w = UIScreen.main.bounds.width
        let ease: [(CGFloat, CGFloat)] = [(0, 0), (0.25, 0.156), (0.5, 0.5), (0.75, 0.844), (1, 1)]
        var stops: [Gradient.Stop] = []
        if offset > 1 {
            stops += ease.map { .init(color: .black.opacity($0.1), location: 16 * $0.0 / w) }
        } else {
            stops.append(.init(color: .black, location: 0))
            stops.append(.init(color: .black, location: 16 / w))
        }
        if contentWidth - offset > w + 1 {
            stops += ease.reversed().map { .init(color: .black.opacity(0.3 + 0.7 * $0.1), location: 1 - 38 * $0.0 / w) }
        } else {
            stops.append(.init(color: .black, location: 1))
        }
        return stops
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal) {
                content()
                    .background(GeometryReader { geo in
                        Color.clear.preference(key: WMRailOffsetKey.self, value: -geo.frame(in: .named("wm-rail")).minX)
                            .preference(key: WMRailWidthKey.self, value: geo.size.width)
                    })
            }
            .coordinateSpace(name: "wm-rail")
            .onPreferenceChange(WMRailOffsetKey.self) { offset = $0 }
            .onPreferenceChange(WMRailWidthKey.self) { contentWidth = $0 }
            .scrollClipDisabled()
            .scrollIndicators(.hidden)
            .mask(
                LinearGradient(stops: maskStops, startPoint: .leading, endPoint: .trailing)
                // The mask must not clip the focused card's shadow above and below the track.
                .padding(.vertical, -60)
            )
            .onChange(of: scrollTo) { _, new in
                if let new { withAnimation(.easeInOut(duration: 0.6)) { proxy.scrollTo(new, anchor: scrollAnchor) } }
            }
            .task {
                guard let scrollTo else { return }
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                proxy.scrollTo(scrollTo, anchor: scrollAnchor)
            }
        }
    }
}

private struct WMRailWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct WMRailOffsetKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
