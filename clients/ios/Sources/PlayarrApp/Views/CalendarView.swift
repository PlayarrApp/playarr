import PlayarrKit
import SwiftUI

/// Release Calendar: Agenda (master-detail on wide screens), Week and Month, with the shared page
/// header, a Filters sheet and the iCal subscription sheet. Parity with Web `CalendarPage` and the
/// Android calendar; all logic is in `PlayarrKit` and `CalendarViewModel`.
struct CalendarView: View {
    @Environment(\.playarrGoHome) private var goHome
    @State private var viewModel: CalendarViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository
    @State private var showingFilters = false
    @State private var showingSubscription = false
    @State private var detailItem: CalendarItem?
    @State private var moreDay: String?

    init(apiClient: PlayarrAPIClient, downloadRepository: DownloadRepository) {
        self.apiClient = apiClient
        self.downloadRepository = downloadRepository
        #if DEBUG
        // The parity capture freezes the web clock; the native calendar follows the same instant.
        let frozen = ParityLaunch.frozenNow
        let model = CalendarViewModel(
            transport: apiClient,
            firstWeekday: PlayarrKit.calendarFirstWeekday(
                language: UserDefaults.standard.string(forKey: "com.playarr.ios.language") ?? "system",
                systemLanguage: Locale.current.language.languageCode?.identifier
            ),
            now: { frozen ?? Date() }
        )
        if let mode = ParityLaunch.calendarMode { model.mode = mode }
        _viewModel = State(initialValue: model)
        #else
        _viewModel = State(initialValue: CalendarViewModel(
            transport: apiClient,
            firstWeekday: PlayarrKit.calendarFirstWeekday(
                language: UserDefaults.standard.string(forKey: "com.playarr.ios.language") ?? "system",
                systemLanguage: Locale.current.language.languageCode?.identifier
            )
        ))
        #endif
    }

    private var calendarLocale: Locale {
        let language = UserDefaults.standard.string(forKey: "com.playarr.ios.language") ?? "system"
        return Locale(identifier: PlayarrKit.calendarLocaleIdentifier(language: language, systemLanguage: Locale.current.language.languageCode?.identifier))
    }

