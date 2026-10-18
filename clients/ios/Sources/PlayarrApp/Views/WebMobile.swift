import PlayarrKit
import SwiftUI
import UIKit

/// Design tokens and primitives that reproduce Playarr Web's mobile layout
/// (390x844 CSS viewport) on iPhone. Numbers come from the web client's
/// computed layout (see `scripts/parity/apple/capture-web.mjs`, which dumps
/// every element's box and styles next to each reference capture).
enum WM {
    // Theme-adaptive tokens: the same values as the web's light and dark themes.
    static let shell = PlayarrStyle.background
    static let page = PlayarrStyle.surface
    static let ink = PlayarrStyle.ink
    static let inkSoft = PlayarrStyle.inkSoft
    static let muted = PlayarrStyle.muted
    static let detailMuted = adaptive(light: (77, 66, 72), dark: (194, 181, 187))
    static let pink = PlayarrStyle.pink
    static let brandInk = adaptive(light: (130, 30, 54), dark: (234, 166, 182))
    static let cardGlowColor = adaptive(light: (165, 39, 69), dark: (234, 166, 182))
    static let artFill = adaptive(light: (223, 220, 221), dark: (49, 42, 48))
    static let chip = PlayarrStyle.surfaceStrong
    static let line = adaptive(light: (56, 38, 33), dark: (223, 220, 221))

    static func adaptive(light: (CGFloat, CGFloat, CGFloat), dark: (CGFloat, CGFloat, CGFloat)) -> Color {
        Color(uiColor: UIColor { traits in
            let value = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(red: value.0 / 255, green: value.1 / 255, blue: value.2 / 255, alpha: 1)
        })
    }

    /// CSS font weight to the nearest Avenir Next face, using the CSS font
    /// matching order (above 500 look upwards first).
    static func weight(_ css: Int) -> Font.Weight {
        switch css {
        case ..<450: .regular
        case 450...500: .medium
        case 501...599: .semibold
        case 600...699: .bold
        case 700...: .heavy
        default: .regular
        }
    }

    /// The web's design font (Nunito Sans) at the exact CSS weight; see `DesignFont`.
    static func font(_ size: CGFloat, _ css: Int = 400) -> Font {
        DesignFont.font(size, css)
    }

    /// The web's monospace font (version label): JetBrains Mono.
    static func mono(_ size: CGFloat, _ css: Int = 400) -> Font {
        DesignFont.mono(size, css)
    }

    /// `--mobile-top-inset`: max(14px, safe-area-inset-top). The parity
    /// capture runs the web with no safe area, so it uses the 14px floor.
    @MainActor static var topInset: CGFloat {
        #if DEBUG
        if ParityLaunch.zeroInsets { return 14 }
        #endif
        return max(14, safeArea.top)
    }

    /// Bottom offset of the floating nav: max(8px, safe-area-inset-bottom).
    @MainActor static var bottomInset: CGFloat {
        #if DEBUG
        if ParityLaunch.zeroInsets { return 8 }
        #endif
        return max(8, safeArea.bottom)
    }

    /// How far the phone header sits below the web's 14 px floor; page content that starts under it moves down by this much.
    @MainActor static var topShift: CGFloat { topInset - 14 }

    /// Raw top safe-area inset (notch or Dynamic Island); 0 in a parity capture, which has no system chrome.
    @MainActor static var safeTop: CGFloat {
        #if DEBUG
        if ParityLaunch.zeroInsets { return 0 }
        #endif
        return safeArea.top
    }

    /// Side safe-area insets (landscape notch side, rounded corners); 0 in a parity capture.
    @MainActor static var leadingInset: CGFloat {
        #if DEBUG
        if ParityLaunch.zeroInsets { return 0 }
        #endif
        return safeArea.left
    }

    @MainActor static var trailingInset: CGFloat {
        #if DEBUG
        if ParityLaunch.zeroInsets { return 0 }
        #endif
        return safeArea.right
    }

    @MainActor static var safeArea: UIEdgeInsets {
        UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.safeAreaInsets ?? .zero
    }
}

