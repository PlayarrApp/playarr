import PlayarrKit
import SwiftUI
import UIKit

/// Web phone panels of the library: "Filters" (`LIBRARY CONTROLS`) and "Title actions". Both are full-page panels that
/// leave the floating nav visible, with the 44 pt close button at the top right (measured on the live web at 393 pt).
private struct WMPanelFrame<Content: View>: View {
    let kicker: String
    let title: String
    let onClose: () -> Void
    var showsCloseFocusRing = true
    @ViewBuilder let content: () -> Content
    @FocusState private var closeButtonFocused: Bool

    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    @ViewBuilder
    private var closeButton: some View {
        if isPad {
            WMHeaderCircleButton(width: 43, height: 43, glyph: "✕", action: onClose)
                .focusable()
                .focused($closeButtonFocused)
                .focusEffectDisabled()
                .overlay(alignment: .trailing) {
                    if showsCloseFocusRing || closeButtonFocused {
                        Circle().stroke(WM.ink, lineWidth: 3).frame(width: 50, height: 50).offset(x: 3.5, y: 0).allowsHitTesting(false)
                    }
                }
        } else {
            WMHeaderCircleButton(width: 43, height: 43, glyph: "✕", action: onClose)
                .overlay(alignment: .trailing) {
                    if showsCloseFocusRing {
                        Circle().stroke(WM.ink, lineWidth: 3).frame(width: 50, height: 50).offset(x: 3.5, y: 0).allowsHitTesting(false)
                    }
                }
        }
    }

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

                    closeButton
                }
                .padding(.horizontal, 34)
                .padding(.top, 51 + WM.safeTop)
            } else {
                WMText(kicker.uppercased(), 8.6, 700, color: WM.muted, lh: 13, ls: 1.1).offset(x: 21, y: 17 + WM.safeTop)
                WMText(title, 24, 520, lh: 34, ls: -1).offset(x: 21, y: 33 + WM.safeTop)
                HStack { Spacer(); closeButton }
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

private struct WMLanguageBox: View {
    @Environment(\.colorScheme) private var scheme
    let label: String
    var body: some View {
        HStack {
            Text("Any language").font(WM.font(10.5, 600)).foregroundStyle(WM.inkSoft)
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold)).foregroundStyle(WM.muted)
        }
        .padding(.horizontal, 19)
        .frame(height: 58)
        // Web `.ui-select-trigger`: the same fill and 1 px border as the filter chips.
        .background(WM.artFill.opacity(0.64), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(WM.line.opacity(scheme == .light ? 0.106 : 0.084), lineWidth: 1))
        .accessibilityLabel(label)
    }
}

struct WMLibraryFiltersPanel: View {
    @Bindable var viewModel: LibraryViewModel
    let onClose: () -> Void

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
                WMLanguageBox(label: "Audio language").padding(.top, 9)
                section("Subtitle language").padding(.top, 22)
                WMLanguageBox(label: "Subtitle language").padding(.top, 9)
            }
        }
    }
}

struct WMTitleActionsPanel: View {
    private enum FocusTarget: String, Hashable {
        case play, download, playlist, watched, unwatched
    }

    private struct TabletActionRowFocus: ViewModifier {
        let focusTarget: FocusTarget
        @FocusState.Binding var focusedAction: FocusTarget?
        let isPad: Bool

        @ViewBuilder
        func body(content: Content) -> some View {
            if isPad {
                content
                    .focusable()
                    .focused($focusedAction, equals: focusTarget)
                    .focusEffectDisabled()
            } else {
                content
            }
        }
    }

    private struct TabletDefaultActionFocus: ViewModifier {
        @FocusState.Binding var focusedAction: FocusTarget?
        let isPad: Bool

        @ViewBuilder
        func body(content: Content) -> some View {
            if isPad {
                content.defaultFocus($focusedAction, .play, priority: .userInitiated)
            } else {
                content
            }
        }
    }

    @Environment(\.colorScheme) private var scheme
    @FocusState private var focusedAction: FocusTarget?
    private var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }
    let work: Work
    let apiClient: PlayarrAPIClient
    let onPlay: () -> Void
    let onDownload: () -> Void
    let onClose: () -> Void

    private func row(_ glyph: String, _ label: String, focusTarget: FocusTarget, action: @escaping () -> Void) -> some View {
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
        .overlay {
            if isPad, focusedAction == focusTarget {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(WM.ink, lineWidth: 3)
                    .padding(-5)
                    .allowsHitTesting(false)
            }
        }
        .modifier(TabletActionRowFocus(focusTarget: focusTarget, focusedAction: $focusedAction, isPad: isPad))
    }

    private func mark(watched: Bool) {
        Task {
            guard let detail = try? await apiClient.fetchWork(id: work.id), let file = detail.mediaFileID else { return }
            let body = UpdateWatchProgressRequest(positionMS: watched ? 1000 : 0, durationMS: 1000, completed: watched, occurredAt: nil)
            _ = try? await apiClient.updateWatchProgress(mediaFileID: file, body: body)
            onClose()
        }
    }

    private func recordFocusOutcome(_ target: FocusTarget?) {
        #if DEBUG
        guard isPad, ParityLaunch.isActive else { return }
        NSLog("PlayarrDiagnostic actions_focus=%@", target?.rawValue ?? "none")
        #endif
    }

    var body: some View {
        WMPanelFrame(kicker: "Title actions", title: work.title, onClose: onClose, showsCloseFocusRing: !isPad) {
            VStack(spacing: isPad ? 14 : 15) {
                row(isPad ? "\u{25B6}\u{FE0E}" : "▶", "Play", focusTarget: .play, action: onPlay)
                row("⇩", "Download", focusTarget: .download, action: onDownload)
                row("+", "Add to Playlist", focusTarget: .playlist, action: onPlay)
                row("✓", "Mark as Watched", focusTarget: .watched) { mark(watched: true) }
                row("○", "Mark as Unwatched", focusTarget: .unwatched) { mark(watched: false) }
            }
            .modifier(TabletDefaultActionFocus(focusedAction: $focusedAction, isPad: isPad))
        }
        .onAppear { recordFocusOutcome(focusedAction) }
        .onChange(of: focusedAction) { _, target in recordFocusOutcome(target) }
    }
}