    var body: some View {
        GeometryReader { proxy in
            let phone = PlayarrLayout.isPhone(proxy.size)
            if phone {
                phoneBody
            } else {
            VStack(alignment: .leading, spacing: 12) {
                header(phone: phone)
                controls(phone: phone)
                if !viewModel.unhealthySources.isEmpty { sourceBanner }
                content(phone: phone)
            }
            .padding(.leading, phone ? 16 : 120)
            .padding(.trailing, phone ? 16 : 40)
            .padding(.top, phone ? 56 : 40)
            .padding(.bottom, phone ? 84 : 24)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
            }
        }
        .background(PlayarrStyle.background.ignoresSafeArea())
        .foregroundStyle(PlayarrStyle.ink)
        .navigationBarHidden(true)
        .parityScreenLoad(parityLoadState)
        .task { if viewModel.response == nil { await viewModel.load() } }
        .sheet(isPresented: $showingFilters) {
            CalendarFiltersSheet(viewModel: viewModel)
        }
        .sheet(isPresented: $showingSubscription) {
            CalendarSubscriptionSheet(viewModel: viewModel)
        }
        .sheet(item: $detailItem) { item in
            NavigationStack {
                ScrollView {
                    CalendarDetailPane(item: item, apiClient: apiClient, downloadRepository: downloadRepository)
                        .padding(20)
                }
                .background(PlayarrStyle.background)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { detailItem = nil } }
                }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: Binding(
            get: { moreDay != nil },
            set: { if !$0 { moreDay = nil } }
        )) {
            NavigationStack {
                ScrollView {
                    if let day = moreDay, let group = viewModel.dayGroups.first(where: { $0.day == day }) {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(group.items) { item in
                                NavigationLink {
                                    ScrollView {
                                        CalendarDetailPane(item: item, apiClient: apiClient, downloadRepository: downloadRepository)
                                            .padding(20)
                                    }
                                    .background(PlayarrStyle.background)
                                    .navigationTitle(item.title)
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: "calendar").frame(width: 22).foregroundStyle(PlayarrStyle.inkSoft)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(item.title).font(.custom("Avenir Next", fixedSize: 14).weight(.semibold)).lineLimit(1)
                                            Text(weekSubtitle(item)).font(.custom("Avenir Next", fixedSize: 11)).foregroundStyle(PlayarrStyle.inkSoft).lineLimit(1)
                                        }
                                        Spacer(minLength: 6)
                                        if let entry = item.entries.first { agendaBadge(entry) }
                                    }
                                    .padding(10)
                                    .background(PlayarrStyle.surfaceStrong.opacity(0.5), in: RoundedRectangle(cornerRadius: 12))
                                }
                                .simultaneousGesture(TapGesture().onEnded { viewModel.select(item) })
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(20)
                    }
                }
                .background(PlayarrStyle.background)
                .navigationTitle(moreDay.map { dayHeading($0, today: viewModel.today).capitalized } ?? "Calendar")
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) { Button("Done") { moreDay = nil } }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var parityLoadState: ParityScreenLoad {
        switch viewModel.loadState {
        case .loaded where viewModel.response != nil: .ready
        case .failed: .failed
        default: .loading
        }
    }

    // MARK: Web mobile layout

    private var phoneRangeLabel: String {
        let window = viewModel.window
        guard let start = CalendarDays.displayDate(window.start), let end = CalendarDays.displayDate(window.end) else {
            return viewModel.windowTitle
        }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? .current
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = utc.timeZone
        if viewModel.mode == .month, let anchor = CalendarDays.displayDate(viewModel.anchor) {
            formatter.dateFormat = "MMMM yyyy"
            return formatter.string(from: anchor)
        }
        let sameYear = utc.component(.year, from: start) == utc.component(.year, from: end)
        formatter.dateFormat = sameYear ? "d MMM" : "d MMM yyyy"
        let first = formatter.string(from: start)
        if sameYear {
            // The web wraps the range after the end month, leaving the year on its own line.
            formatter.dateFormat = "d MMM"
            let last = formatter.string(from: end)
            formatter.dateFormat = "yyyy"
            return "\(first) \u{2013} \(last)"
        }
        formatter.dateFormat = "d MMM yyyy"
        return "\(first) \u{2013} \(formatter.string(from: end))"
    }

    private func roundButton(_ glyph: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            WMText(glyph, 11.52, 720, color: WM.inkSoft, lh: 17.28)
                .frame(width: 44, height: 44)
                .background(Circle().fill(WM.page))
                .overlay(Circle().stroke(WM.line.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    /// Web mobile calendar: header with link and filter buttons, the range picker with
    /// previous, Today and next controls, then the agenda (numbers from the web layout).
    private var phoneBody: some View {
        let top = WM.topInset + 2
        return ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 12) {
                if !viewModel.unhealthySources.isEmpty { sourceBanner }
                switch viewModel.loadState {
                case .loading:
                    CalendarSkeleton()
                case .failed(let message):
                    PlayarrFailureView(title: "Couldn\u{2019}t load the calendar", message: message) {
                        Task { await viewModel.load() }
                    }
                case .loaded:
                    if viewModel.dayGroups.isEmpty {
                        phoneEmpty
                    } else if viewModel.mode == .agenda {
                        Color.clear.frame(height: 1)
                    } else {
                        loaded(phone: true)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 212)
            .padding(.bottom, 120)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            if case .loaded = viewModel.loadState, !viewModel.dayGroups.isEmpty, viewModel.mode == .agenda {
                phoneAgenda(groups: viewModel.dayGroups)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }

            WMHeaderCircleButton(width: 44, height: 44, glyph: "\u{2190}", action: goHome)
                .offset(x: 16, y: top)
            WMText("Calendar", 17.6, 580, lh: 26.4, ls: -0.792)
                .frame(height: 44)
                .offset(x: 70, y: top)
            // The shell action buttons: 44 pt tiles in the right gutter (web phone, 393 pt wide).
            PlayarrHeaderPill(label: "Calendar link", systemImage: "bell", iconOnly: true) { showingSubscription = true }
                .offset(x: screenWidth - 111, y: WM.topInset)
            PlayarrHeaderPill(label: "Filters", systemImage: "slider.horizontal.3", iconOnly: true) { showingFilters = true }
                .offset(x: screenWidth - 60, y: WM.topInset)

            // Range picker, previous, Today and next, right-aligned in the gutter; Agenda sits 18 pt higher than Week and Month.
            HStack(spacing: 8) {
                Menu {
                    Picker("View", selection: Binding(
                        get: { viewModel.mode },
                        set: { newMode in Task { await viewModel.setMode(newMode) } }
                    )) {
                        Text("Agenda").tag(CalendarViewMode.agenda)
                        Text("Week").tag(CalendarViewMode.week)
                        Text("Month").tag(CalendarViewMode.month)
                    }
                } label: {
                    WMText(phoneRangeLabel, 11.52, 720, color: WM.inkSoft, lh: 17.28)
                        .fixedSize()
                        .padding(.horizontal, 20.5)
                        .frame(height: 44)
                        .background(WM.page, in: Capsule())
                        .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
                }
                roundButton("\u{2190}", label: "Previous period") { Task { await viewModel.step(-1) } }
                Button { Task { await viewModel.goToToday() } } label: {
                    WMText("Today", 11.52, 720, color: WM.inkSoft, lh: 17.28)
                        .frame(width: 74, height: 44)
                        .background(WM.page, in: Capsule())
                        .overlay(Capsule().stroke(WM.line.opacity(0.14), lineWidth: 1))
                        // The web draws a 3 px focus ring 2 px outside the button.
                        .overlay(Capsule().stroke(WM.ink, lineWidth: 3).padding(-3.7))
                }
                .buttonStyle(.plain)
                roundButton("\u{2192}", label: "Next period") { Task { await viewModel.step(1) } }
            }
            .frame(width: screenWidth - 16, alignment: .trailing)
            .offset(x: 0, y: (viewModel.mode == .agenda ? 68 : 86) + WM.topShift)
        }
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    private func chipLabel(_ text: String, size: CGFloat = 10.4, ls: CGFloat = 1.6, weight: Int = 400) -> some View {
        WMText(text, size, weight, color: WM.muted, lh: 15.6, ls: ls)
    }

    private func releaseTypeLabel(_ type: String) -> String {
        switch type {
        case "air": "Airs"
        case "cinema": "In cinemas"
        case "digital": "Digital release"
        case "physical": "Physical release"
        default: "Releases"
        }
    }

    private func kindLabel(_ kind: String) -> String {
        switch kind {
        case "episode": "Episodes"
        case "movie": "Movies"
        case "album": "Albums"
        case "book": "Books"
        default: "Releases"
        }
    }

    private var screenWidth: CGFloat { UIScreen.main.bounds.width }

    /// Web mobile agenda: day headings and release cards under the toolbar (page coordinates from the web layout dump).
    private func phoneAgenda(groups: [CalendarDayGroup]) -> some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(groups) { group in
                    HStack(spacing: 12) {
                        WMText(Self.groupFormatter.string(from: CalendarDays.displayDate(group.day) ?? Date()), 14.4, 640, color: WM.inkSoft, lh: 22)
                        if group.day == viewModel.today {
                            WMText("TODAY", 10.4, 700, color: WM.inkSoft, lh: 15.6, ls: 1.5)
                                .fixedSize()
                                .padding(.horizontal, 12)
                                .frame(height: 21)
                                .overlay(Capsule().stroke(WM.inkSoft, lineWidth: 1))
                        }
                    }
                    .padding(.top, group.id == groups.first?.id ? 0 : 43)
                    ForEach(Array(group.items.enumerated()), id: \.element.id) { index, row in
                        phoneAgendaCard(row).padding(.top, index == 0 ? 25 : 15)
                    }
                }
            }
            .padding(.leading, 16)
            .padding(.top, 130 + WM.topShift)
            .padding(.bottom, 130)
            .frame(width: screenWidth, alignment: .topLeading)
        }
        .scrollIndicators(.hidden)
        .keepInsideSafeArea()
    }

    private func termLabel(_ text: String) -> some View {
        WMText(text, 11.52, 400, color: WM.muted, lh: 17, ls: 1.152)
    }

    private func statusBadge(_ text: String, size: CGFloat, height: CGFloat) -> some View {
        WMText(text, size, 640, lh: height)
            .fixedSize()
            .padding(.horizontal, size == 16 ? 8 : 6)
            .background(Color(red: 0.357, green: 0.498, blue: 0.820).opacity(0.24), in: Capsule())
    }

    /// Agenda card state as the web shows it: Available once a file exists, Upcoming before the day, else Missing.
    private func agendaBadge(_ entry: CalendarEntry) -> some View {
        let (label, tint): (String, Color) = entry.hasFile
            ? ("Available", Color(red: 0.42, green: 0.55, blue: 0.50))
            : entry.date > viewModel.today ? ("Upcoming", Color(red: 0.357, green: 0.498, blue: 0.820)) : ("Missing", Color(red: 0.62, green: 0.45, blue: 0.47))
        return WMText(label, 11.5, 700, lh: 19)
            .fixedSize()
            .padding(.horizontal, 14)
            .frame(height: 22)
            .background(tint.opacity(0.24), in: Capsule())
            .overlay(Capsule().stroke(tint, lineWidth: 1.5))
    }

    private func statusLabel(_ entry: CalendarEntry) -> String {
        switch entry.libraryState {
        case .inLibrary: "In library"
        case .monitored: "Monitored"
        case .notMonitored: "Not monitored"
        }
    }

    /// The action row as the server computed it (`CalendarAction`); a server without computed actions keeps the earlier
    /// `hasFile` rule.
    private func phoneActions(item: CalendarItem, entry: CalendarEntry) -> some View {
        let serverActions = !entry.actions.isEmpty
        let play = entry.action(.play) ?? entry.action(.resume)
        let showPlay = serverActions ? play?.enabled == true : entry.hasFile
        let showOpen = serverActions ? entry.action(.open)?.enabled == true : true
        let watchlist = entry.action(.watchlist)
        let showWatchlist = serverActions ? watchlist?.enabled == true : true
        let removing = watchlist?.active == true
        return HStack(spacing: 9) {
            if let mediaWork = entry.workID {
                if showPlay {
                    NavigationLink {
                        WorkDetailView(
                            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: mediaWork),
                            apiClient: apiClient,
                            downloadRepository: downloadRepository
                        )
                    } label: {
                        let resume = play?.kind == .resume
                        WMText(resume ? "Resume" : "Play", 11.52, 720, color: PlayarrStyle.onAccent, lh: 17)
                            .frame(width: resume ? 88 : 66, height: 44)
                            .background(PlayarrStyle.accent, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
                if showOpen {
                    NavigationLink {
                        WorkDetailView(
                            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: mediaWork),
                            apiClient: apiClient,
                            downloadRepository: downloadRepository
                        )
                    } label: {
                        let primary = !showPlay
                        WMText(entry.mediaKind == "episode" ? "Open series" : "Open", 11.52, 720,
                               color: primary ? PlayarrStyle.onAccent : WM.inkSoft, lh: 17)
                            .frame(width: entry.mediaKind == "episode" ? 106 : 70, height: 44)
                            .background(primary ? PlayarrStyle.accent : WM.page, in: Capsule())
                            .overlay(Capsule().stroke(primary ? Color.clear : WM.line.opacity(0.2), lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                }
            }
            if showWatchlist {
                HStack(spacing: 10) {
                    WMText(removing ? "\u{2212}" : "+", 11.52, 720, color: WM.inkSoft, lh: 17).fixedSize()
                    WMText(removing ? "Remove from watchlist" : "Add to watchlist", 11.52, 900, color: WM.inkSoft, lh: 17).fixedSize()
                }
                .frame(width: removing ? 182 : 152, height: 44)
                .background(WM.page, in: Capsule())
                .overlay(Capsule().stroke(WM.line.opacity(0.2), lineWidth: 1))
            }
        }
    }

    private func phoneAgendaCard(_ item: CalendarItem) -> some View {
        let entry = item.entries.first
        return Button {
            viewModel.select(item)
        } label: {
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(PlayarrStyle.surfaceStrong)
                Group {
                    if let workID = entry?.workID {
                        WMRemoteImage(
                            apiClient: apiClient,
                            sources: [WMRemoteImage.Source(path: "/api/v1/artwork/work/\(workID.uuidString)/poster")]
                        )
                    } else {
                        WM.artFill
                    }
                }
                .frame(width: 40, height: 60)
                .background(WM.artFill)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                .offset(x: 16, y: 15)
                WMText(item.title, 16, 640, lh: 24).frame(width: 220, alignment: .leading).offset(x: 70, y: 9)
                if let entry {
                    WMText(
                        [entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " \u{00B7} "),
                        16, 400, color: WM.inkSoft, lh: 24
                    )
                    .frame(width: 220, alignment: .leading)
                    .offset(x: 70, y: 35)
                    HStack(spacing: 12) {
                        let time = calendarTimeLabel24(entry)
                        WMText(time.isEmpty || time == "00:00" ? "All day" : time, 12.8, 400, color: WM.inkSoft, lh: 19).fixedSize()
                        WMText(releaseTypeLabel(entry.releaseType), 12.8, 400, color: WM.inkSoft, lh: 19).fixedSize()
                        WMText(kindLabel(entry.mediaKind), 12.8, 400, color: WM.inkSoft, lh: 19).fixedSize()
                        agendaBadge(entry)
                    }
                    .offset(x: 70, y: 60)
                }
            }
            .frame(width: 460, height: 91, alignment: .topLeading)
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(WM.line.opacity(0.14), lineWidth: 1)
            )
            .overlay(alignment: .leading) {
                // The web card's 4 pt leading accent: green once in the library, ink while missing.
                Rectangle().fill(entry?.hasFile == true ? Color(red: 0.12, green: 0.33, blue: 0.25) : WM.ink)
                    .frame(width: 4).clipShape(RoundedRectangle(cornerRadius: 2))
            }
        }
        .buttonStyle(.plain)
        .wmKeyFocus(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func calendarTimeLabel24(_ entry: CalendarEntry) -> String {
        guard let at = entry.releaseAt else { return "" }
        return Self.timeFormatter.string(from: at)
    }

    private static let releaseFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEEE, d MMMM yyyy 'at' HH:mm"
        return formatter
    }()

    private static let groupFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEEE d MMMM"
        return formatter
    }()

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_GB")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private var phoneEmpty: some View {
        VStack(alignment: .leading, spacing: 0) {
            WMText(
                viewModel.filters.isEmpty ? "Nothing scheduled" : "No releases match these filters",
                16, 700, lh: 24
            )
            Text("No releases from your connected sources fall in this period.")
                .font(WM.font(16))
                .foregroundStyle(WM.muted)
                .frame(width: 358, alignment: .topLeading)
                .padding(.top, 10)
            Text("Select a release to see its details.")
                .font(WM.font(16))
                .foregroundStyle(WM.muted)
                .frame(width: 358, alignment: .topLeading)
                .padding(.top, 36)
        }
    }

    // MARK: Header and controls

    private func header(phone: Bool) -> some View {
        PlayarrPageHeader(
            title: "Calendar",
            detail: viewModel.windowTitle,
            phone: phone,
            filterCount: viewModel.filters.activeCount,
            onFilters: { showingFilters = true }
        ) {
            PlayarrHeaderPill(label: "Calendar link", systemImage: "bell", iconOnly: phone) {
                showingSubscription = true
            }
        }
        // Keep clear of the profile button the shell floats at the top right on phones.
        .padding(.trailing, phone ? 52 : 0)
    }

    private func controls(phone: Bool) -> some View {
        HStack(spacing: 10) {
            Picker("View", selection: Binding(
                get: { viewModel.mode },
                set: { newMode in Task { await viewModel.setMode(newMode) } }
            )) {
                Text("Agenda").tag(CalendarViewMode.agenda)
                Text("Week").tag(CalendarViewMode.week)
                Text("Month").tag(CalendarViewMode.month)
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 280)

            Spacer(minLength: 0)

            Button { Task { await viewModel.step(-1) } } label: { Image(systemName: "chevron.left") }
                .accessibilityLabel("Previous period")
            Button("Today") { Task { await viewModel.goToToday() } }
            Button { Task { await viewModel.step(1) } } label: { Image(systemName: "chevron.right") }
                .accessibilityLabel("Next period")
        }
        .buttonStyle(.bordered)
        .tint(PlayarrStyle.inkSoft)
    }

    private var sourceBanner: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(viewModel.unhealthySources) { source in
                Text("\(source.name): \(sourceProblem(source))")
                    .font(.custom("Avenir Next", fixedSize: 11).weight(.semibold))
            }
        }
        .foregroundStyle(PlayarrStyle.danger)
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PlayarrStyle.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }

    private func sourceProblem(_ source: CalendarSourceStatus) -> String {
        switch source.status {
        case "unreachable": return "could not be reached, so its releases may be missing"
        case "rejected": return "refused the stored credentials"
        default: return "failed, so its releases may be missing"
        }
    }

    // MARK: Content

    @ViewBuilder
    private func content(phone: Bool) -> some View {
        switch viewModel.loadState {
        case .loading:
            CalendarSkeleton()
        case .failed(let message):
            PlayarrFailureView(title: "Couldn\u{2019}t load the calendar", message: message) {
                Task { await viewModel.load() }
            }
        case .loaded:
            loaded(phone: phone)
        }
    }

    @ViewBuilder
    private func loaded(phone: Bool) -> some View {
        switch viewModel.mode {
        case .agenda:
            agenda(phone: phone)
        case .week:
            if phone { weekTrack } else { dayList(groups: viewModel.dayGroups, phone: false) }
        case .month:
            monthView(phone: phone)
        }
    }

    private func agenda(phone: Bool) -> some View {
        let groups = viewModel.dayGroups
        return Group {
            if groups.isEmpty {
                emptyState
            } else if phone {
                dayList(groups: groups, phone: true)
            } else {
                // Wide screens: details on the left, the list on the right.
                HStack(alignment: .top, spacing: 24) {
                    ScrollView {
                        if let item = viewModel.selectedItem ?? groups.first?.items.first {
                            CalendarDetailPane(item: item, apiClient: apiClient, downloadRepository: downloadRepository)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    dayList(groups: groups, phone: false)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func dayList(groups: [CalendarDayGroup], phone: Bool) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14, pinnedViews: []) {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(dayHeading(group.day, today: viewModel.today))
                            .font(.custom("Avenir Next", fixedSize: 11).weight(.heavy))
                            .tracking(0.6)
                            .foregroundStyle(group.day == viewModel.today ? PlayarrStyle.pink : PlayarrStyle.muted)
                        if group.items.isEmpty {
                            Text("Nothing scheduled")
                                .font(.custom("Avenir Next", fixedSize: 12))
                                .foregroundStyle(PlayarrStyle.muted)
                        }
                        ForEach(group.items) { item in
                            CalendarItemRow(item: item, selected: viewModel.selectedKey == item.id) {
                                viewModel.select(item)
                                if phone { detailItem = item }
                            }
                        }
                    }
                }
            }
        }
    }

    private var weekTrack: some View {
        GeometryReader { proxy in
            let laneWidth = max(300, screenWidth * 0.82)
            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 20) {
                    ForEach(viewModel.dayGroups) { group in
                        VStack(alignment: .leading, spacing: 6.4) {
                            Text(dayHeading(group.day, today: viewModel.today))
                                .font(.custom("Avenir Next", fixedSize: 14.4).weight(.semibold))
                                .foregroundStyle(group.day == viewModel.today ? PlayarrStyle.pink : PlayarrStyle.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            ScrollView {
                                LazyVStack(spacing: 13.6) {
                                    ForEach(group.items) { item in
                                        weekItemCard(item, width: laneWidth)
                                    }
                                    if group.items.isEmpty {
                                        Text("Nothing scheduled")
                                            .font(.custom("Avenir Next", fixedSize: 12))
                                            .foregroundStyle(PlayarrStyle.muted)
                                            .frame(maxWidth: .infinity, alignment: .leading)
                                            .padding(12)
                                    }
                                }
                            }
                        }
                        .frame(width: laneWidth, height: proxy.size.height, alignment: .topLeading)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
        }
    }

    private func weekItemCard(_ item: CalendarItem, width: CGFloat) -> some View {
        let entry = item.entries.first
        return Button {
            viewModel.select(item)
            detailItem = item
        } label: {
            HStack(alignment: .center, spacing: 14) {
                Group {
                    if let workID = entry?.workID {
                        WMRemoteImage(
                            apiClient: apiClient,
                            sources: [WMRemoteImage.Source(path: "/api/v1/artwork/work/\(workID.uuidString)/poster")]
                        )
                    } else {
                        WM.artFill
                    }
                }
                .frame(width: 40, height: 60)
                .background(WM.artFill)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))

                VStack(alignment: .leading, spacing: 2.4) {
                    Text(item.title)
                        .font(.custom("Avenir Next", fixedSize: 16).weight(.semibold))
                        .lineLimit(3)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(weekSubtitle(item))
                        .font(.custom("Avenir Next", fixedSize: 16))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .fixedSize(horizontal: false, vertical: true)
                    if let entry {
                        CalendarWeekMetadataLayout(horizontalSpacing: 12, verticalSpacing: 3.2) {
                            Text(calendarTimeLabel(entry) ?? "All day")
                            Text(releaseTypeLabel(entry.releaseType))
                            if item.entries.count == 1 { Text(kindLabel(entry.mediaKind)) }
                            agendaBadge(entry)
                        }
                        .font(.custom("Avenir Next", fixedSize: 12.8))
                        .foregroundStyle(PlayarrStyle.muted)
                    }
                }
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .frame(width: width, alignment: .leading)
            .frame(minHeight: 64, alignment: .leading)
            .background(PlayarrStyle.surfaceStrong, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2).fill(entry?.hasFile == true ? PlayarrStyle.accent : PlayarrStyle.ink)
                    .frame(width: 4).padding(.vertical, 8)
            }
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(WM.line.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func weekSubtitle(_ item: CalendarItem) -> String {
        switch item {
        case .series(_, _, let entries, let codes): "\(codes) · \(entries.count) episodes"
        case .single(let entry): [entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " · ")
        }
    }

    @ViewBuilder
    private func monthView(phone: Bool) -> some View {
        if phone {
            phoneMonthView
        } else {
            desktopMonthView
        }
    }

    private var desktopMonthView: some View {
        let window = viewModel.window
        let days = window.days
        let rows = stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
        let groups = Dictionary(uniqueKeysWithValues: viewModel.dayGroups.map { ($0.day, $0) })
        let selectedDay = viewModel.selectedDay ?? viewModel.today
        return ScrollView {
            VStack(spacing: 4) {
                ForEach(rows, id: \.first) { row in
                    HStack(spacing: 4) {
                        ForEach(row, id: \.self) { day in
                            monthCell(day: day, count: groups[day]?.entryCount ?? 0, selected: day == selectedDay)
                        }
                    }
                }
                if let group = groups[selectedDay], !group.items.isEmpty {
                    dayList(groups: [group], phone: false).frame(minHeight: 160)
                } else {
                    Text("Nothing scheduled on \(dayHeading(selectedDay, today: viewModel.today).capitalized)")
                        .font(.custom("Avenir Next", fixedSize: 12))
                        .foregroundStyle(PlayarrStyle.muted)
                        .padding(.top, 12)
                }
            }
        }
    }

    private var phoneMonthView: some View {
        GeometryReader { proxy in
            let window = viewModel.window
            let days = window.days
            let rows = stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<min($0 + 7, days.count)]) }
            let groups = Dictionary(uniqueKeysWithValues: viewModel.dayGroups.map { ($0.day, $0) })
            let gridWidth = max(720, proxy.size.width)
            let rowHeight = max(0, (proxy.size.height - 32) / CGFloat(max(rows.count, 1)))
            ScrollView(.horizontal) {
                VStack(spacing: 0) {
                    HStack(spacing: 0) {
                        ForEach(rows.first ?? [], id: \.self) { day in
                            Text(weekdayHeading(day))
                                .font(.custom("Avenir Next", fixedSize: 12))
                                .tracking(0.96)
                                .foregroundStyle(PlayarrStyle.muted)
                                .frame(width: gridWidth / 7, height: 32)
                        }
                    }
                    ForEach(rows, id: \.first) { row in
                        HStack(spacing: 0) {
                            ForEach(row, id: \.self) { day in
                                phoneMonthCell(day: day, items: groups[day]?.items ?? [], height: rowHeight)
                                    .frame(width: gridWidth / 7, height: rowHeight)
                            }
                        }
                    }
                }
                .frame(width: gridWidth, height: proxy.size.height, alignment: .top)
            }
            .scrollIndicators(.hidden)
        }
    }

    private func phoneMonthCell(day: String, items: [CalendarItem], height: CGFloat) -> some View {
        let dayNumber = Int(day.suffix(2)) ?? 0
        let inMonth = String(day.prefix(7)) == String(viewModel.anchor.prefix(7))
        let shownCount = max(0, min(items.count, Int((height - 50) / 22)))
        return VStack(alignment: .leading, spacing: 2) {
            ForEach(items.prefix(shownCount)) { item in
                Button {
                    viewModel.select(item)
                    viewModel.selectedDay = day
                    detailItem = item
                } label: {
                    HStack(spacing: 4) {
                        Circle().fill(monthDotColor(item))
                            .frame(width: 8, height: 8)
                        Text(monthItemLabel(item))
                            .font(.custom("Avenir Next", fixedSize: 12))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .foregroundStyle(PlayarrStyle.inkSoft)
                    .frame(minHeight: 22)
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
            Button {
                viewModel.selectedDay = day
                if items.count > shownCount { moreDay = day }
            } label: {
                HStack(spacing: 4) {
                    Text("\(dayNumber)")
                        .font(.custom("Avenir Next", fixedSize: 13).weight(day == viewModel.today ? .heavy : .medium))
                        .foregroundStyle(day == viewModel.today ? PlayarrStyle.pink : (inMonth ? PlayarrStyle.ink : PlayarrStyle.muted))
                    let hidden = max(0, items.count - shownCount)
                    if hidden > 0 {
                        Text("+\(hidden) more").font(.custom("Avenir Next", fixedSize: 12)).foregroundStyle(PlayarrStyle.muted)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 5)
        .padding(.top, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(inMonth ? Color.clear : PlayarrStyle.surfaceStrong.opacity(0.4))
        .overlay(Rectangle().stroke(WM.line.opacity(0.35), lineWidth: 0.5))
        .overlay {
            if day == viewModel.today {
                Rectangle().stroke(PlayarrStyle.pink, lineWidth: 2).padding(1)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func monthItemLabel(_ item: CalendarItem) -> String {
        switch item {
        case .series(_, let title, let entries, _): "\(title) · \(entries.count)×"
        case .single(let entry): entry.title
        }
    }

    private func monthDotColor(_ item: CalendarItem) -> Color {
        let entries = item.entries
        if entries.allSatisfy(\.hasFile) { return PlayarrStyle.accent }
        if entries.contains(where: { !$0.hasFile && $0.date <= viewModel.today && $0.monitored }) {
            return PlayarrStyle.danger
        }
        if entries.contains(where: { !$0.hasFile && $0.date > viewModel.today }) {
            return Color(red: 0.357, green: 0.498, blue: 0.820)
        }
        return PlayarrStyle.muted
    }

    private func weekdayHeading(_ day: String) -> String {
        guard let date = CalendarDays.displayDate(day) else { return "" }
        var formatter = DateFormatter()
        formatter.locale = calendarLocale
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "EEE"
        return formatter.string(from: date).uppercased()
    }

    private func monthCell(day: String, count: Int, selected: Bool) -> some View {
        let dayNumber = Int(day.suffix(2)) ?? 0
        let inMonth = String(day.prefix(7)) == String(viewModel.anchor.prefix(7))
        return Button {
            viewModel.selectedDay = day
        } label: {
            VStack(spacing: 3) {
                Text("\(dayNumber)")
                    .font(.custom("Avenir Next", fixedSize: 13).weight(day == viewModel.today ? .heavy : .medium))
                    .foregroundStyle(day == viewModel.today ? PlayarrStyle.pink : (inMonth ? PlayarrStyle.ink : PlayarrStyle.muted))
                Circle()
                    .fill(count > 0 ? PlayarrStyle.pink : .clear)
                    .frame(width: 5, height: 5)
                if count > 0 {
                    Text("\(count)").font(.custom("Avenir Next", fixedSize: 9)).foregroundStyle(PlayarrStyle.muted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(
                selected ? PlayarrStyle.ink.opacity(0.1) : PlayarrStyle.surfaceStrong.opacity(0.4),
                in: RoundedRectangle(cornerRadius: 8)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(dayHeading(day, today: viewModel.today)), \(count) releases")
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "calendar")
                .font(.system(size: 36, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text(viewModel.filters.isEmpty ? "No releases in this period" : "No releases match these filters")
                .font(.custom("Avenir Next", fixedSize: 16).weight(.bold))
            if !viewModel.filters.isEmpty {
                Button("Clear filters") { viewModel.filters = CalendarFilters() }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct CalendarWeekMetadataLayout: Layout {
    var horizontalSpacing: CGFloat
    var verticalSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let availableWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var contentWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + horizontalSpacing + size.width > availableWidth {
                y += rowHeight + verticalSpacing
                x = 0
                rowHeight = 0
            }
            if x > 0 { x += horizontalSpacing }
            x += size.width
            contentWidth = max(contentWidth, x)
            rowHeight = max(rowHeight, size.height)
        }

        return CGSize(width: proposal.width ?? contentWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + horizontalSpacing + size.width > bounds.maxX {
                y += rowHeight + verticalSpacing
                x = bounds.minX
                rowHeight = 0
            }
            if x > bounds.minX { x += horizontalSpacing }
            subview.place(
                at: CGPoint(x: x, y: y),
                proposal: ProposedViewSize(width: size.width, height: size.height)
            )
            x += size.width
            rowHeight = max(rowHeight, size.height)
        }
    }
}

/// "TODAY", "TOMORROW", otherwise "MON 6 OCT".
func dayHeading(_ day: String, today: String) -> String {
    if day == today { return "TODAY" }
    if CalendarDays.adding(days: 1, to: today) == day { return "TOMORROW" }
    guard let date = CalendarDays.displayDate(day) else { return day }
    var style = Date.FormatStyle().weekday(.abbreviated).day().month(.abbreviated)
    style.timeZone = TimeZone(identifier: "UTC") ?? .current
    return date.formatted(style).uppercased()
}

private struct CalendarItemRow: View {
    let item: CalendarItem
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: symbol)
                    .frame(width: 22)
                    .foregroundStyle(PlayarrStyle.inkSoft)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.custom("Avenir Next", fixedSize: 14).weight(.semibold))
                        .lineLimit(1)
                    Text(subtitle)
                        .font(.custom("Avenir Next", fixedSize: 11))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                        .lineLimit(1)
                }
                Spacer(minLength: 6)
                CalendarStateBadge(state: aggregateState)
            }
            .padding(10)
            .background(
                selected ? PlayarrStyle.ink.opacity(0.09) : PlayarrStyle.surfaceStrong.opacity(0.5),
                in: RoundedRectangle(cornerRadius: 12)
            )
        }
        .buttonStyle(.plain)
    }

    private var first: CalendarEntry? { item.entries.first }

    private var symbol: String {
        switch first?.kind {
        case .episode: return "tv"
        case .movie: return "film"
        case .album: return "music.note"
        case .book: return "book"
        case nil: return "calendar"
        }
    }

    private var subtitle: String {
        switch item {
        case .series(_, _, let entries, let codes):
            return "\(codes) \u{00B7} \(entries.count) episodes"
        case .single(let entry):
            return [entry.episodeCode, entry.subtitle, calendarTimeLabel(entry)].compactMap { $0 }.joined(separator: " \u{00B7} ")
        }
    }

    private var aggregateState: CalendarLibraryState {
        let states = item.entries.map(\.libraryState)
        if states.allSatisfy({ $0 == .inLibrary }) { return .inLibrary }
        if states.contains(.monitored) || states.contains(.inLibrary) { return .monitored }
        return .notMonitored
    }
}

func calendarTimeLabel(_ entry: CalendarEntry) -> String? {
    guard let at = entry.releaseAt else { return nil }
    return at.formatted(date: .omitted, time: .shortened)
}

struct CalendarStateBadge: View {
    let state: CalendarLibraryState

    var body: some View {
        Text(label)
            .font(.custom("Avenir Next", fixedSize: 9).weight(.heavy))
            .tracking(0.4)
            .foregroundStyle(state == .inLibrary ? PlayarrStyle.onAccent : PlayarrStyle.inkSoft)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(
                state == .inLibrary ? PlayarrStyle.accent : PlayarrStyle.ink.opacity(0.08),
                in: Capsule()
            )
    }

    private var label: String {
        switch state {
        case .inLibrary: return "IN LIBRARY"
        case .monitored: return "MONITORED"
        case .notMonitored: return "NOT MONITORED"
        }
    }
}

/// Fills the same area as the loaded view so the page does not jump when data arrives.
private struct CalendarSkeleton: View {
    var body: some View {
        VStack(spacing: 10) {
            ForEach(0..<6, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 12)
                    .fill(PlayarrStyle.ink.opacity(0.06))
                    .frame(height: 52)
            }
            Spacer(minLength: 0)
        }
        .accessibilityLabel("Loading the calendar")
    }
}

/// Details for one agenda item: titles, release time, library state, sources, lag and Open.
struct CalendarDetailPane: View {
    let item: CalendarItem
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(item.title)
                .font(.custom("Avenir Next", fixedSize: 24).weight(.medium))
            if case .series(_, _, let entries, let codes) = item {
                Text("\(codes) \u{00B7} \(entries.count) episodes")
                    .font(.custom("Avenir Next", fixedSize: 13).weight(.semibold))
                    .foregroundStyle(PlayarrStyle.inkSoft)
                ForEach(entries) { entry in
                    HStack {
                        Text([entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " "))
                            .font(.custom("Avenir Next", fixedSize: 12))
                        Spacer()
                        CalendarStateBadge(state: entry.libraryState)
                    }
                }
            } else if let entry = item.entries.first {
                let subtitle = [entry.episodeCode, entry.subtitle].compactMap { $0 }.joined(separator: " ")
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.custom("Avenir Next", fixedSize: 13).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                }
                CalendarStateBadge(state: entry.libraryState)
            }
            if let entry = item.entries.first {
                Text(releaseLine(entry))
                    .font(.custom("Avenir Next", fixedSize: 12))
                    .foregroundStyle(PlayarrStyle.muted)
                if let lag = entry.averageLagSeconds, lag > 0 {
                    Text("Usually available \(calendarLagText(seconds: lag)) after release")
                        .font(.custom("Avenir Next", fixedSize: 12))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                let names = Array(Set(item.entries.flatMap(\.sources).map(\.sourceName))).sorted()
                if !names.isEmpty {
                    Text("Source: \(names.joined(separator: ", "))")
                        .font(.custom("Avenir Next", fixedSize: 12))
                        .foregroundStyle(PlayarrStyle.muted)
                }
                if let workID = item.entries.compactMap(\.workID).first {
                    NavigationLink {
                        WorkDetailView(
                            viewModel: WorkDetailViewModel(apiClient: apiClient, workID: workID),
                            apiClient: apiClient,
                            downloadRepository: downloadRepository
                        )
                    } label: {
                        Text("Open").frame(minWidth: 120)
                    }
                    .buttonStyle(PlayarrPrimaryButtonStyle())
                    .padding(.top, 6)
                } else {
                    Text("Not in your library yet")
                        .font(.custom("Avenir Next", fixedSize: 12).weight(.semibold))
                        .foregroundStyle(PlayarrStyle.inkSoft)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func releaseLine(_ entry: CalendarEntry) -> String {
        let kind: String
        switch entry.releaseType {
        case "air": kind = "Airs"
        case "cinema": kind = "In cinemas"
        case "digital": kind = "Digital release"
        case "physical": kind = "Physical release"
        default: kind = "Releases"
        }
        let when = calendarTimeLabel(entry).map { " at \($0)" } ?? ""
        return "\(kind) \(dayHeading(entry.date, today: "").capitalized)\(when)"
    }
}