/// One line of text with a CSS-style line box (height) and letter spacing.
struct WMText: View {
    let text: String
    let size: CGFloat
    let weight: Int
    let color: Color
    let lineHeight: CGFloat
    let tracking: CGFloat

    init(
        _ text: String,
        _ size: CGFloat,
        _ weight: Int = 400,
        color: Color = WM.ink,
        lh: CGFloat,
        ls: CGFloat = 0
    ) {
        self.text = text
        self.size = size
        self.weight = weight
        self.color = color
        self.lineHeight = lh
        self.tracking = ls
    }

    var body: some View {
        Text(text)
            .font(WM.font(size, weight))
            .tracking(tracking)
            .foregroundStyle(color)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(height: lineHeight, alignment: .leading)
    }
}

// MARK: - Icons (the web NavIcons, drawn from the same SVG path data)

private enum SVGToken {
    case command(Character)
    case number(CGFloat)
}

enum SVGPathParser {
    static func path(_ d: String) -> Path {
        let tokens = tokenize(d)
        var index = 0
        var path = Path()
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var lastControl: CGPoint?
        var lastWasCubic = false

        func number() -> CGFloat {
            guard index < tokens.count, case .number(let value) = tokens[index] else { return 0 }
            index += 1
            return value
        }
        func hasNumber() -> Bool {
            guard index < tokens.count, case .number = tokens[index] else { return false }
            return true
        }

        while index < tokens.count {
            guard case .command(var command) = tokens[index] else {
                index += 1
                continue
            }
            index += 1
            repeat {
                let relative = command.isLowercase
                let upper = Character(command.uppercased())
                var cubic = false
                switch upper {
                case "M":
                    let x = number(), y = number()
                    current = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                    path.move(to: current)
                    subpathStart = current
                    command = relative ? "l" : "L"
                case "L":
                    let x = number(), y = number()
                    current = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                    path.addLine(to: current)
                case "H":
                    let x = number()
                    current = CGPoint(x: relative ? current.x + x : x, y: current.y)
                    path.addLine(to: current)
                case "V":
                    let y = number()
                    current = CGPoint(x: current.x, y: relative ? current.y + y : y)
                    path.addLine(to: current)
                case "C":
                    let x1 = number(), y1 = number(), x2 = number(), y2 = number(), x = number(), y = number()
                    let base = relative ? current : .zero
                    let c1 = CGPoint(x: base.x + x1, y: base.y + y1)
                    let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                    let end = CGPoint(x: base.x + x, y: base.y + y)
                    path.addCurve(to: end, control1: c1, control2: c2)
                    lastControl = c2
                    current = end
                    cubic = true
                case "S":
                    let x2 = number(), y2 = number(), x = number(), y = number()
                    let base = relative ? current : .zero
                    let c1 = (lastWasCubic ? lastControl : nil).map {
                        CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y)
                    } ?? current
                    let c2 = CGPoint(x: base.x + x2, y: base.y + y2)
                    let end = CGPoint(x: base.x + x, y: base.y + y)
                    path.addCurve(to: end, control1: c1, control2: c2)
                    lastControl = c2
                    current = end
                    cubic = true
                case "A":
                    let rx = number(), ry = number(), rotation = number()
                    let large = number() != 0, sweep = number() != 0
                    let x = number(), y = number()
                    let end = relative ? CGPoint(x: current.x + x, y: current.y + y) : CGPoint(x: x, y: y)
                    addArc(&path, from: current, to: end, rx: rx, ry: ry, rotation: rotation, large: large, sweep: sweep)
                    current = end
                case "Z":
                    path.closeSubpath()
                    current = subpathStart
                default:
                    index = tokens.count
                }
                lastWasCubic = cubic
            } while hasNumber()
        }
        return path
    }

    private static func tokenize(_ d: String) -> [SVGToken] {
        var tokens: [SVGToken] = []
        var buffer = ""
        func flush() {
            if !buffer.isEmpty, let value = Double(buffer) { tokens.append(.number(CGFloat(value))) }
            buffer = ""
        }
        for character in d {
            if character.isLetter {
                flush()
                tokens.append(.command(character))
            } else if character == "-" {
                flush()
                buffer = "-"
            } else if character == "." {
                if buffer.contains(".") { flush() }
                buffer.append(character)
            } else if character == " " || character == "," || character == "\n" {
                flush()
            } else {
                buffer.append(character)
            }
        }
        flush()
        return tokens
    }

    /// SVG endpoint arc to cubic Bezier segments (SVG 1.1, appendix F.6).
    private static func addArc(
        _ path: inout Path, from p0: CGPoint, to p1: CGPoint,
        rx rxIn: CGFloat, ry ryIn: CGFloat, rotation: CGFloat, large: Bool, sweep: Bool
    ) {
        var rx = abs(rxIn), ry = abs(ryIn)
        if rx == 0 || ry == 0 || p0 == p1 {
            path.addLine(to: p1)
            return
        }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1p = cosPhi * dx + sinPhi * dy
        let y1p = -sinPhi * dx + cosPhi * dy
        let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
        if lambda > 1 {
            let scale = lambda.squareRoot()
            rx *= scale
            ry *= scale
        }
        let numerator = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
        let denominator = rx * rx * y1p * y1p + ry * ry * x1p * x1p
        let sign: CGFloat = large == sweep ? -1 : 1
        let coefficient = sign * max(0, numerator / denominator).squareRoot()
        let cxp = coefficient * rx * y1p / ry
        let cyp = coefficient * -(ry * x1p / rx)
        let cx = cosPhi * cxp - sinPhi * cyp + (p0.x + p1.x) / 2
        let cy = sinPhi * cxp + cosPhi * cyp + (p0.y + p1.y) / 2
        let theta1 = atan2((y1p - cyp) / ry, (x1p - cxp) / rx)
        let theta2 = atan2((-y1p - cyp) / ry, (-x1p - cxp) / rx)
        var delta = theta2 - theta1
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }
        let segments = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
        let step = delta / CGFloat(segments)
        let t = 4 / 3 * tan(step / 4)
        func point(_ angle: CGFloat) -> (CGPoint, CGPoint) {
            // Position and derivative direction on the rotated ellipse.
            let ca = cos(angle), sa = sin(angle)
            let x = cx + rx * ca * cosPhi - ry * sa * sinPhi
            let y = cy + rx * ca * sinPhi + ry * sa * cosPhi
            let tx = -rx * sa * cosPhi - ry * ca * sinPhi
            let ty = -rx * sa * sinPhi + ry * ca * cosPhi
            return (CGPoint(x: x, y: y), CGPoint(x: tx, y: ty))
        }
        var angle = theta1
        for _ in 0..<segments {
            let (a, da) = point(angle)
            let (b, db) = point(angle + step)
            path.addCurve(
                to: b,
                control1: CGPoint(x: a.x + t * da.x, y: a.y + t * da.y),
                control2: CGPoint(x: b.x - t * db.x, y: b.y - t * db.y)
            )
            angle += step
        }
    }
}

