import PlayarrKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// Building blocks for screens laid out on the web TV grid (1920x1080 stage, CSS pixels
/// measured from the web client's layout). Elements are placed by their CSS box (x, y, w, h);
/// text is centred vertically in its box, as a CSS line box does.
extension View {
    /// Places the view's box at (x, y) inside a top-leading ZStack.
    func placed(
        x: CGFloat,
        y: CGFloat,
        w: CGFloat? = nil,
        h: CGFloat? = nil,
        alignment: Alignment = .leading
    ) -> some View {
        frame(width: w, height: h, alignment: alignment).offset(x: x, y: y)
    }

    /// `placed` with real layout (padding, not an offset): the focus engine sees the view where it is drawn. Use it for
    /// focusable controls and the containers that hold them.
    func pinned(
        x: CGFloat,
        y: CGFloat,
        w: CGFloat? = nil,
        h: CGFloat? = nil,
        alignment: Alignment = .leading
    ) -> some View {
        frame(width: w, height: h, alignment: alignment)
            .padding(.leading, x)
            .padding(.top, y)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Web `.tv-rail-panel` / `.tv-rail-surface`: frosted gradient across the right of the stage.
/// Light follows the CSS (`--tv-rail-frost` is 48% surface-soft over surface-strong, alphas 68/88/96/100);
/// dark keeps the calibrated soft-surface ramp.
struct TVRailPanelGradient: View {
    var width: CGFloat
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        LinearGradient(stops: stops, startPoint: .leading, endPoint: .trailing)
            .frame(width: width)
            .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private var stops: [Gradient.Stop] {
        if scheme == .light {
            let frost = Color(red: 239.6 / 255, green: 238.2 / 255, blue: 238.7 / 255)
            return [
                .init(color: frost.opacity(0), location: 0),
                .init(color: frost.opacity(0.68), location: 0.12),
                .init(color: frost.opacity(0.88), location: 0.34),
                .init(color: frost.opacity(0.96), location: 0.62),
                .init(color: frost, location: 1),
            ]
        }
        // Web dark `.tv-rail-surface`: `--tv-rail-frost` = surface-soft 44 % mixed into surface-strong, at 72 / 90 / 97 / 100 %.
        let frost = Color(red: 40.0 / 255, green: 34.7 / 255, blue: 39.6 / 255)
        return [
            .init(color: frost.opacity(0), location: 0),
            .init(color: frost.opacity(0.72), location: 0.12),
            .init(color: frost.opacity(0.90), location: 0.34),
            .init(color: frost.opacity(0.97), location: 0.62),
            .init(color: frost, location: 1),
        ]
    }
}

/// Web `.tv-key-art img` filter: dark `grayscale contrast(.82) brightness(.6)` at 0.72, light
/// `grayscale contrast(.88) brightness(1.1)` at 0.4.
struct TVKeyArtFilter: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        if scheme == .light {
            content
                .saturation(0)
                .contrast(0.88)
                #if os(macOS)
                // Web light `.tv-key-art img`: grayscale, contrast .88, brightness 1.1 at opacity .24 (measured against the movies
                // reference: the .4 here left the backdrop far stronger than the web's); tvOS keeps its own value.
                .brightness(0.1)
                .opacity(0.24)
                #else
                // Web TV uses 0.24 for the light-mode key art on every wide
                // viewport, including tvOS.
                .opacity(0.24)
                #endif
        } else {
            content
                .saturation(0)
                .contrast(DesignTokens.Shell.keyArtContrast)
                .colorMultiply(Color(white: DesignTokens.Shell.keyArtBrightness))
                .opacity(DesignTokens.Shell.keyArtOpacity)
        }
    }
}

/// The web's eased scroll-edge fade (`[data-fade-axis]` in page-layout.css): smoothstep ramps with coefficients
/// 0.156 / 0.5 / 0.844 at the quarter points, and a floor under the alpha on the end side.
enum TVEdgeFade {
    /// Gradient stops for a ramp from `from` to `to` (fractions of the axis), alpha `low` to `high`.
    static func ramp(from: CGFloat, to: CGFloat, low: Double, high: Double) -> [Gradient.Stop] {
        [(0.0, 0.0), (0.25, 0.156), (0.5, 0.5), (0.75, 0.844), (1.0, 1.0)].map { t, k in
            Gradient.Stop(color: .black.opacity(low + (high - low) * k), location: from + (to - from) * t)
        }
    }
}

