import PlayarrKit
import SwiftUI

enum PlayarrByteFormat {
    private static let formatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter
    }()

    static func string(_ bytes: Int64?) -> String? {
        guard let bytes else { return nil }
        return formatter.string(fromByteCount: bytes)
    }
}

struct DownloadsView: View {
    @State private var viewModel: DownloadsViewModel
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository

    init(repository: DownloadRepository, apiClient: PlayarrAPIClient) {
        _viewModel = State(initialValue: DownloadsViewModel(repository: repository))
        self.apiClient = apiClient
        self.downloadRepository = repository
    }

    @Environment(\.playarrGoHome) private var goHome
    @State private var editing: DownloadEditTarget?
    @State private var showingFilters = false

    private var isPhone: Bool { PlayarrLayout.isPhone(UIScreen.main.bounds.size) }

    var body: some View {
        Group {
            if viewModel.isEmpty && isPhone {
                phoneEmpty
            } else if viewModel.isEmpty {
                emptyState
            } else {
                content
            }
        }
        .background(PlayarrStyle.surface)
        .navigationBarHidden(viewModel.isEmpty && isPhone)
        .navigationTitle("Downloads")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { viewModel.refresh() }
        .onAppear { viewModel.refresh() }
        .sheet(item: $editing) { target in
            DownloadEditSheet(records: target.records, title: target.title, apiClient: apiClient, downloadRepository: downloadRepository)
        }
        .sheet(isPresented: $showingFilters) { DownloadFiltersSheet(filters: $viewModel.filters) }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showingFilters = true } label: {
                    Label(viewModel.filters.activeCount > 0 ? "Filters (\(viewModel.filters.activeCount))" : "Filters", systemImage: "slider.horizontal.3")
                }
            }
        }
    }

    /// Web mobile Downloads page with nothing downloaded: storage line and bar, then the empty state.
    private var phoneEmpty: some View {
        ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            WMText("\(PlayarrByteFormat.string(viewModel.storageUsedBytes) ?? "0 KB") used on this device", 8, 400, color: WM.muted, lh: 12)
                .frame(width: 342, alignment: .leading)
                .offset(x: 24, y: 24)
            Capsule().fill(WM.artFill).frame(width: 342, height: 4).offset(x: 24, y: 44)
            WMEmptyStateRow(
                title: "No downloads yet",
                description: "Download a title from its detail page to watch it without a connection."
            )
            .offset(x: 37, y: 80)
            WMHeaderCircleButton(width: 44, height: 40, glyph: "\u{2190}", action: goHome)
                .offset(x: 15, y: WM.topInset + 1)
            WMText("Downloads", 21.6, 580, lh: 32, ls: -0.972).offset(x: 68, y: WM.topInset + 5)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }

    private var content: some View {
        List {
            // Series, then season, then episode, with the same controls at every level (web's grouped Downloads page).
            Section("Downloads") {
                ForEach(Array(viewModel.tree.enumerated()), id: \.offset) { _, item in
                    switch item {
                    case .record(let record): row(for: record)
                    case .series(let series): seriesGroup(series)
                    }
                }
            }

            Section {
                HStack {
                    Text("Storage used")
                        .foregroundStyle(PlayarrStyle.inkSoft)
                    Spacer()
                    Text(PlayarrByteFormat.string(viewModel.storageUsedBytes) ?? "0 KB")
                        .foregroundStyle(PlayarrStyle.muted)
                }
                .font(.footnote.weight(.semibold))
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .refreshable { viewModel.refresh() }
    }

    private func seriesGroup(_ series: SeriesNode) -> some View {
        DisclosureGroup {
            ForEach(series.seasons, id: \.key) { season in
                DisclosureGroup {
                    ForEach(season.episodes, id: \.record.mediaFileID) { episode in row(for: episode.record) }
                } label: {
                    groupLabel("Season \(season.seasonNumber)", season.aggregate, records: season.records, title: "\(series.title) · Season \(season.seasonNumber)")
                }
            }
        } label: {
            groupLabel(series.title, series.aggregate, records: series.records, title: series.title)
        }
    }

    /// Title, aggregate status and the shared controls: Pause or Resume, Edit, Cancel and Delete.
    private func groupLabel(_ name: String, _ aggregate: DownloadAggregate, records: [DownloadRecord], title: String) -> some View {
        let ids = records.map(\.mediaFileID)
        return VStack(alignment: .leading, spacing: 6) {
            Text(name).font(.subheadline.weight(.semibold)).foregroundStyle(PlayarrStyle.ink)
            Text(groupStatus(aggregate)).font(.caption).foregroundStyle(PlayarrStyle.muted)
            if let percent = aggregate.percent, aggregate.running + aggregate.paused > 0 {
                ProgressView(value: Double(percent) / 100).tint(PlayarrStyle.pink)
            }
            HStack(spacing: 14) {
                if aggregate.running > 0 {
                    Button("Pause") { downloadRepository.pause(mediaFileIDs: ids); viewModel.refresh() }
                } else if aggregate.paused + aggregate.failed > 0 {
                    Button("Resume") { downloadRepository.resume(mediaFileIDs: ids); viewModel.refresh() }
                }
                Button("Edit") { editing = DownloadEditTarget(records: records, title: title) }
                if aggregate.running + aggregate.paused > 0 {
                    Button("Cancel", role: .destructive) { downloadRepository.cancel(mediaFileIDs: ids); viewModel.refresh() }
                }
                if aggregate.ready + aggregate.failed > 0 {
                    Button("Delete", role: .destructive) { downloadRepository.cancel(mediaFileIDs: ids); viewModel.refresh() }
                }
            }
            .font(.caption.weight(.semibold))
            .buttonStyle(.borderless)
        }
    }

    private func groupStatus(_ aggregate: DownloadAggregate) -> String {
        var parts = ["\(aggregate.count) episode\(aggregate.count == 1 ? "" : "s")"]
        if aggregate.running > 0 { parts.append("\(aggregate.running) downloading") }
        if aggregate.paused > 0 { parts.append("\(aggregate.paused) paused") }
        if aggregate.failed > 0 { parts.append("\(aggregate.failed) failed") }
        if let total = PlayarrByteFormat.string(aggregate.totalBytes) { parts.append(total) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder
    private func row(for record: DownloadRecord) -> some View {
        if record.state == .completed {
            NavigationLink {
                PlayerView(
                    apiClient: apiClient,
                    downloadRepository: downloadRepository,
                    initialMediaFileID: record.mediaFileID.uuidString,
                    initialTitle: record.title,
                    // A downloaded file plays from a sandboxed `file://`
                    // URL, unreachable from a real Chromecast device -- hide
                    // the cast affordance rather than let it silently fail.
                    isOfflinePlayback: true
                )
            } label: {
                DownloadRow(record: record)
            }
            .swipeActions(edge: .trailing) {
                Button("Delete", systemImage: "trash", role: .destructive) { viewModel.delete(record) }
                Button("Edit", systemImage: "slider.horizontal.3") { editing = DownloadEditTarget(records: [record], title: record.title) }.tint(PlayarrStyle.pink)
            }
        } else {
            DownloadRow(record: record)
                .swipeActions(edge: .trailing) {
                    Button("Delete", systemImage: "trash", role: .destructive) { viewModel.delete(record) }
                    Button("Edit", systemImage: "slider.horizontal.3") { editing = DownloadEditTarget(records: [record], title: record.title) }.tint(PlayarrStyle.pink)
                }
                .swipeActions(edge: .leading) {
                    if record.state == .paused || record.state == .failed {
                        Button("Resume", systemImage: "arrow.down.circle") { viewModel.resume(record) }
                            .tint(PlayarrStyle.pink)
                    } else if record.state == .downloading {
                        Button("Pause", systemImage: "pause.circle") { viewModel.pause(record) }
                    }
                }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "arrow.down.circle")
                .font(.system(size: 46, weight: .light))
                .foregroundStyle(PlayarrStyle.pink)
            Text("No downloads yet")
                .font(.custom("Avenir Next", fixedSize: 20).weight(.bold))
            Text("Downloaded titles play back without a connection.")
                .font(.custom("Avenir Next", fixedSize: 12))
                .foregroundStyle(PlayarrStyle.inkSoft)
                .multilineTextAlignment(.center)
        }
        .padding(30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(PlayarrStyle.ink)
        .background(PlayarrStyle.surface)
    }
}

struct DownloadEditTarget: Identifiable {
    let id = UUID()
    let records: [DownloadRecord]
    let title: String
}

/// Web's Downloads Filters drawer: kind, status and sort.
private struct DownloadFiltersSheet: View {
    @Binding var filters: DownloadFilters
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Picker("Kind", selection: $filters.kind) {
                    Text("All").tag(DownloadKindFilter.all); Text("Movies").tag(DownloadKindFilter.movies)
                    Text("TV").tag(DownloadKindFilter.tv); Text("Music").tag(DownloadKindFilter.music)
                }
                Picker("Status", selection: $filters.status) {
                    Text("All").tag(DownloadStatusFilter.all); Text("Downloading").tag(DownloadStatusFilter.downloading)
                    Text("Paused").tag(DownloadStatusFilter.paused); Text("Done").tag(DownloadStatusFilter.done)
                    Text("Failed").tag(DownloadStatusFilter.failed)
                }
                Picker("Sort", selection: $filters.sort) {
                    Text("Recent").tag(DownloadSort.recent); Text("Title").tag(DownloadSort.title); Text("Size").tag(DownloadSort.size)
                }
                Button("Reset") { filters = DownloadFilters() }
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

private struct DownloadRow: View {
    let record: DownloadRecord

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(PlayarrStyle.surfaceStrong)
                Image(systemName: iconName)
                    .foregroundStyle(record.state == .failed ? PlayarrStyle.danger : PlayarrStyle.pink)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 4) {
                Text(record.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(PlayarrStyle.ink)
                    .lineLimit(1)

                if record.state == .downloading || record.state == .paused {
                    ProgressView(value: record.progressFraction)
                        .tint(PlayarrStyle.pink)
                }

                Text(statusLine)
                    .font(.caption)
                    .foregroundStyle(record.state == .failed ? PlayarrStyle.danger : PlayarrStyle.muted)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }

    private var iconName: String {
        switch record.state {
        case .queued, .preparing: "clock"
        case .downloading: "arrow.down.circle"
        case .paused: "pause.circle"
        case .completed: "checkmark.circle.fill"
        case .failed: "exclamationmark.triangle"
        }
    }

    private var statusLine: String {
        switch record.state {
        case .queued:
            return "Queued"
        case .preparing:
            return "Preparing…"
        case .downloading:
            let written = PlayarrByteFormat.string(record.bytesWritten) ?? "0 KB"
            if let total = PlayarrByteFormat.string(record.totalBytes) {
                return "\(written) of \(total)"
            }
            return "\(written) downloaded"
        case .paused:
            return "Paused"
        case .completed:
            return PlayarrByteFormat.string(record.totalBytes ?? record.bytesWritten) ?? "Downloaded"
        case .failed:
            return record.errorMessage ?? "Download failed"
        }
    }
}

#Preview {
    let apiClient = PreviewAPIClient()
    NavigationStack {
        DownloadsView(repository: DownloadRepository(apiClient: apiClient), apiClient: apiClient)
    }
}