enum WMIcon {
    case downloads, search, home, series, movies, sites, music, playlists, watchlist, calendar

    struct Element {
        let path: Path
        let filled: Bool
    }

    private static func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> Element {
        Element(path: Path(ellipseIn: CGRect(x: cx - r, y: cy - r, width: 2 * r, height: 2 * r)), filled: false)
    }

    private static func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ rx: CGFloat) -> Element {
        Element(path: Path(roundedRect: CGRect(x: x, y: y, width: w, height: h), cornerRadius: rx), filled: false)
    }

    private static func line(_ d: String) -> Element { Element(path: SVGPathParser.path(d), filled: false) }
    private static func fill(_ d: String) -> Element { Element(path: SVGPathParser.path(d), filled: true) }

    var elements: [Element] {
        switch self {
        case .home:
            [Self.line("M3 11.5 12 4l9 7.5"), Self.line("M5.5 9.5V20h13V9.5"), Self.line("M10 20v-6h4v6")]
        case .search:
            [Self.circle(10.5, 10.5, 6.5), Self.line("m15.5 15.5 4.5 4.5")]
        case .series:
            [Self.rect(4, 4, 16, 16, 2), Self.line("M8 9h8M8 13h8M8 17h5"), Self.line("m10 1 2 3 2-3")]
        case .movies:
            [Self.rect(3, 5, 18, 14, 2), Self.line("m7 5 2-3M13 5l2-3M19 5l2-3"), Self.fill("m10 10 5 2.5-5 2.5z")]
        case .sites:
            [
                Self.circle(12, 12, 8.5),
                Self.line("M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5S14.2 18.2 12 20.5M12 3.5C9.8 5.8 8.7 8.6 8.7 12s1.1 6.2 3.3 8.5"),
            ]
        case .music:
            [Self.line("M9 18V6l10-2v12"), Self.circle(6.5, 18.5, 2.5), Self.circle(16.5, 16.5, 2.5), Self.line("M9 10l10-2")]
        case .downloads:
            [
                Self.line("M12 3v12"), Self.line("m7 10.5 5 4.5 5-4.5"),
                Self.line("M4.5 18.5v1.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-1.5"),
            ]
        case .playlists:
            [
                Self.line("M5 6h10M5 10h10M5 14h6"), Self.line("M17 13.5v6"), Self.line("m17 13.5 4-1.5v5.5"),
                Self.circle(15.5, 19.5, 1.5), Self.circle(19.5, 17.5, 1.5),
            ]
        case .watchlist:
            [Self.line("M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1Z"), Self.line("M12 7.5v5M9.5 10h5")]
        case .calendar:
            [Self.rect(3.5, 5, 17, 15, 2), Self.line("M3.5 10h17M8 3v4M16 3v4")]
        }
    }
}