/// Web page header: round back button, h1 and an optional detail after a hairline divider.
struct TVPageHeader: View {
    var title: String
    /// The web `.page-subtitle`: beside the title after a hairline divider, in ink.
    var detail: String? = nil
    /// Settings shows the back button focused (web: a white ring round the same disc).
    var backFocused = false
    @Environment(\.colorScheme) private var scheme
    /// Web `--line-strong`: rgba(223, 220, 221, .23) in dark, rgba(56, 38, 33, .28) in light.
    private var lineStrong: Color { scheme == .dark ? Color(red: 223 / 255, green: 220 / 255, blue: 221 / 255).opacity(0.23) : Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(0.28) }

    /// Gap round the hairline: the Mac's title ink runs 2 pt wider than the web's, so its gaps are 2 pt tighter.
    #if os(macOS)
    private let headerSpacing: CGFloat = 22
    #else
    private let headerSpacing: CGFloat = 24
    #endif

    var body: some View {
        ZStack(alignment: .topLeading) {
            let size: CGFloat = backFocused ? 58 : 50
            let origin: CGFloat = backFocused ? 149.6 : 153.6
            Circle()
                .fill(DesignTokens.Color.backgroundElevated.opacity(0.7))
                .overlay(
                    Circle().stroke(
                        backFocused ? DesignTokens.Color.textPrimary : DesignTokens.Color.borderDefault.opacity(0.35),
                        lineWidth: backFocused ? 2 : 1
                    )
                )
                .overlay(
                    Text("\u{2190}")
                        .font(TVTheme.font(size: 17.3, weight: .semibold))
                        .foregroundStyle(DesignTokens.Color.textSecondary)
                )
                .placed(x: origin, y: backFocused ? 52.2 : 56.2, w: size, h: size)
            // Web `.page-header`: the title, a hairline divider and the subtitle in one row, centred on the title. Only when
            // the row would run into the clock (x 466) does the subtitle drop under the title.
            let titleText = Text(title)
                .font(TVTheme.font(size: 33.6, css: 580))
                .tracking(-1.5)
                .foregroundStyle(DesignTokens.Color.textPrimary)
                .fixedSize()
            let subtitle = detail.map {
                Text($0.uppercased())
                    .font(TVTheme.font(size: 11.14, css: 680))
                    .tracking(0.5)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .fixedSize()
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: headerSpacing) {
                    titleText
                    if let subtitle {
                        Rectangle().fill(lineStrong).frame(width: 1, height: 17)
                        subtitle
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    // Web: a hairline under the title where the subtitle wraps below it.
                    titleText.overlay(alignment: .bottom) {
                        Rectangle().fill(lineStrong).frame(height: 1).offset(y: 8)
                    }
                    if let subtitle { subtitle }
                }
            }
            .frame(width: 466 - 226.6, alignment: .leading)
            .placed(x: 226.6, y: 56.2, h: 50)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// Loads artwork that needs the signed-in session (chapter and episode stills) and shows it
/// `scaledToFill`; `placeholder` shows while loading or when the server has no frame.
struct TVAuthedImage<Placeholder: View>: View {
    let load: () async throws -> Data
    @ViewBuilder var placeholder: () -> Placeholder
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().interpolation(.high).scaledToFill()
            } else {
                placeholder()
            }
        }
        .task {
            if let data = try? await load(), let decoded = UIImage(data: data) {
                image = decoded
            }
        }
    }
}

/// Greedy word wrap using the real font metrics, so multi-line titles break where the web's do.
enum TVTextWrap {
    /// Width of one line of text in the real font.
    static func measure(_ text: String, weight: CGFloat, size: CGFloat, kern: CGFloat) -> CGFloat {
        let font = TVFontLoader.uiFont(mono: false, size: size, weight: weight)
        return (text as NSString).size(withAttributes: [.font: font, .kern: kern]).width
    }
    /// `balanced` mirrors CSS `text-wrap: balance`: the narrowest width that keeps the greedy line count.
    static func lines(_ text: String, weight: CGFloat, size: CGFloat, kern: CGFloat, width: CGFloat, balanced: Bool = false) -> [String] {
        let greedy = greedyLines(text, weight: weight, size: size, kern: kern, width: width)
        guard balanced, greedy.count > 1 else { return greedy }
        var lo: CGFloat = 0, hi = width
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if greedyLines(text, weight: weight, size: size, kern: kern, width: mid).count <= greedy.count { hi = mid } else { lo = mid }
        }
        return greedyLines(text, weight: weight, size: size, kern: kern, width: hi)
    }

    private static func greedyLines(_ text: String, weight: CGFloat, size: CGFloat, kern: CGFloat, width: CGFloat) -> [String] {
        let font = TVFontLoader.uiFont(mono: false, size: size, weight: weight)
        func measure(_ value: String) -> CGFloat {
            (value as NSString).size(withAttributes: [.font: font, .kern: kern]).width
        }
        var lines: [String] = []
        var current = ""
        for word in text.split(separator: " ").map(String.init) {
            let candidate = current.isEmpty ? word : current + " " + word
            if measure(candidate) > width, !current.isEmpty {
                lines.append(current)
                current = word
            } else {
                current = candidate
            }
        }
        if !current.isEmpty { lines.append(current) }
        return lines.isEmpty ? [text] : lines
    }
}

