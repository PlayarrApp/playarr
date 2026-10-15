import PlayarrKit
import SwiftUI

/// Building blocks for the web mobile settings panels and list pages (390 CSS px wide). Every
/// element is placed at the box the web layout dump reports for it (`dom/<id>.json` next to each
/// reference capture), so a view only states positions, sizes and CSS text metrics.

/// Text that may wrap: the CSS line box is `lh`, the font's natural line is about 1.364 em
/// (Nunito Sans), so half the difference goes above the first line and the rest between lines.
struct WMPara: View {
    let text: String
    let size: CGFloat
    let weight: Int
    var color: Color = WM.muted
    let lh: CGFloat
    var ls: CGFloat = 0
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        let natural = size * 1.364
        Text(text)
            .font(WM.font(size, weight))
            .tracking(ls)
            .foregroundStyle(color)
            .lineSpacing(lh - natural)
            .padding(.top, (lh - natural) / 2 - 0.3)
            .frame(width: width, height: height, alignment: .topLeading)
    }
}

/// `.btn-primary` / `.btn-secondary` pills of the settings panels.
struct WMPanelButton: View {
    let label: String
    var primary = true
    var enabled = true
    let width: CGFloat
    let height: CGFloat
    var action: () -> Void = {}
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        Button(action: action) {
            Text(label)
                .font(WM.font(11.52, 720))
                .foregroundStyle(primary ? PlayarrStyle.onAccent : WM.inkSoft)
                .frame(width: width, height: height)
                .background {
                    if primary {
                        Capsule().fill(PlayarrStyle.accent.opacity(enabled ? 1 : 0.45))
                    } else {
                        Capsule().fill(WM.page)
                    }
                }
                .overlay {
                    if !primary { Capsule().stroke(WM.line.opacity(scheme == .dark ? 0.2 : 0.14), lineWidth: 1) }
                }
        }
        .buttonStyle(.plain)
        .allowsHitTesting(enabled)
    }
}

/// A column of fields inside a 1 px frame in the line colour (`.connection-form-row`): the fields
/// are transparent so the frame colour shows through, each with its own 1 px outline.
struct WMFieldGroup<Content: View>: View {
    let height: CGFloat
    @ViewBuilder let content: () -> Content
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        content()
            .frame(width: 318, height: height, alignment: .topLeading)
            .background(WM.line.opacity(scheme == .dark ? 0.158 : 0.14))
    }
}

/// One 318x48 `.input`.
struct WMFieldBox<Field: View>: View {
    @ViewBuilder let field: () -> Field
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        field()
            .font(WM.font(14, 400))
            .foregroundStyle(WM.ink)
            .padding(.horizontal, 14)
            .frame(width: 318, height: 48, alignment: .leading)
            .overlay(Rectangle().stroke(WM.line.opacity(scheme == .dark ? 0.2 : 0.28), lineWidth: 1))
    }
}

/// Placeholder colour of the web inputs.
extension Text {
    static func wmPlaceholder(_ text: String) -> Text {
        Text(text).foregroundColor(WM.muted)
    }
}

/// Settings detail page: dark back button, the section name over its description, and the panel.
private struct WMPanelScrollKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

struct WMPanelPage<Content: View>: View {
    let kicker: String
    let subtitle: String
    let height: CGFloat
    let onBack: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var scrolled: CGFloat = 0