struct WMIconView: View {
    let icon: WMIcon
    let color: Color
    var size: CGFloat = 21

    var body: some View {
        Canvas { context, _ in
            let scale = size / 24
            let transform = CGAffineTransform(scaleX: scale, y: scale)
            for element in icon.elements {
                let path = element.path.applying(transform)
                if element.filled {
                    context.fill(path, with: .color(color))
                } else {
                    context.stroke(
                        path, with: .color(color),
                        style: StrokeStyle(lineWidth: 1.8 * scale, lineCap: .round, lineJoin: .round)
                    )
                }
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Key art and chip shadow

/// The web's page backdrop: the featured title's artwork, drawn grey at low strength under a
/// wash that fades to the page colour (`.tv-key-art` and `.tv-stage-wash`).
struct WMKeyArt: View {
    let work: Work?
    let apiClient: PlayarrAPIClient
    var imageHeight: CGFloat = 483
    var fadeStart: CGFloat = 219
    var fadeEnd: CGFloat = 456
    /// Draw the whole picture at the page width (no crop) instead of filling the frame.
    var contain = false
    var imageTop: CGFloat = -9
    /// Scales the picture about its top-left corner (the web detail art measures 1% larger than its nominal box).
    var artScale: CGFloat = 1
    /// How strong the grey artwork is in the light theme; the web shows it differently per page.
    var lightOpacity: Double = 0.22
    /// The web's horizontal treatment in the light theme: the artwork fades out over its last 28% (mask)
    /// and a page-coloured wash covers its left edge at 54%.
    var webMask = false
    /// Replaces the two-point vertical fade with these (y, how much of the page colour covers) stops.
    var fadeStops: [(y: CGFloat, cover: Double)]?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack(alignment: .topLeading) {
            if let work {
                PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                    .saturation(0)
                    .opacity(scheme == .dark ? 0.085 : lightOpacity)
                    .frame(width: 406 * artScale, height: (contain ? 406 * 9 / 16 : imageHeight) * artScale)
                    .mask {
                        if webMask && scheme == .light {
                            LinearGradient(
                                stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.72), .init(color: .clear, location: 1)],
                                startPoint: .leading, endPoint: .trailing
                            )
                        } else {
                            Color.black
                        }
                    }
                    .offset(x: -8, y: imageTop)
            }
            if webMask && scheme == .light {
                LinearGradient(colors: [WM.page.opacity(0.54), WM.page.opacity(0)], startPoint: .leading, endPoint: .trailing)
            }
            LinearGradient(
                stops: fadeStops.map { stops in
                    stops.map { Gradient.Stop(color: WM.page.opacity($0.cover), location: $0.y / 844) }
                } ?? [
                    .init(color: WM.page.opacity(0), location: fadeStart / 844),
                    .init(color: WM.page, location: fadeEnd / 844),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(width: 390, height: 844, alignment: .topLeading)
        .clipped()
        .allowsHitTesting(false)
    }
}

/// Soft shadow under the web's pill buttons in the light theme.
struct WMChipShadow: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.shadow(color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(scheme == .dark ? 0 : 0.1), radius: 10, y: 5)
    }
}

/// Web detail action pills (`.tv-detail-playback-settings`): no border, `0 14px 38px` at 12% in light.
struct WMPillShadow: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.shadow(color: Color(red: 56 / 255, green: 38 / 255, blue: 33 / 255).opacity(scheme == .dark ? 0 : 0.12), radius: 19, y: 14)
    }
}