/// Date and runtime strings as the web client shows them (en-GB, `1 Jun 2020`, `1 min`, `1h 44m`).
enum TVWebFormat {
    static func date(_ iso: String?) -> String? {
        guard let iso, iso.count >= 10 else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_GB")
        parser.timeZone = TimeZone(identifier: "UTC")
        parser.dateFormat = "yyyy-MM-dd"
        guard let date = parser.date(from: String(iso.prefix(10))) else { return nil }
        let out = DateFormatter()
        out.locale = Locale(identifier: "en_GB")
        out.timeZone = TimeZone(identifier: "UTC")
        out.dateFormat = "d MMM yyyy"
        return out.string(from: date)
    }

    static func year(_ iso: String?) -> String? {
        guard let iso, iso.count >= 4 else { return nil }
        return String(iso.prefix(4))
    }

    /// Web `yearRangeLabel`: show the UTC end year only when it is later than the release year.
    static func yearRange(_ releaseDate: String?, endDate: String?) -> String? {
        guard let start = yearNumber(releaseDate) else { return nil }
        guard let end = yearNumber(endDate), end > start else { return String(start) }
        return "\(start)–\(end)"
    }

    private static func yearNumber(_ iso: String?) -> Int? {
        guard let iso, let utc = TimeZone(secondsFromGMT: 0) else { return nil }
        let parser = ISO8601DateFormatter()
        parser.timeZone = utc
        if iso.count == 10 {
            parser.formatOptions = [.withFullDate]
        } else {
            parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if parser.date(from: iso) == nil {
                parser.formatOptions = [.withInternetDateTime]
            }
        }
        guard let date = parser.date(from: iso) else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        let year = calendar.component(.year, from: date)
        return year > 0 ? year : nil
    }

    static func runtime(ms: Int64?) -> String? {
        guard let ms, ms > 0 else { return nil }
        let minutes = max(1, Int((Double(ms) / 60_000).rounded()))
        let hours = minutes / 60
        let rest = minutes % 60
        if hours <= 0 { return "\(minutes) min" }
        return rest > 0 ? "\(hours)h \(rest)m" : "\(hours)h"
    }

    static func clock(ms: Int64) -> String {
        let total = Int(ms / 1000)
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }
}

/// Web `.app-user-identity`: avatar and name in a pill at (58.5, 997.3), version in monospace below.
struct TVWebProfileChip: View {
    var name: String
    var version: String
    var userID: String = ""
    var presetName: String? = nil
    var customAvatar: UIImage? = nil

    /// Width of the name at 11.14px / 690 with 0.22px tracking (the capsule grows with it).
    private var nameWidth: CGFloat {
        let font = TVFontLoader.uiFont(mono: false, size: 11.14, weight: 690)
        return ceil((name as NSString).size(withAttributes: [.font: font, .kern: 0.22]).width)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Capsule()
                .fill(DesignTokens.Color.backgroundInputDisabled.opacity(0.66))
                .overlay(Capsule().stroke(DesignTokens.Color.borderDefault.opacity(0.35), lineWidth: 1))
                .placed(x: 58.5, y: 997.3, w: 64.9 + nameWidth, h: 48.2)
            TVProfileAvatar(userID: userID, size: 34, presetName: presetName, customImage: customAvatar)
                .placed(x: 65.6, y: 1004.4, w: 34, h: 34)
            Text(name)
                .font(TVTheme.font(size: 11.14, css: 690))
                .tracking(0.22)
                .foregroundStyle(DesignTokens.Color.textSecondary)
                .lineLimit(1)
                .fixedSize()
                .placed(x: 110, y: 1013, w: nameWidth, h: 16.7)
            Text(version)
                .font(TVTheme.mono(size: 8, css: 700))
                .tracking(0.32)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .placed(x: 66.3, y: 1050.5, h: 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
    }
}

/// Web `.tv-key-art`: the 1038 x 1190 picture at (-20, -23), filtered, fading out to the right,
/// plus its `::after` wash (surface from the left and bottom edges).
struct TVKeyArt: View {
    var url: URL?

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        Color.clear
                    }
                }
                .frame(width: 1038.3, height: 1190.6)
                .clipped()
                .modifier(TVKeyArtFilter())
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: DesignTokens.Shell.keyArtMaskSolidEnd),
                            .init(color: .clear, location: 1),
                        ],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .offset(x: -20, y: -22.9)
            }
            keyArtAfter.frame(width: 1920, height: 1080)
        }
        // The picture is taller than the stage: pin the layout to the stage so nothing shifts.
        .frame(width: 1920, height: 1080, alignment: .topLeading)
        .clipped()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var keyArtAfter: some View {
        ZStack {
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated, location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.22),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated, location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.22),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.82),
                    .init(color: DesignTokens.Color.backgroundElevated, location: 1),
                ],
                startPoint: .bottom,
                endPoint: .top
            )
        }
        .allowsHitTesting(false)
    }
}