    var body: some View {
        ZStack(alignment: .topLeading) {
            WM.page.ignoresSafeArea()
            ScrollView(.vertical) {
                ZStack(alignment: .topLeading) {
                    content()
                }
                .frame(width: 390, height: height, alignment: .topLeading)
                .background(GeometryReader { geo in
                    Color.clear.preference(key: WMPanelScrollKey.self, value: -geo.frame(in: .named("wm-panel")).minY)
                })
            }
            .coordinateSpace(name: "wm-panel")
            .onPreferenceChange(WMPanelScrollKey.self) { scrolled = $0 }
            .scrollIndicators(.hidden)
            .keepInsideSafeArea()
            // Web (data-fade-clear): the scroller is clipped at the header's bottom edge, with a 38 pt fade below it, so rows
            // scroll away under the header and never show behind the back button and title.
            .mask {
                GeometryReader { proxy in
                    let clear = min(0.9, (WM.topInset + 48) / max(1, proxy.size.height))
                    let ramp = min(0.2, 38 / max(1, proxy.size.height)) * min(1, max(0, scrolled / 38)) // the fade grows with the scrolled distance
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0), .init(color: .clear, location: clear),
                            .init(color: .black.opacity(0.156), location: clear + ramp * 0.25),
                            .init(color: .black.opacity(0.5), location: clear + ramp * 0.5),
                            .init(color: .black.opacity(0.844), location: clear + ramp * 0.75),
                            .init(color: .black, location: clear + ramp), .init(color: .black, location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                }
                .ignoresSafeArea()
            }
            Button(action: onBack) {
                Text("\u{2190}")
                    .font(WM.font(12.8, 720))
                    .foregroundStyle(WM.shell)
                    .frame(width: 44, height: 40)
                    .background(WM.ink, in: Ellipse())
                    // The web draws a 3 px focus ring 2 px outside the button.
                    .overlay(Ellipse().stroke(WM.ink, lineWidth: 3).padding(-3.7))
            }
            .buttonStyle(.plain)
            .offset(x: 15, y: WM.topInset + 1)
            // The phone header shows the section name in place of the title and hides the description (web #1299).
            WMHeaderDetail(text: kicker, divider: false)
                .frame(width: 206, height: 40, alignment: .leading)
                .offset(x: 68, y: WM.topInset + 1)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea(edges: .vertical)
        .webGutter()
    }
}

/// `TvEmptyState` (graphic "details") at its mobile size: a 116 px disc with the pink glyph, then the
/// title and description to its right.
struct WMEmptyStateRow: View {
    let title: String
    let description: String
    var isError = false
    /// Lines the description wraps to (the copy block is centred against the disc).
    var lines = 2
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let block = 22 + 7 + 11.5 * CGFloat(lines)
        let top = (116 - block) / 2
        ZStack(alignment: .topLeading) {
            Circle()
                .fill(PlayarrStyle.surfaceStrong.opacity(0.54))
                .overlay(Circle().stroke(WM.line.opacity(scheme == .dark ? 0.2 : 0.28).opacity(0.5), lineWidth: 1))
                .frame(width: 116, height: 116)
            WMEmptyGlyph()
                .stroke(WM.pink, style: StrokeStyle(lineWidth: 1.8 * 44 / 48, lineCap: .round, lineJoin: .round))
                .frame(width: 44, height: 29)
                .offset(x: 36, y: 43)
            Text(title)
                .font(WM.font(14.4, 650))
                .tracking(-0.288)
                .foregroundStyle(isError ? WM.pink : WM.ink)
                .lineLimit(1)
                .frame(width: 157, height: 22, alignment: .leading)
                .offset(x: 138, y: top)
            WMPara(text: description, size: 7.68, weight: 400, lh: 11.5, width: 157, height: 11.5 * CGFloat(lines))
                .offset(x: 138, y: top + 29)
        }
        .frame(width: 358, height: 116, alignment: .topLeading)
    }
}

/// The "details" empty-state glyph (48x32 viewBox): a card with three text lines and a dot.
struct WMEmptyGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let k = 44.0 / 48.0
        var p = Path()
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x * k, y: y * k) }
        p.addRoundedRect(
            in: CGRect(x: 7 * k, y: 5 * k, width: 34 * k, height: 22 * k),
            cornerSize: CGSize(width: 3 * k, height: 3 * k)
        )
        for (x1, x2, y) in [(13.0, 27.0, 12.0), (13.0, 33.0, 17.0), (13.0, 25.0, 22.0)] {
            p.move(to: pt(x1, y))
            p.addLine(to: pt(x2, y))
        }
        p.addEllipse(in: CGRect(x: 33 * k, y: 9 * k, width: 4 * k, height: 4 * k))
        return p
    }
}