/// Soft drop shadow under card artwork.
struct WMCardShadow: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        content.shadow(color: Color(red: 31 / 255, green: 14 / 255, blue: 20 / 255).opacity(scheme == .dark ? 0.35 : 0.2), radius: 9, y: 6)
    }
}

extension View {
    func wmChipShadow() -> some View { modifier(WMChipShadow()) }
    func wmPillShadow() -> some View { modifier(WMPillShadow()) }
    func wmCardShadow() -> some View { modifier(WMCardShadow()) }
}

// MARK: - Cards

struct WMUnseenDot: View {
    var body: some View {
        Circle()
            .fill(WM.pink)
            .frame(width: 9, height: 9)
            .overlay(Circle().strokeBorder(Color.white.opacity(0.94), lineWidth: 2))
            .shadow(color: Color(red: 31 / 255, green: 14 / 255, blue: 20 / 255).opacity(0.45), radius: 4.5, y: 2)
    }
}

extension Work {
    /// Singular kind used under web cards ("Movie · 2020").
    var singularKindYearLabel: String {
        let singular: String
        switch kind {
        case .movie: singular = "Movie"
        case .series: singular = "Series"
        case .site: singular = "Site"
        case .artist: singular = "Artist"
        case .author: singular = "Author"
        }
        guard let year = WMFormat.yearRange(releaseDate: releaseDate, endDate: kind == .series ? endDate : nil) else { return singular }
        return "\(singular) · \(year)"
    }
}

/// Home rail card (`tv-home-card`): since web #924 the phone cards share one width with the library grid,
/// (viewport - 16 gutter - 52 rail pad - 12 gap) / 2, with the library card's text sizes.
/// The two Settings > Appearance choices the web keeps for Home and the grids: artwork shape (Thumbnails or Covers) and
/// artwork size (a phone shows 2 columns, 3 when small, 1 when large).
enum WMArtwork {
    static let homeViewKey = "com.playarr.ios.homeView"
    static let sizeKey = "com.playarr.ios.artworkSize"
    static var homeCover: Bool { UserDefaults.standard.string(forKey: homeViewKey) == "cover" }
    static var columns: Int {
        switch UserDefaults.standard.string(forKey: sizeKey) { case "small": 3; case "large": 1; default: 2 }
    }
    /// Web phone card: (viewport - 16 gutter - 52 letter-rail pad - 12 per gap) / columns.
    static var cardWidth: CGFloat {
        let n = CGFloat(columns)
        return ((UIScreen.main.bounds.width - 16 - 52 - 12 * (n - 1)) / n).rounded() // web --card-w has no minimum; columns come from --card-cols
    }
    static func artHeight(cover: Bool) -> CGFloat { cardWidth * (cover ? 3 / 2 : 9 / 16) }
}