/// Web `.tv-stage-wash`: the surface colour washing in from the left and, lighter, from the right.
struct TVStageWash: View {
    var body: some View {
        ZStack {
            LinearGradient(
                stops: [
                    // Web `.tv-stage-wash`: surface 94% at 0, 90% at 36%, clear at 52%.
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.94), location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.90), location: 0.36),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.52),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
            LinearGradient(
                stops: [
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0.50), location: 0),
                    .init(color: DesignTokens.Color.backgroundElevated.opacity(0), location: 0.34),
                ],
                startPoint: .trailing,
                endPoint: .leading
            )
        }
        .allowsHitTesting(false)
    }
}

/// The big title of Home, Library and detail: wraps at 379.5 like the web and keeps 62.2px lines.
struct TVHeroTitle: View {
    var title: String
    var cssWeight: CGFloat = 560

    var body: some View {
        #if os(macOS)
        let lines = TVTextWrap.lines(title, weight: cssWeight, size: 69.12, kern: -4.98, width: 379.5, balanced: true)
        #else
        let lines = TVTextWrap.lines(title, weight: cssWeight, size: 69.12, kern: -4.98, width: 379.5)
        #endif
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(TVTheme.font(size: 69.12, css: cssWeight))
                    .tracking(-4.98)
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(width: 379.5, height: 62.2, alignment: .leading)
            }
        }
    }
}

/// Web control focus (`--page-focus-ring`): a 3 px ring 2 px outside the control, never a fill. Buttons, pills, tiles.
struct TVRingButtonStyle: ButtonStyle {
    var cornerRadius: CGFloat = 14

    func makeBody(configuration: Configuration) -> some View {
        Ring(label: configuration.label, cornerRadius: cornerRadius)
    }

    private struct Ring<Label: View>: View {
        let label: Label
        let cornerRadius: CGFloat
        @Environment(\.isFocused) private var isFocused
        #if os(macOS)
        private let ringOut: CGFloat = 3.5
        #else
        private let ringOut: CGFloat = 2
        #endif

        var body: some View {
            label.overlay(
                // Web `--page-focus-ring`: 3 px ring, 2 px offset (centre 3.5 px out); the web reference's back button measures 5 px.
                RoundedRectangle(cornerRadius: cornerRadius + ringOut, style: .continuous)
                    .stroke(DesignTokens.Stage.focusRing, lineWidth: 3)
                    .padding(-ringOut)
                    .opacity(isFocused ? 1 : 0)
            )
        }
    }
}

/// The one shared right-side panel (web `.tv-filter-drawer`): 360 wide, full height from the first frame, kicker,
/// title and close button, then the page's sections. Menu closes it; focus stays inside while it is open.
struct TVDrawer<Content: View>: View {
    let kicker: String
    let title: String
    let onClose: () -> Void
    /// The content takes the first focus (web: the actions drawer opens on Play), not the close button.
    var focusesContent = false
    @ViewBuilder var content: () -> Content
    /// Focus moves into the drawer when it opens (web: the panel takes focus; Back closes it).
    @FocusState private var closeFocused: Bool

