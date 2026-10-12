import PlayarrKit
import SwiftUI

/// Web phone panels of the library: "Filters" (`LIBRARY CONTROLS`) and "Title actions". Both are full-page panels that
/// leave the floating nav visible, with the 44 pt close button at the top right (measured on the live web at 393 pt).
private struct WMPanelFrame<Content: View>: View {
    let kicker: String
    let title: String
    let onClose: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack(alignment: .topLeading) {
            WM.page.opacity(0.97).ignoresSafeArea()
            WMText(kicker.uppercased(), 8.6, 700, color: WM.muted, lh: 13, ls: 1.1).offset(x: 21, y: 17)
            WMText(title, 24, 520, lh: 34, ls: -1).offset(x: 21, y: 33)
            HStack { Spacer(); WMHeaderCircleButton(width: 43, height: 43, glyph: "✕", action: onClose) }
                .padding(.trailing, 21).offset(y: 22)
            content().padding(.horizontal, 21).padding(.top, 95)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
    }
}

private struct WMChoice: View {
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
            .background(selected ? WM.ink : WM.chip.opacity(0.66), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(WM.line.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

private struct WMLanguageBox: View {
    let label: String
    var body: some View {
        HStack {
            Text("Any language").font(WM.font(10.5, 600)).foregroundStyle(WM.inkSoft)
            Spacer()
            Image(systemName: "chevron.down").font(.system(size: 7, weight: .bold)).foregroundStyle(WM.muted)
        }
        .padding(.horizontal, 19)
        .frame(height: 58)
        .background(WM.chip.opacity(0.4), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(WM.line.opacity(0.3), lineWidth: 1.5))
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
    let work: Work
    let apiClient: PlayarrAPIClient
    let onPlay: () -> Void
    let onDownload: () -> Void
    let onClose: () -> Void

    private func row(_ glyph: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Text(glyph).font(WM.font(15, 700)).foregroundStyle(WM.pink).frame(width: 30)
                Text(label).font(WM.font(15, 600)).foregroundStyle(WM.ink).padding(.leading, 14)
                Spacer()
            }
            .padding(.horizontal, 17)
            .frame(height: 67)
            .background(WM.chip.opacity(0.66), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(WM.line.opacity(0.1), lineWidth: 1))
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
            VStack(spacing: 15) {
                row("▶", "Play", action: onPlay)
                row("⇩", "Download", action: onDownload)
                row("+", "Add to Playlist", action: onPlay)
                row("✓", "Mark as Watched") { mark(watched: true) }
                row("○", "Mark as Unwatched") { mark(watched: false) }
            }
        }
    }
}