/// Home rail card (`tv-home-card`): since web #924 the phone cards share one width with the library grid,
/// (viewport - 16 gutter - 52 rail pad - 12 gap) / columns, with the library card's text sizes. Covers use 2:3 art.
struct WMRailCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    var unseen = true
    var focused = false
    var cover = false
    @AppStorage(WMArtwork.sizeKey) private var sizeSetting = "medium"

    static func height(cover: Bool) -> CGFloat { WMArtwork.artHeight(cover: cover) + 46 }

    var body: some View {
        let width = WMArtwork.cardWidth, art = WMArtwork.artHeight(cover: cover)
        VStack(alignment: .leading, spacing: 0) {
            PlayarrArtwork(work: work, kind: cover ? .poster : .backdrop, apiClient: apiClient)
                .frame(width: width, height: art)
                .background(WM.artFill)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .wmCardShadow()
                .overlay(alignment: .topTrailing) {
                    if unseen { WMUnseenDot().padding(.top, 7).padding(.trailing, 7) }
                }
                .overlay { if focused { WMFocusRing(width: width, height: art) } }
            WMText(work.title, 8.8, 600, lh: 19.5, ls: -0.15).padding(.top, 8).padding(.leading, 2)
            WMText(work.singularKindYearLabel, 7.3, 400, color: WM.ink, lh: 12.3).padding(.leading, 2).offset(y: -1.3)
        }
        .frame(width: width, height: WMRailCard.height(cover: cover), alignment: .topLeading)
    }
}

/// Hardware-keyboard focus for a control: focusable with the system halo off, and the web's 3 pt ink ring 2 pt outside the
/// control's shape while it holds focus (the same ring the Calendar Today button draws).
struct WMKeyFocus<S: Shape>: ViewModifier {
    let shape: S
    @FocusState private var focused: Bool

    func body(content: Content) -> some View {
        content
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .overlay { if focused { shape.stroke(WM.ink, lineWidth: 3).padding(-3.7).allowsHitTesting(false) } }
    }
}

extension View {
    func wmKeyFocus<S: Shape>(_ shape: S) -> some View { modifier(WMKeyFocus(shape: shape)) }
}

/// Web focus ring (`--card-glow`): a 3 pt ring flush against the art plus a filled glow, `0 0 20px 4px` at 45% (a CSS blur
/// of 20 is a SwiftUI radius of 10), drawn only outside the art as a box-shadow is. An overlay, so nothing shifts.
struct WMFocusRing: View {
    let width: CGFloat
    let height: CGFloat
    var cornerRadius: CGFloat = 10

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius + 4, style: .continuous)
                .fill(WM.cardGlowColor.opacity(0.45))
                .frame(width: width + 8, height: height + 8)
                .blur(radius: 10)
                .mask {
                    Rectangle().fill(.white).padding(-60)
                        .overlay { RoundedRectangle(cornerRadius: cornerRadius, style: .continuous).frame(width: width, height: height).blendMode(.destinationOut) }
                        .compositingGroup()
                }
            RoundedRectangle(cornerRadius: cornerRadius + 1.5, style: .continuous)
                .stroke(WM.cardGlowColor, lineWidth: 3)
                .frame(width: width + 3, height: height + 3)
        }
        .allowsHitTesting(false)
    }
}

/// Library grid card (`tv-title-card`): two columns of 173x97 art with a title line.
/// Web phone library (#924): cards fit beside the 52 pt letter-rail pad, (393 - 16 gutter - 52 pad - 12 gap) / 2 on the 393 pt
/// reference, never below 110 pt.
struct WMLibraryCard: View {
    static var width: CGFloat { WMArtwork.cardWidth }
    let work: Work
    let apiClient: PlayarrAPIClient
    var unseen = true
    var focused = false
    var cover = false
    @AppStorage(WMArtwork.sizeKey) private var sizeSetting = "medium"