    /// The web close button is a circle (the 2026-10-15 refs of every Apple device).
    private static var closeRadius: CGFloat { 25 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 3.2) {
                    Text(kicker.uppercased())
                        .font(TVTheme.font(size: 9.6, css: 720))
                        .tracking(0.672)
                        .foregroundStyle(DesignTokens.Color.textDisabled)
                        .frame(height: 14.4)
                    Text(title)
                        .font(TVTheme.font(size: 38.4, css: 590))
                        .tracking(-2.1)
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .lineLimit(2)
                        .frame(width: 204, alignment: .leading)
                }
                Spacer(minLength: 0)
                Button(action: onClose) {
                    Text("\u{00D7}")
                        .font(TVTheme.font(size: 26.88, css: 720))
                        .foregroundStyle(DesignTokens.Color.textPrimary)
                        .frame(width: 48, height: 50)
                        .background(RoundedRectangle(cornerRadius: Self.closeRadius, style: .continuous).fill(DesignTokens.Stage.surfaceSoft))
                        #if os(macOS)
                        // Web `.drawer-close`: a round button with the shared dark focus ring; the frozen capture draws the ring of
                        // the focused close button too (the web reference opens with it focused).
                        .overlay {
                            if TVParityLaunch.frozen, !focusesContent {
                                RoundedRectangle(cornerRadius: Self.closeRadius + 3.5, style: .continuous)
                                    .stroke(DesignTokens.Stage.focusRing, lineWidth: 3).padding(-3.5)
                            }
                        }
                        #endif
                }
                .buttonStyle(TVRingButtonStyle(cornerRadius: Self.closeRadius))
                .focusEffectDisabled()
                .focused($closeFocused)
                #if os(macOS)
                .macPreferredFocus(!focusesContent) // the drawer opens with the close button focused, as on tvOS
                #endif
                .accessibilityLabel("Close")
            }
            .padding(.top, 54)
            content()
                .padding(.top, 34)
            Spacer(minLength: 0)
        }
        .padding(.leading, 46)
        .padding(.trailing, 46)
        .frame(width: 360, height: 1080, alignment: .topLeading)
        .background {
            ZStack {
                #if os(tvOS)
                // Web `backdrop-filter: blur(38px)`: the page art behind the panel is blurred, not sharp.
                Rectangle().fill(.regularMaterial)
                #endif
                DesignTokens.Stage.surfaceStrong.opacity(0.94)
            }
            // Web `box-shadow: -32px 0 90px rgba(40, 26, 24, 0.24)`.
            .shadow(color: Color(red: 40 / 255, green: 26 / 255, blue: 24 / 255).opacity(0.24), radius: 45, x: -32, y: 0)
        }
        .focusSection()
        #if os(macOS)
        .macFocusLayer() // every drawer keeps keyboard focus inside it on the Mac (macOS/MacFocus.swift)
        #endif
        .onExitCommand(perform: onClose)
        .task { if !focusesContent { closeFocused = true } }
        #if DEBUG && (os(tvOS) || os(macOS))
        .onAppear { TVParityState.setPanel(title) }
        .onDisappear { TVParityState.setPanel(nil) }
        #endif
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .ignoresSafeArea()
    }
}

/// A drawer section (web `FilterSection` with the shared choice control): label, then one button per option.
struct TVChoiceSection<Value: Hashable>: View {
    let title: String
    let options: [(value: Value, label: String)]
    @Binding var selection: Value

    var body: some View {
        VStack(alignment: .leading, spacing: 11.9) {
            Text(title.uppercased())
                .font(TVTheme.font(size: 9.6, css: 720))
                .tracking(0.672)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(height: 14.4)
            HStack(spacing: 8) {
                ForEach(options, id: \.value) { option in
                    let active = option.value == selection
                    Button { selection = option.value } label: {
                        choiceLabel(option, active: active)
                            .font(TVTheme.font(size: 10.56, css: 680))
                            .foregroundStyle(active ? DesignTokens.Color.backgroundBase : DesignTokens.Color.textDisabled)
                            .frame(width: (268 - 8 * CGFloat(options.count - 1)) / CGFloat(options.count), height: 56)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(active ? DesignTokens.Color.textPrimary : DesignTokens.Stage.surfaceSoft.opacity(0.64))
                            )
                            // Web `.tv-filter-choice-grid button`: a 1 px border at 76% of `--line`.
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(DesignTokens.Stage.ink.opacity(0.1), lineWidth: 1))
                            .scaleEffect(active ? 1.025 : 1)
                    }
                    .buttonStyle(TVRingButtonStyle(cornerRadius: 12))
                    .focusEffectDisabled()
                }
            }
        }
        .padding(.bottom, 30.3)
    }

    /// The label; the View options carry the web's list / screen / cover glyph above it.
    @ViewBuilder
    private func choiceLabel(_ option: (value: Value, label: String), active: Bool) -> some View {
        if title == "View", let key = option.value as? String {
            VStack(spacing: 7) {
                TVViewGlyph(kind: key)
                Text(option.label)
            }
        } else {
            Text(option.label)
        }
    }
}

/// Web Filters "View" glyphs: three outlined bars for List, three outlined tall boxes for Screen and (narrower) Cover.
struct TVViewGlyph: View {
    let kind: String

