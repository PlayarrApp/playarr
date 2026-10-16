import PlayarrKit
import SwiftUI
import UIKit

/// Web phone panels of the library: "Filters" (`LIBRARY CONTROLS`) and "Title actions". Both are full-page panels that
/// leave the floating nav visible, with the 44 pt close button at the top right (measured on the live web at 393 pt).
private struct WMPanelFrame<Content: View>: View {
    let kicker: String
    let title: String
    let onClose: () -> Void
    @ViewBuilder let content: () -> Content

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    @ViewBuilder
    private var panelBackground: some View {
        if isPad {
            Rectangle()
                .fill(.ultraThinMaterial)
                .overlay(WM.chip.opacity(0.94))
                .ignoresSafeArea()
        } else {
            WM.page.opacity(0.97).ignoresSafeArea()
        }
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            panelBackground
            if isPad {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 5) {
                        WMText(kicker.uppercased(), 7.2, 700, color: WM.muted, lh: 11, ls: 1)
                        WMText(title, 27.32, 520, lh: 33, ls: -0.8)
                            .lineLimit(1)
                            .minimumScaleFactor(0.72)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    WMHeaderCircleButton(width: 43, height: 43, glyph: "✕", action: onClose)
                        // Web Drawer.tsx focuses the close button on open: the circle carries the 3 pt focus ring 2 pt outside it.
                        .overlay(alignment: .trailing) { Circle().stroke(WM.ink, lineWidth: 3).frame(width: 50, height: 50).offset(x: 3.5, y: 0).allowsHitTesting(false) }
                }
                .padding(.horizontal, 34)
                .padding(.top, 51 + WM.safeTop)
            } else {
                WMText(kicker.uppercased(), 8.6, 700, color: WM.muted, lh: 13, ls: 1.1).offset(x: 21, y: 17 + WM.safeTop)
                WMText(title, 24, 520, lh: 34, ls: -1).offset(x: 21, y: 33 + WM.safeTop)
                HStack { Spacer(); WMHeaderCircleButton(width: 43, height: 43, glyph: "✕", action: onClose) }
                    // Web Drawer.tsx focuses the close button on open: the circle carries the 3 pt focus ring 2 pt outside it.
                    .overlay(alignment: .trailing) { Circle().stroke(WM.ink, lineWidth: 3).frame(width: 50, height: 50).offset(x: 3.5, y: 0).allowsHitTesting(false) }
                    .padding(.trailing, 21).offset(y: 22 + WM.safeTop)
            }
            // The whole panel scrolls (web: the drawer body scrolls to its last row, clear of the floating nav).
            ScrollView(.vertical) {
                content()
                    .padding(.horizontal, isPad ? 34 : 21)
                    .padding(.top, (isPad ? 140 : 95) + WM.safeTop)
                    .padding(.bottom, isPad ? 96 : 130)
            }
            .scrollIndicators(.hidden)
            .webEdgeFade(.vertical, size: 38)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }
}

private struct WMChoice: View {
    @Environment(\.colorScheme) private var scheme
    let label: String
    var symbol: String?
    let selected: Bool
    let height: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 5) {
                if let symbol { Image(systemName: symbol).font(.system(size: 13, weight: .semibold)) }
                Text(label).font(WM.font(11.5, selected ? 700 : 600))
            }
            .foregroundStyle(selected ? WM.page : WM.inkSoft)
            .frame(maxWidth: .infinity).frame(height: height)
            // Web `.tv-filter-choice-grid button`: surface-soft at 64% with a 1 px border of line at 76%; the active one is solid ink.
            .background(selected ? WM.ink : WM.artFill.opacity(0.64), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(WM.line.opacity(scheme == .light ? 0.106 : 0.084), lineWidth: 1))
            .scaleEffect(selected ? 1.025 : 1)
        }
        .buttonStyle(.plain)
    }
}

private struct WMLanguageSelector: View {
    @Environment(\.colorScheme) private var scheme
    let label: String
    let identifier: String
    let selectedCodes: [String]
    let facets: [LanguageFacet]?
    let isLoading: Bool
    let error: String?
    @Binding var isExpanded: Bool
    let onToggle: (String) -> Void

    private var selectedNames: String {
        let names = selectedCodes.map { code in
            facets?.first(where: { $0.code == code })?.displayName ?? code
        }
        return names.isEmpty ? "Any language" : names.joined(separator: ", ")
    }