    static func rowHeight(cover: Bool) -> CGFloat { WMArtwork.artHeight(cover: cover) + 27.6 }

    var body: some View {
        let width = WMArtwork.cardWidth, art = WMArtwork.artHeight(cover: cover)
        VStack(alignment: .leading, spacing: 0) {
            PlayarrArtwork(work: work, kind: cover ? .poster : .backdrop, apiClient: apiClient)
                .frame(width: width, height: art)
                .background(WM.artFill)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .wmCardShadow()
                .overlay(alignment: .topTrailing) {
                    if unseen { WMUnseenDot().padding(.top, 7).padding(.trailing, 7) }
                }
                .overlay { if focused { WMFocusRing(width: width, height: art) } }
            WMText(work.title, 8.8, 600, lh: 19.5, ls: -0.15).padding(.top, 8).padding(.leading, 2)
        }
        .frame(width: width, height: WMLibraryCard.rowHeight(cover: cover), alignment: .topLeading)
    }
}

/// Search result card (`tv-search-result`): 173x97 art, bold title, uppercase kind line.
struct WMSearchCard: View {
    let work: Work
    let apiClient: PlayarrAPIClient
    var focused = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PlayarrArtwork(work: work, kind: .backdrop, apiClient: apiClient)
                .frame(width: 173, height: 97.3)
                .background(WM.chip)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .wmCardShadow()
                .overlay(alignment: .topTrailing) { WMUnseenDot().padding(.top, 7).padding(.trailing, 7) }
                .overlay { if focused { WMFocusRing(width: 173, height: 97.3, cornerRadius: 8) } }
            WMText(work.title, 12.16, 650, lh: 18.24).padding(.top, 11)
            WMText(work.singularKindYearLabel.uppercased(), 9.28, 720, color: WM.muted, lh: 13.92, ls: 0.3)
                .padding(.top, 2)
        }
        .frame(width: 173, height: 142.5, alignment: .topLeading)

    }
}