    var body: some View {
        Group {
            if kind == "list" {
                VStack(spacing: 1.5) {
                    ForEach(0..<3, id: \.self) { _ in RoundedRectangle(cornerRadius: 1).stroke(lineWidth: 1.2).frame(width: 20, height: 3.6) }
                }
            } else {
                HStack(spacing: kind == "cover" ? 1.5 : 2) {
                    ForEach(0..<3, id: \.self) { _ in
                        RoundedRectangle(cornerRadius: 1).stroke(lineWidth: 1.2).frame(width: kind == "cover" ? 4.5 : 6, height: 13)
                    }
                }
            }
        }
        .frame(height: 14)
    }
}


/// Web media actions (`MediaContextMenu`): a long press (650 ms) on a media card opens its actions in the shared drawer.
struct TVOpenActionsKey: EnvironmentKey {
    static let defaultValue: (Work) -> Void = { _ in }
}

extension EnvironmentValues {
    var openActions: (Work) -> Void {
        get { self[TVOpenActionsKey.self] }
        set { self[TVOpenActionsKey.self] = newValue }
    }
}

/// A pushed page of the stage (shell navigation path).
enum TVRoute: Hashable {
    case work(Work)
    case playlist(id: UUID, name: String)
}

/// The title whose actions drawer is open (nil when closed): its card takes focus back when the drawer closes.
struct TVActionsWorkIDKey: EnvironmentKey {
    static let defaultValue: UUID? = nil
}

extension EnvironmentValues {
    var actionsWorkID: UUID? {
        get { self[TVActionsWorkIDKey.self] }
        set { self[TVActionsWorkIDKey.self] = newValue }
    }
}

struct TVOpenRouteKey: EnvironmentKey {
    static let defaultValue: (TVRoute) -> Void = { _ in }
}

extension EnvironmentValues {
    var openRoute: (TVRoute) -> Void {
        get { self[TVOpenRouteKey.self] }
        set { self[TVOpenRouteKey.self] = newValue }
    }
}

/// A stable grid coordinate used only by parity diagnostics. It does not affect focus selection.
struct TVParityGridPosition: Equatable {
    let row: Int
    let column: Int

    init?(itemIndex: Int, columns: Int) {
        guard itemIndex >= 0, columns > 0 else { return nil }
        row = itemIndex / columns
        column = itemIndex % columns
    }
}

/// A media card's button: Select opens the title; holding Select for 650 ms opens its actions instead (web long
/// press), and the release that follows does not also open the title.
struct TVCardButton<Label: View>: View {
    let work: Work
    var route: TVRoute? = nil
    /// Debug parity only: the card's Home rail and its place in it.
    var parityPosition: (rail: Int, index: Int)? = nil
    /// Debug parity only: a library grid cell's zero-based row and column.
    var parityGridPosition: TVParityGridPosition? = nil
    @ViewBuilder var label: () -> Label
    @Environment(\.openActions) private var openActions
    @Environment(\.openRoute) private var openRoute
    @Environment(\.actionsWorkID) private var actionsWorkID
    @State private var longPressed = false
    @FocusState private var focused: Bool
    #if os(macOS)
    @Environment(\.macFocusBindingBridge) private var macFocusBindingBridge
    #endif

    private var buttonContent: some View {
        Button {
            if longPressed { longPressed = false } else { openRoute(route ?? .work(work)) }
        } label: {
            label().parityFocusTag(work.title, id: work.id.uuidString, rail: parityPosition?.rail, index: parityPosition?.index,
                                   gridPosition: parityGridPosition)
        }
        #if DEBUG && (os(tvOS) || os(macOS))
        .onChange(of: focused) { _, now in TVParityState.setFocus(work.title, now, id: work.id.uuidString,
                                                                  rail: parityPosition?.rail, index: parityPosition?.index,
                                                                  gridPosition: parityGridPosition) }
        #endif
        .simultaneousGesture(LongPressGesture(minimumDuration: 0.65).onEnded { _ in
            longPressed = true
            openActions(work)
        })
        #if os(macOS)
        // The Mac's long press: a right click, or Shift+Return (macOS/MacFocus.swift).
        .macSecondaryAction { openActions(work) }
        .environment(\.macParityTag, MacParityTag(title: work.title, id: work.id.uuidString, rail: parityPosition?.rail,
                                                  index: parityPosition?.index, gridPosition: parityGridPosition))
        #endif
    }

    @ViewBuilder
    private var focusBoundButton: some View {
        #if os(macOS)
        if macFocusBindingBridge == nil {
            buttonContent.focused($focused)
        } else {
            buttonContent
        }
        #else
        buttonContent.focused($focused)
        #endif
    }