    private var options: [LanguageFacet] {
        var available = facets ?? []
        let availableCodes = Set(available.map(\.code))
        available += selectedCodes
            .filter { !availableCodes.contains($0) }
            .map { LanguageFacet(code: $0, name: nil, count: nil) }
        return available
    }

    var body: some View {
        VStack(spacing: 8) {
            Button { isExpanded.toggle() } label: {
                HStack {
                    Text(selectedNames).font(WM.font(10.5, 600)).foregroundStyle(WM.inkSoft).lineLimit(1)
                    Spacer(minLength: 8)
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(.system(size: 7, weight: .bold)).foregroundStyle(WM.muted)
                }
                .padding(.horizontal, 19)
                .frame(height: 58)
                .background(WM.artFill.opacity(0.64), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(WM.line.opacity(scheme == .light ? 0.106 : 0.084), lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(label), \(selectedNames)")
            .accessibilityIdentifier(identifier)
            .accessibilityHint(isExpanded ? "Hides language choices" : "Shows language choices")

            if isExpanded {
                VStack(alignment: .leading, spacing: 0) {
                    if error != nil && options.isEmpty {
                        Text("Languages could not be loaded")
                            .font(WM.font(11, 500)).foregroundStyle(WM.muted).padding(12)
                            .accessibilityLabel("\(label): languages could not be loaded")
                    } else if isLoading && facets == nil {
                        ProgressView().frame(maxWidth: .infinity).padding(14)
                            .accessibilityLabel("Loading \(label.lowercased())")
                    } else if options.isEmpty && error == nil {
                        Text("No languages available")
                            .font(WM.font(11, 500)).foregroundStyle(WM.muted).padding(12)
                    } else if !options.isEmpty {
                        ForEach(options) { facet in
                            Button { onToggle(facet.code) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: selectedCodes.contains(facet.code) ? "checkmark.square.fill" : "square")
                                        .foregroundStyle(selectedCodes.contains(facet.code) ? WM.pink : WM.muted)
                                    Text(facet.displayName).foregroundStyle(WM.ink)
                                    Spacer()
                                    if let count = facet.count {
                                        Text(count.formatted()).foregroundStyle(WM.muted)
                                    }
                                }
                                .font(WM.font(11, 500))
                                .padding(.horizontal, 13).frame(minHeight: 42)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("\(identifier)-option-\(facet.code)")
                            .accessibilityAddTraits(selectedCodes.contains(facet.code) ? .isSelected : [])
                        }
                    }
                }
                .padding(.vertical, 3)
                .background(WM.artFill.opacity(0.42), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(WM.line.opacity(0.1), lineWidth: 1))
            }
        }
    }
}

struct WMLibraryFiltersPanel: View {
    @Bindable var viewModel: LibraryViewModel
    let onClose: () -> Void
    @State private var expandedLanguage: String?

    private func section(_ name: String) -> some View {
        WMText(name.uppercased(), 8.6, 700, color: WM.muted, lh: 13, ls: 1.1)
    }

    var body: some View {
        WMPanelFrame(kicker: "Library controls", title: "Filters", onClose: onClose) {
            VStack(alignment: .leading, spacing: 0) {
                section("View")
                HStack(spacing: 8) {
                    WMChoice(label: "List", symbol: "list.bullet", selected: viewModel.viewMode == .list, height: 47) { viewModel.viewMode = .list }
                    WMChoice(label: "Screen", symbol: "rectangle.grid.3x1", selected: viewModel.viewMode == .screen, height: 47) { viewModel.viewMode = .screen }
                    WMChoice(label: "Cover", symbol: "square.grid.3x1.below.line.grid.1x2", selected: viewModel.viewMode == .cover, height: 47) { viewModel.viewMode = .cover }
                }.padding(.top, 9)
                section("Sort by").padding(.top, 26)
                HStack(spacing: 8) {
                    WMChoice(label: "Title", selected: viewModel.sort == "title", height: 48) { viewModel.sort = "title" }
                    WMChoice(label: "Date Added", selected: viewModel.sort == "date_added", height: 48) { viewModel.sort = "date_added" }
                }.padding(.top, 9)
                section("Order").padding(.top, 26)
                HStack(spacing: 8) {
                    WMChoice(label: viewModel.sort == "title" ? "A-Z" : "Oldest", selected: viewModel.order == "asc", height: 48) { viewModel.order = "asc" }
                    WMChoice(label: viewModel.sort == "title" ? "Z-A" : "Newest", selected: viewModel.order == "desc", height: 48) { viewModel.order = "desc" }
                }.padding(.top, 9)
                section("Audio language").padding(.top, 26)
                WMLanguageSelector(
                    label: "Audio language", identifier: "library-filter-audio-language",
                    selectedCodes: viewModel.selectedAudioLanguages,
                    facets: viewModel.languageFacets?.audio,
                    isLoading: viewModel.isLoadingLanguageFacets,
                    error: viewModel.languageFacetError,
                    isExpanded: Binding(get: { expandedLanguage == "audio" }, set: { expandedLanguage = $0 ? "audio" : nil }),
                    onToggle: { code in Task { await viewModel.toggleAudioLanguage(code) } }
                ).padding(.top, 9)
                section("Subtitle language").padding(.top, 22)
                WMLanguageSelector(
                    label: "Subtitle language", identifier: "library-filter-subtitle-language",
                    selectedCodes: viewModel.selectedSubtitleLanguages,
                    facets: viewModel.languageFacets?.subtitle,
                    isLoading: viewModel.isLoadingLanguageFacets,
                    error: viewModel.languageFacetError,
                    isExpanded: Binding(get: { expandedLanguage == "subtitle" }, set: { expandedLanguage = $0 ? "subtitle" : nil }),
                    onToggle: { code in Task { await viewModel.toggleSubtitleLanguage(code) } }
                ).padding(.top, 9)
                if !viewModel.selectedAudioLanguages.isEmpty || !viewModel.selectedSubtitleLanguages.isEmpty {
                    Button("Clear language filters") {
                        Task { await viewModel.clearLanguageFilters() }
                    }
                    .font(WM.font(11, 600))
                    .foregroundStyle(WM.ink)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(WM.artFill.opacity(0.64), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(WM.line.opacity(0.1), lineWidth: 1))
                    .padding(.top, 14)
                    .accessibilityIdentifier("library-filter-languages-clear")
                }
            }
        }
        .task { await viewModel.loadLanguageFacets() }
    }
}

struct WMTitleActionsPanel: View {
    @Environment(\.colorScheme) private var scheme
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    let work: Work
    let apiClient: PlayarrAPIClient
    let onPlay: () -> Void
    let onDownload: () -> Void
    let onClose: () -> Void

    private func row(_ glyph: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Text(glyph).font(WM.font(15, 700)).foregroundStyle(WM.pink).frame(width: isPad ? 42 : 30)
                Text(label).font(WM.font(15, 600)).foregroundStyle(WM.ink).padding(.leading, isPad ? 0 : 14)
                Spacer()
            }
            .padding(.horizontal, isPad ? 18 : 17)
            .frame(minHeight: isPad ? 68 : 67, maxHeight: isPad ? nil : 67)
            .background(
                isPad
                    ? WM.artFill
                    : (scheme == .light ? WM.ink.opacity(0.17) : WM.chip.opacity(0.66)),
                in: RoundedRectangle(cornerRadius: isPad ? 14 : 16, style: .continuous)
            )
            .overlay(RoundedRectangle(cornerRadius: isPad ? 14 : 16, style: .continuous).stroke(WM.line.opacity(0.1), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private func mark(watched: Bool) {
        Task {
            guard let detail = try? await apiClient.fetchWork(id: work.id), let file = detail.mediaFileID else { return }
            let body = UpdateWatchProgressRequest(positionMS: watched ? 1000 : 0, durationMS: 1000, completed: watched, occurredAt: nil)
            _ = try? await apiClient.updateWatchProgress(mediaFileID: file, body: body)
            onClose()
        }
    }

    var body: some View {
        WMPanelFrame(kicker: "Title actions", title: work.title, onClose: onClose) {
            VStack(spacing: isPad ? 14 : 15) {
                row("▶", "Play", action: onPlay)
                row("⇩", "Download", action: onDownload)
                row("+", "Add to Playlist", action: onPlay)
                row("✓", "Mark as Watched") { mark(watched: true) }
                row("○", "Mark as Unwatched") { mark(watched: false) }
            }
        }
    }
}