/// `app-user-identity`-style round header button.
struct WMHeaderCircleButton: View {
    let width: CGFloat
    let height: CGFloat
    let glyph: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(glyph)
                .font(WM.font(12.8, 720))
                .foregroundStyle(WM.inkSoft)
                .frame(width: width, height: height)
                .background(WM.chip.opacity(0.66), in: Ellipse())
                .overlay(Ellipse().stroke(WM.line.opacity(0.14), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

/// Page header used by the library screens: back button, title, count, trailing action.
struct WMLibraryHeader: View {
    let title: String
    let detail: String?
    let onBack: () -> Void
    let onFilters: () -> Void

    var body: some View {
        let top = WM.topInset + 2
        ZStack(alignment: .topLeading) {
            PlayarrBackButton(action: onBack)
                .offset(x: PlayarrPageTokens.gutter, y: top)
            WMText(title, 22, 520, lh: 33, ls: -1)
                .offset(x: 71, y: top + 5)
            // The web hides the header subtitle on phones (#1299), so `detail` is not drawn here.
            HStack {
                Spacer()
                PlayarrHeaderPill(label: "Filters", systemImage: "slider.horizontal.3", iconOnly: true, action: onFilters)
            }
            .padding(.trailing, 16)
            .offset(y: top - 2)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Environment

private struct PlayarrGoHomeKey: EnvironmentKey {
    static let defaultValue: () -> Void = {}
}

extension EnvironmentValues {
    /// Set by the app shell: what the web header's back arrow does on a top-level page.
    var playarrGoHome: () -> Void {
        get { self[PlayarrGoHomeKey.self] }
        set { self[PlayarrGoHomeKey.self] = newValue }
    }
}

extension View {
    /// The web's mobile gutter is max(base, side inset): inside a container already inset by the side safe area,
    /// pull the edges out by up to `base` so a content margin of `base` lands on the inset itself (zero in portrait).
    @MainActor
    func webGutter(base: CGFloat = 16) -> some View {
        padding(.leading, -min(base, WM.leadingInset)).padding(.trailing, -min(base, WM.trailingInset))
    }
}

extension View {
    /// Page content (and scrolling) stays inside the safe area: nothing draws behind the notch, the Dynamic Island or
    /// the landscape cutout. Backgrounds and hero art are separate layers that still run edge to edge. The screen root
    /// pulls its edges out by `webGutter`, so that amount is added back on the sides.
    @MainActor
    func keepInsideSafeArea() -> some View {
        mask {
            Rectangle()
                .padding(.top, WM.safeTop)
                .padding(.leading, min(16, WM.leadingInset))
                .padding(.trailing, min(16, WM.trailingInset))
                .ignoresSafeArea(edges: .vertical)
        }
    }
}

/// The web page-header subtitle (#1299): small uppercase ink text after a vertical divider, beside the title. Never
/// pink. `divider: false` is the phone Settings section name, which stands in for the title and has no divider.
struct WMHeaderDetail: View {
    let text: String
    var size: CGFloat = 9.92
    var gap: CGFloat = 16
    var divider = true

    var body: some View {
        Text(text.uppercased())
            .font(WM.font(size, 680))
            .tracking(size * 0.045)
            .foregroundStyle(WM.ink)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.leading, divider ? gap : 0)
            .frame(height: size * 1.5)
            .overlay(alignment: .leading) {
                // Web: 1 px rule in the ink at 28% opacity, as tall as the detail line (about 1.5 x the font size).
                if divider { Rectangle().fill(WM.ink.opacity(0.28)).frame(width: 1, height: size * 1.5) }
            }
    }
}

/// Title with the web's header detail beside it after the divider; when it does not fit in `maxWidth` the detail wraps
/// under the title behind a top rule as wide as the wider of the two (web `is-detail-wrapped`).
struct WMTitleWithDetail<Title: View>: View {
    let detail: String?
    let maxWidth: CGFloat
    var size: CGFloat = 9.92
    var gap: CGFloat = 16
    @ViewBuilder let title: () -> Title

    var body: some View {
        if let detail, !detail.isEmpty {
            ViewThatFits(in: .horizontal) {
                // Web: the header gap (15 pt at 1024) between the title and the rule, then 14 pt before the text.
                HStack(spacing: gap) {
                    title()
                    WMHeaderDetail(text: detail, size: size, gap: 14 * min(1, size / 9.92))
                }
                .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 5.6) {
                    title()
                    Text(detail.uppercased())
                        .font(WM.font(size, 680))
                        .tracking(size * 0.045)
                        .foregroundStyle(WM.ink)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.top, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .top) { Rectangle().fill(PlayarrStyle.lineStrong).frame(height: 1) }
                }
                .fixedSize(horizontal: true, vertical: false)
            }
            .frame(maxWidth: maxWidth, alignment: .leading)
        } else {
            title()
        }
    }
}

extension View {
    /// The web's scroll-edge fade (`page-layout.css`): on the end side the content dims to 30% over 64 pt along a smoothstep
    /// ramp (alpha 1, .891, .65, .409, .3 at 0, 25, 50, 75 and 100% of the ramp); the start side is clear.
    func webEdgeFade(_ axis: Axis, size: CGFloat = 64, enabled: Bool = true) -> some View {
        mask {
            GeometryReader { proxy in
                if enabled {
                    let length = axis == .horizontal ? proxy.size.width : proxy.size.height
                    let f = min(0.5, size / max(1, length))
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 1 - f),
                            .init(color: .black.opacity(0.891), location: 1 - f * 0.75),
                            .init(color: .black.opacity(0.65), location: 1 - f * 0.5),
                            .init(color: .black.opacity(0.409), location: 1 - f * 0.25),
                            .init(color: .black.opacity(0.3), location: 1),
                        ],
                        startPoint: axis == .horizontal ? .leading : .top,
                        endPoint: axis == .horizontal ? .trailing : .bottom
                    )
                } else {
                    Color.black
                }
            }
        }
    }
}