    var body: some View {
        focusBoundButton
        // Web: closing the actions drawer returns focus to the card that opened it.
        .onChange(of: actionsWorkID) { previous, current in
            if previous == work.id, current == nil {
                #if os(macOS)
                if let macFocusBindingBridge { macFocusBindingBridge.restore() }
                else { focused = true }
                #else
                focused = true
                #endif
            }
        }
    }
}

extension View {
    /// Debug-only: names the focused control for the parity driver (see `TVParityState.setFocus`). Apply inside a button's label.
    @ViewBuilder func parityFocusTag(_ title: String, id: String? = nil, rail: Any? = nil, index: Int? = nil,
                                     gridPosition: TVParityGridPosition? = nil) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityFocusTag(title: title, id: id, rail: rail, index: index, gridPosition: gridPosition))
        #else
        self
        #endif
    }
}

#if DEBUG && (os(tvOS) || os(macOS))
private struct TVParityFocusTag: ViewModifier {
    let title: String
    var id: String?
    var rail: Any?
    var index: Int?
    var gridPosition: TVParityGridPosition?
    @Environment(\.isFocused) private var isFocused
    func body(content: Content) -> some View {
        content
            .onChange(of: isFocused) { _, now in TVParityState.setFocus(title, now, id: id, rail: rail, index: index,
                                                                         gridPosition: gridPosition) }
            // A control that starts focused (the drawer's first action) never changes.
            .onAppear { if isFocused { TVParityState.setFocus(title, true, id: id, rail: rail, index: index,
                                                              gridPosition: gridPosition) } }
    }
}
#endif

/// One action row (web `.media-context-actions` button): 268 x 68, brand glyph and a bold label, control focus ring.
struct TVActionRow: View {
    let glyph: String
    let label: String
    var preferred = false
    let action: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: action) {
            HStack(spacing: 0) {
                Text(glyph)
                    .font(TVTheme.font(size: 19.52, css: 400))
                    .foregroundStyle(DesignTokens.Stage.brandPink)
                    .frame(width: 42, alignment: .leading)
                Text(label)
                    .font(TVTheme.font(size: 19.2, css: 700))
                    .foregroundStyle(DesignTokens.Color.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.leading, 18)
            .frame(width: 268, height: 68)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(DesignTokens.Stage.surfaceSoft))
        }
        .buttonStyle(TVRingButtonStyle(cornerRadius: 14))
        .focusEffectDisabled()
        .focused($focused)
        #if DEBUG && (os(tvOS) || os(macOS))
        .onChange(of: focused) { _, now in TVParityState.setFocus(label, now) }
        #endif
        .task { if preferred { focused = true } }
        #if os(macOS)
        .macPreferredFocus(preferred)
        #endif
    }
}


/// Web `MultiSelect` in a drawer section: the field shows "Any language" or the chosen names; Select opens the
/// options (name and title count), each toggles; any chosen code matches.
struct TVMultiSelectSection: View {
    let title: String
    let facets: [LanguageFacet]?
    let loaded: Bool
    @Binding var selection: [String]
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 11.9) {
            Text(title.uppercased())
                .font(TVTheme.font(size: 9.6, css: 720))
                .tracking(0.672)
                .foregroundStyle(DesignTokens.Color.textDisabled)
                .frame(height: 14.4)
            if !loaded {
                RoundedRectangle(cornerRadius: 12).fill(DesignTokens.Stage.surfaceSoft.opacity(0.5)).frame(width: 268, height: 58.8)
            } else if (facets ?? []).isEmpty, selection.isEmpty {
                Text("No languages to filter by.")
                    .font(TVTheme.font(size: 11.84, css: 400))
                    .foregroundStyle(DesignTokens.Color.textDisabled)
            } else {
                Button { open.toggle() } label: {
                    HStack {
                        Text(summary)
                            .font(TVTheme.font(size: 11.84, css: 680))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                        Text(open ? "\u{2303}" : "\u{2304}")
                            .font(TVTheme.font(size: 11.84, css: 680))
                            .foregroundStyle(DesignTokens.Color.textSecondary)
                    }
                    .padding(.horizontal, 19.4)
                    .frame(width: 268, height: 58.8)
                    .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(DesignTokens.Stage.surfaceSoft.opacity(0.64)))
                }
                .buttonStyle(TVRingButtonStyle(cornerRadius: 12))
                .focusEffectDisabled()
                if open {
                    ForEach(options) { facet in
                        let chosen = selection.contains(facet.code)
                        Button {
                            if chosen { selection.removeAll { $0 == facet.code } } else { selection.append(facet.code) }
                        } label: {
                            HStack {
                                Text(chosen ? "\u{2713}" : "")
                                    .frame(width: 18, alignment: .leading)
                                Text(facet.displayName).lineLimit(1)
                                Spacer(minLength: 0)
                                if let count = facet.count {
                                    Text("\(count)").foregroundStyle(DesignTokens.Color.textDisabled)
                                }
                            }
                            .font(TVTheme.font(size: 11.84, css: chosen ? 760 : 520))
                            .foregroundStyle(DesignTokens.Color.textPrimary)
                            .padding(.horizontal, 14)
                            .frame(width: 268, height: 44)
                            .background(RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(chosen ? DesignTokens.Stage.surfaceSoft : Color.clear))
                        }
                        .buttonStyle(TVRingButtonStyle(cornerRadius: 10))
                        .focusEffectDisabled()
                    }
                }
            }
        }
        .padding(.bottom, 30.3)
    }

    /// The facets plus any chosen code the facets no longer list (web `languageOptions`).
    private var options: [LanguageFacet] {
        var rows = facets ?? []
        for code in selection where !rows.contains(where: { $0.code == code }) {
            rows.append(LanguageFacet(code: code, name: nil, count: nil))
        }
        return rows
    }

    private var summary: String {
        if selection.isEmpty { return "Any language" }
        return selection.map { code in options.first { $0.code == code }?.displayName ?? code }.joined(separator: ", ")
    }
}

