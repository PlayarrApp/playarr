import PlayarrKit
import SwiftUI

/// Web's edit drawer for a stored download: keep-until, and quality (a new quality re-converts through a new ticket; the
/// quality section is absent when the server's options cannot be loaded, e.g. offline).
struct DownloadEditSheet: View {
    private enum KeepUntilKind: String, CaseIterable, Identifiable {
        case forever = "Forever"
        case specificDate = "Until a date"
        case afterWatched = "After watched"
        var id: String { rawValue }
    }

    let record: DownloadRecord
    let apiClient: PlayarrAPIClient
    let downloadRepository: DownloadRepository

    @Environment(\.dismiss) private var dismiss
    @State private var options: [MediaFileDownloadOption] = []
    @State private var selectedOptionID: String?
    @State private var keepUntilKind: KeepUntilKind = .forever
    @State private var specificDate = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @State private var afterWatchedAmount = 30
    @State private var afterWatchedUnit: KeepUntilPolicy.TimeUnit = .days

    private var currentOptionID: String? { options.first { $0.profile == record.profile }?.id }

    var body: some View {
        NavigationStack {
            Form {
                if !options.isEmpty {
                    Section("Quality") {
                        ForEach(options) { option in
                            Button {
                                selectedOptionID = option.id
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(option.label).foregroundStyle(PlayarrStyle.ink)
                                        Text(PlayarrByteFormat.string(option.estimatedSizeBytes) ?? "Unknown size")
                                            .font(.caption).foregroundStyle(PlayarrStyle.muted)
                                    }
                                    Spacer()
                                    if (selectedOptionID ?? currentOptionID) == option.id {
                                        Image(systemName: "checkmark").foregroundStyle(PlayarrStyle.pink)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                Section("Keep until") {
                    Picker("Keep until", selection: $keepUntilKind) {
                        ForEach(KeepUntilKind.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    switch keepUntilKind {
                    case .forever: EmptyView()
                    case .specificDate: DatePicker("Date", selection: $specificDate, in: Date()..., displayedComponents: .date)
                    case .afterWatched:
                        Stepper("After \\(afterWatchedAmount) \\(afterWatchedUnit.rawValue)", value: $afterWatchedAmount, in: 1...365)
                        Picker("Unit", selection: $afterWatchedUnit) {
                            Text("Days").tag(KeepUntilPolicy.TimeUnit.days)
                            Text("Weeks").tag(KeepUntilPolicy.TimeUnit.weeks)
                        }
                        .pickerStyle(.segmented)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(PlayarrStyle.background)
            .navigationTitle(record.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { save() } }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            switch record.keepUntil {
            case .forever: keepUntilKind = .forever
            case .specificDate(let date): keepUntilKind = .specificDate; specificDate = date
            case .afterWatched(let amount, let unit): keepUntilKind = .afterWatched; afterWatchedAmount = amount; afterWatchedUnit = unit
            }
            options = (try? await apiClient.mediaDownloadOptions(mediaFileID: record.mediaFileID).options) ?? []
        }
    }

    private func save() {
        let policy: KeepUntilPolicy = switch keepUntilKind {
        case .forever: .forever
        case .specificDate: .specificDate(specificDate)
        case .afterWatched: .afterWatched(amount: afterWatchedAmount, unit: afterWatchedUnit)
        }
        downloadRepository.updateKeepUntil(mediaFileID: record.mediaFileID, policy)
        if let id = selectedOptionID, id != currentOptionID, let option = options.first(where: { $0.id == id }) {
            downloadRepository.changeQuality(mediaFileID: record.mediaFileID, profile: option.profile)
        }
        dismiss()
    }
}