/// Web `.status-pill`: one status per entry, tinted by its tone (14% over the surface, 60% border), ink text.
struct TVStatusPill: View {
    enum Tone { case available, upcoming, missing, neutral }
    let tone: Tone

    var body: some View {
        let colour = TVCalendarView.toneColour(tone)
        Text(label)
            .font(TVTheme.font(size: 13.44, css: 750))
            .foregroundStyle(DesignTokens.Color.textPrimary)
            .padding(.horizontal, 10.4)
            .frame(height: 26.6)
            .background(Capsule().fill(colour.opacity(0.14)).background(Capsule().fill(DesignTokens.Stage.surface)))
            .overlay(Capsule().stroke(colour.opacity(0.6), lineWidth: 1))
            .fixedSize()
    }

    private var label: String {
        switch tone {
        case .available: return "Available"
        case .upcoming: return "Upcoming"
        case .missing: return "Missing"
        case .neutral: return "Not tracked"
        }
    }
}

/// Opens a title the calendar only knows by id: loads it, then shows the normal detail page.
struct TVWorkDetailLoader: View {
    let workID: UUID
    @Environment(TVAppEnvironment.self) private var environment
    @State private var work: Work?

    var body: some View {
        Group {
            if let work {
                TVWorkDetailView(work: work, apiClient: environment.apiClient)
            } else {
                DesignTokens.Color.backgroundElevated.ignoresSafeArea()
            }
        }
        .task(id: workID) { work = try? await environment.apiClient.fetchWork(id: workID).work }
    }
}

#if os(macOS)
extension View {
    /// Web `[data-fade-axis][data-fade-end]` mask: a smoothstep ramp (0.844 / 0.5 / 0.156 at 25 / 50 / 75 %) over the page's edge-fade
    /// size, down to `endFloor` at the very edge. The start side is left alone: the web fades it only once content has scrolled past.
    func macEdgeFade(axis: Axis, endFloor: Double, size: CGFloat = 59) -> some View {
        modifier(MacEdgeFade(axis: axis, endFloor: endFloor, size: size))
    }
}

private struct MacEdgeFade: ViewModifier {
    let axis: Axis
    let endFloor: Double
    let size: CGFloat

    func body(content: Content) -> some View {
        // The GeometryReader sits in the mask, so it takes the masked view's size and never changes the layout.
        content.mask {
            GeometryReader { proxy in
                let length = axis == .horizontal ? proxy.size.width : proxy.size.height
                let k = min(1, Double(size / max(length, 1)))
                LinearGradient(stops: [
                    .init(color: .black, location: 0),
                    .init(color: .black, location: 1 - k),
                    .init(color: .black.opacity(alpha(0.844)), location: 1 - k * 0.75),
                    .init(color: .black.opacity(alpha(0.5)), location: 1 - k * 0.5),
                    .init(color: .black.opacity(alpha(0.156)), location: 1 - k * 0.25),
                    .init(color: .black.opacity(endFloor), location: 1),
                ], startPoint: axis == .horizontal ? .leading : .top, endPoint: axis == .horizontal ? .trailing : .bottom)
            }
        }
    }

    private func alpha(_ t: Double) -> Double { endFloor + (1 - endFloor) * t }
}
#endif
