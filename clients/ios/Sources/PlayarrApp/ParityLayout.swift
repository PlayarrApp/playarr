import SwiftUI
import UIKit

/// Parity layout export (docs/parity/LAYOUT.md). Views that opt in with `.parityLayout(...)` report their own style
/// values (text, size, weight, colour) and their frame in the app window; the registry writes them to
/// Documents/parity-layout.json, which the simulator driver copies next to the screenshot. Compiled out of Release.
#if DEBUG
@MainActor
final class ParityLayoutRegistry {
    static let shared = ParityLayoutRegistry()

    struct Item: Equatable {
        var text: String?
        var role: String
        var size: CGFloat?
        var weight: Int?
        var color: String?
        var rect: CGRect = .zero
        var tracking: CGFloat = 0
        var background: String?
        var radius: CGFloat = 0
        /// Product of the ancestors' opacity and mask alpha at this element (docs/parity/LAYOUT.md `opacity`).
        var opacity: Double = 1
        /// True when the view paints its own fill (so its `background` includes that fill).
        var painted = false
    }

    private var items: [UUID: Item] = [:]
    private var textRuns: [UUID: [Item]] = [:]
    private var order: [UUID] = []
    private var pending: Task<Void, Never>?
    /// Views currently on screen: a text run reported after its view left (queued draw callback) is dropped.
    private var alive: Set<UUID> = []

    func markAlive(_ id: UUID) { alive.insert(id) }

    /// SwiftUI builds its accessibility tree only while an assistive client is attached; this switches that on in the
    /// debug build so the walk below sees buttons, links and images (the call UI test runners use).
    private static let enableAccessibility: Void = {
        guard let handle = dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
              let symbol = dlsym(handle, "_AXSApplicationAccessibilitySetEnabled") else { return }
        typealias Setter = @convention(c) (Bool) -> Void
        unsafeBitCast(symbol, to: Setter.self)(true)
    }()

    func set(_ id: UUID, _ item: Item) {
        _ = Self.enableAccessibility
        guard items[id] != item else { return }
        if items[id] == nil { order.append(id) }
        items[id] = item
        schedule()
    }

    func setTextRuns(_ id: UUID, _ runs: [Item]) {
        _ = Self.enableAccessibility
        guard alive.contains(id), textRuns[id] != runs else { return }
        if textRuns[id] == nil { order.append(id) }
        textRuns[id] = runs
        schedule()
    }

    func remove(_ id: UUID) {
        alive.remove(id)
        guard items[id] != nil || textRuns[id] != nil else { return }
        items[id] = nil
        textRuns[id] = nil
        order.removeAll { $0 == id }
        schedule()
    }

    private func schedule() {
        guard ParityLaunch.isActive else { return }
        pending?.cancel()
        pending = Task { @MainActor [weak self] in
            // Export only when the view is idle: two snapshots 0.6 s apart must be identical.
            try? await Task.sleep(nanoseconds: 400_000_000)
            var previous: Data?
            for _ in 0..<40 {
                guard !Task.isCancelled, let self else { return }
                let current = self.snapshot()
                if current == previous { self.write(current); return }
                previous = current
                try? await Task.sleep(nanoseconds: 600_000_000)
            }
        }
    }

    /// Accessibility elements of the key window (buttons, links, headings, images, static text): frames, names and traits
    /// for everything the views did not report themselves. Styled text from `.parityLayout` replaces the plain entry.
    private func accessibilityElements() -> [Item] {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return [] }
        var found: [Item] = []
        var visited = 0
        func visit(_ object: NSObject, depth: Int) {
            guard visited < 4000, depth < 40 else { return }
            if let view = object as? UIView, view.isHidden || view.alpha <= 0.001 { return }
            visited += 1
            if object.isAccessibilityElement {
                let traits = object.accessibilityTraits
                var role = "container"
                if traits.contains(.link) { role = "link" }
                else if traits.contains(.button) { role = "button" }
                else if traits.contains(.header) { role = "heading" }
                else if traits.contains(.image) { role = "image" }
                else if traits.contains(.staticText) { role = "text" }
                else if traits.contains(.tabBar) { role = "tab" }
                let frame = object.accessibilityFrame
                let label = object.accessibilityLabel ?? ""
                found.append(Item(text: label.isEmpty ? nil : label, role: role, size: nil, weight: nil, color: nil, rect: frame))
                return
            }
            let count = object.accessibilityElementCount()
            if count != NSNotFound, count > 0 {
                for index in 0..<count { if let child = object.accessibilityElement(at: index) as? NSObject { visit(child, depth: depth + 1) } }
                return
            }
            if let elements = object.accessibilityElements as? [NSObject], !elements.isEmpty {
                for child in elements { visit(child, depth: depth + 1) }
            }
            if let view = object as? UIView { for sub in view.subviews { visit(sub, depth: depth + 1) } }
        }
        visit(window, depth: 0)
        return found
    }

    private func snapshot() -> Data? {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return nil }
        let screen = window.bounds
        let styled = order.flatMap { id -> [Item] in
            if let runs = textRuns[id] { return runs }
            return items[id].map { [$0] } ?? []
        }
        // A plain accessibility entry is dropped when a styled one has the same text and nearly the same frame, and a
        // text entry is dropped when styled lines inside its frame draw its label (its lines are the export, not its box).
        let plain = accessibilityElements().filter { entry in
            if styled.contains(where: { $0.text == entry.text && abs($0.rect.minX - entry.rect.minX) < 3 && abs($0.rect.minY - entry.rect.minY) < 12 }) { return false }
            guard entry.role == "text" || entry.role == "heading", let label = entry.text else { return true }
            let area = entry.rect.insetBy(dx: -3, dy: -3)
            return !styled.contains { line in
                guard let shown = line.text, line.size != nil, area.contains(line.rect) else { return false }
                return label.contains(shown.hasSuffix("\u{2026}") ? String(shown.dropLast()) : shown)
            }
        }
        // Only registered views and native accessibility elements exist in the export. A style on a parent with no
        // source string cannot identify a child text run, so keep the child's accessibility entry without guessed style.
        // A native control with no own fill sits on the innermost painted container that encloses it: that container's
        // composited colour (registered by the app's own fills) is the colour behind it.
        let painted = styled.filter { $0.painted }
        let backed = plain.map { entry -> Item in
            var entry = entry
            let room = entry.rect.insetBy(dx: -1, dy: -1)
            entry.background = painted.filter { $0.rect.contains(room) && $0.rect != entry.rect }
                .min { $0.rect.width * $0.rect.height < $1.rect.width * $1.rect.height }?.background
            return entry
        }
        var all = styled.filter { $0.text != nil || $0.size == nil } + backed
        let viewport = CGRect(origin: .zero, size: screen.size)
        all = all.filter { $0.rect.intersects(viewport) && $0.rect.width > 1 && $0.rect.height > 1 }
        all.sort { ($0.rect.minY, $0.rect.minX, $0.text ?? "", $0.role) < ($1.rect.minY, $1.rect.minX, $1.text ?? "", $1.role) }
        let elements: [[String: Any]] = all.compactMap { item in
            guard item.rect.width > 0, item.rect.height > 0 else { return nil }
            var element: [String: Any] = [
                "text": item.text ?? "",
                "role": item.role,
                "rect": ["x": q(item.rect.minX), "y": q(item.rect.minY), "w": q(item.rect.width), "h": q(item.rect.height)],
                "color": item.color as Any? ?? NSNull(),
                "background": item.background as Any? ?? NSNull(),
                "fontSize": item.size.map { q($0) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
            ]
            if item.color == nil { element["color"] = NSNull() }
            if item.radius > 0 { element["radius"] = q(item.radius) }
            if item.opacity < 0.995 { element["opacity"] = q(CGFloat(item.opacity)) }
            return element
        }
        let document: [String: Any] = [
            "viewport": ["w": Double(screen.width), "h": Double(screen.height), "dpr": Double(window.screen.scale)],
            "clockPinned": ParityLaunch.frozenNow != nil,
            "elements": elements,
        ]
        return try? JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
    }

    /// Layout floats to 0.01 px: removes sub-0.0001 noise between identical runs, far below the 1 px tolerance.
    private func q(_ value: CGFloat) -> Double { (Double(value) * 100).rounded() / 100 }

    private func write(_ data: Data?) {
        guard let data else { return }
        let url = ParityLaunch.acceptanceStateURL.deletingLastPathComponent().appendingPathComponent("parity-layout.json")
        try? data.write(to: url, options: .atomic)
    }
}

/// One scroll-edge mask: alpha stops (location, alpha) along an axis of the masked view's frame.
struct ParityFade: Equatable {
    var rect: CGRect
    var horizontal: Bool
    var stops: [SIMD2<Double>]

    func alpha(at point: CGPoint) -> Double {
        let length = horizontal ? rect.width : rect.height
        guard length > 0, let first = stops.first, let last = stops.last else { return 1 }
        let t = Double(((horizontal ? point.x - rect.minX : point.y - rect.minY) / length))
        if t <= first.x { return first.y }
        if t >= last.x { return last.y }
        for index in 1..<stops.count where t <= stops[index].x {
            let a = stops[index - 1], b = stops[index]
            return b.x > a.x ? a.y + (b.y - a.y) * (t - a.x) / (b.x - a.x) : b.y
        }
        return last.y
    }
}

/// What ancestors do to a view's pixels besides painting a fill: opacity, clip bounds and edge masks.
struct ParityPaint: Equatable {
    var opacity = 1.0
    var clips: [CGRect] = []
    var fades: [ParityFade] = []

    /// Effective opacity at `rect`, or nil when an ancestor clip removes it entirely.
    func effective(_ rect: CGRect) -> Double? {
        for clip in clips {
            let inside = clip.intersection(rect)
            if inside.isNull || inside.width < 1 || inside.height < 1 { return nil }
        }
        let centre = CGPoint(x: rect.midX, y: rect.midY)
        return fades.reduce(opacity) { $0 * $1.alpha(at: centre) }
    }
}

private struct ParityPaintKey: EnvironmentKey { static let defaultValue = ParityPaint() }
extension EnvironmentValues {
    var parityPaint: ParityPaint {
        get { self[ParityPaintKey.self] }
        set { self[ParityPaintKey.self] = newValue }
    }
}

/// Records opacity, a clip to this view's frame and/or an edge mask for the exports of everything inside.
private struct ParityPaintModifier: ViewModifier {
    var opacity = 1.0
    var clip = false
    var fade: ((CGSize) -> [Gradient.Stop])?
    var horizontal = false
    @Environment(\.self) private var environment
    @State private var frame = CGRect.zero

    func body(content: Content) -> some View {
        var paint = environment.parityPaint
        paint.opacity *= opacity
        if frame.width > 0 {
            if clip { paint.clips.append(frame) }
            if let fade {
                let stops = fade(frame.size).map { SIMD2(Double($0.location), Double($0.color.resolve(in: environment).opacity)) }
                paint.fades.append(ParityFade(rect: frame, horizontal: horizontal, stops: stops))
            }
        }
        return content
            .environment(\.parityPaint, paint)
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { frame = proxy.frame(in: .global) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in frame = value }
            })
    }
}

/// A resolved opaque colour: what the pixels behind a view actually are once every painted fill above it is composited.
struct ParityRGB: Equatable {
    var r: Float, g: Float, b: Float

    var hex: String {
        func byte(_ v: Float) -> Int { max(0, min(255, Int((v * 255).rounded()))) }
        return String(format: "#%02x%02x%02x", byte(r), byte(g), byte(b))
    }

    /// `color` painted over `base` (the colour resolved in `environment`, opacity included).
    static func over(_ color: Color, _ base: ParityRGB?, _ environment: EnvironmentValues) -> ParityRGB {
        let top = color.resolve(in: environment), under = base ?? ParityRGB(PlayarrStyle.surface.resolve(in: environment))
        let a = Float(top.opacity)
        return ParityRGB(r: top.red * a + under.r * (1 - a), g: top.green * a + under.g * (1 - a), b: top.blue * a + under.b * (1 - a))
    }

    init(r: Float, g: Float, b: Float) { self.r = r; self.g = g; self.b = b }
    init(_ resolved: Color.Resolved) { r = resolved.red; g = resolved.green; b = resolved.blue }
}

private struct ParityBackdropKey: EnvironmentKey { static let defaultValue: ParityRGB? = nil }
private struct ParityHiddenKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// The composited colour behind this view, set by `parityFill` where a view really paints a background.
    var parityBackdrop: ParityRGB? {
        get { self[ParityBackdropKey.self] }
        set { self[ParityBackdropKey.self] = newValue }
    }
    /// True under content that another layer covers: it is not visible, so it is not exported.
    var parityCovered: Bool {
        get { self[ParityHiddenKey.self] }
        set { self[ParityHiddenKey.self] = newValue }
    }
}

private struct ParityFillModifier: ViewModifier {
    let color: Color
    @Environment(\.self) private var environment
    func body(content: Content) -> some View {
        content.environment(\.parityBackdrop, ParityRGB.over(color, environment.parityBackdrop, environment))
    }
}

private struct ParityLayoutModifier: ViewModifier {
    let text: String?
    let role: String
    let size: CGFloat?
    let weight: Int?
    let color: Color?
    let tracking: CGFloat
    let box: Color?
    let radius: CGFloat
    @Environment(\.self) private var environment
    @State private var id = UUID()
    @State private var frame = CGRect.zero

    private var hex: String? { color.map { Self.hex($0, environment) } }
    private var pageHex: String { (environment.parityBackdrop ?? ParityRGB(PlayarrStyle.surface.resolve(in: environment))).hex }

    static func hex(_ color: Color, _ environment: EnvironmentValues) -> String {
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    func body(content: Content) -> some View {
        content
            .environment(\.parityBackdrop, box.map { ParityRGB.over($0, environment.parityBackdrop, environment) } ?? environment.parityBackdrop)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { frame = proxy.frame(in: .global); report(frame) }
                        .onChange(of: proxy.frame(in: .global)) { _, new in frame = new; report(new) }
                }
            )
            .onChange(of: environment.parityPaint) { _, _ in report(frame) }
            .onChange(of: environment.parityBackdrop) { _, _ in report(frame) }
            .onDisappear { ParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ frame: CGRect) {
        guard frame.width > 0, !environment.parityCovered, let opacity = environment.parityPaint.effective(frame) else { ParityLayoutRegistry.shared.remove(id); return }
        ParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size, weight: weight, color: hex, rect: frame, tracking: tracking, background: box.map { ParityRGB.over($0, environment.parityBackdrop, environment).hex } ?? pageHex, radius: radius, opacity: opacity, painted: box != nil))
    }
}

/// One laid-out line of a text view: its glyph-run bounds and the source-text offsets of the characters it draws.
struct ParityRenderedLine: Equatable {
    var rect: CGRect
    var indices: [Int]
}

/// Observe the exact layout handed to SwiftUI's drawing context. Drawing is unchanged; no font metrics or line
/// positions from another renderer are substituted. One report entry per laid-out line.
@available(iOS 18.0, *)
struct ParityTextRenderer: TextRenderer {
    let report: ([ParityRenderedLine]) -> Void

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout { context.draw(line) }
        report(layout.map { line in
            ParityRenderedLine(rect: line.typographicBounds.rect, indices: line.flatMap { $0.characterIndices })
        })
    }
}

/// The string a line really shows: the characters it draws, plus the ellipsis when text was cut after it.
func parityDisplayedLines(_ text: String, _ lines: [ParityRenderedLine]) -> [String] {
    let characters = Array(text)
    let shown = lines.map { line -> String in
        guard let low = line.indices.min(), let high = line.indices.max(), low >= 0, high < characters.count else { return "" }
        return String(characters[low...high]).trimmingCharacters(in: .whitespaces)
    }
    guard shown.count == lines.count, !shown.isEmpty else { return [] }
    var result = shown
    let covered = lines.flatMap(\.indices).max() ?? -1
    let trailing = characters.suffix(from: min(characters.count, covered + 1)).contains { !$0.isWhitespace }
    if trailing, !result[result.count - 1].isEmpty { result[result.count - 1] += "\u{2026}" }
    return result
}

@available(iOS 18.0, *)
private struct ParityRenderedTextModifier: ViewModifier {
    let text: String
    let role: String
    let size: CGFloat
    let weight: Int
    let color: Color
    let scales: Bool
    @Environment(\.self) private var environment
    @State private var id = UUID()
    @State private var frame = CGRect.zero
    @State private var natural: CGFloat = 0
    @State private var lines: [ParityRenderedLine] = []

    func body(content: Content) -> some View {
        content
            .textRenderer(ParityTextRenderer { measured in
                Task { @MainActor in lines = measured }
            })
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { ParityLayoutRegistry.shared.markAlive(id); frame = proxy.frame(in: .global) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in frame = value }
            })
            .background {
                // The same text laid out without compression: its line height is the unscaled reference for the size drawn.
                if scales {
                    content.fixedSize().opacity(0).allowsHitTesting(false).accessibilityHidden(true)
                        .textRenderer(ParityTextRenderer { measured in
                            Task { @MainActor in natural = measured.first?.rect.height ?? 0 }
                        })
                }
            }
            .onChange(of: environment.parityCovered, initial: true) { _, isCovered in
                // A panel opened over this text: it is no longer visible, so its runs leave the export.
                if isCovered { ParityLayoutRegistry.shared.remove(id) } else { ParityLayoutRegistry.shared.markAlive(id); publish() }
            }
            .onChange(of: lines) { _, _ in publish() }
            .onChange(of: environment.parityBackdrop) { _, _ in publish() }
            .onChange(of: frame) { _, _ in publish() }
            .onChange(of: natural) { _, _ in publish() }
            .onChange(of: environment.parityPaint) { _, _ in publish() }
            .onDisappear { ParityLayoutRegistry.shared.remove(id) }
    }

    /// Turns the measured lines into registry items (displayed string, drawn size, effective opacity).
    private func publish() {
        guard frame.width > 0, frame.height > 0, !lines.isEmpty, !environment.parityCovered else { return }
        let strings = parityDisplayedLines(text, lines)
        let colour = ParityLayoutModifier.hex(color, environment)
        let background = (environment.parityBackdrop ?? ParityRGB(PlayarrStyle.surface.resolve(in: environment))).hex
        let paint = environment.parityPaint
        let runs = lines.enumerated().compactMap { index, line -> ParityLayoutRegistry.Item? in
            let rect = line.rect.offsetBy(dx: frame.minX, dy: frame.minY)
            guard let opacity = paint.effective(rect) else { return nil }
            let scale = scales && natural > 0 ? min(1, line.rect.height / natural) : 1
            return ParityLayoutRegistry.Item(text: strings.count == lines.count && !strings[index].isEmpty ? strings[index] : text, role: role,
                                              size: (size * scale * 100).rounded() / 100, weight: weight, color: colour, rect: rect,
                                              background: background, opacity: opacity)
        }
        Task { @MainActor in ParityLayoutRegistry.shared.setTextRuns(id, runs) }
    }
}
#endif

extension View {
    @ViewBuilder
    func parityRenderedText(_ text: String, role: String, size: CGFloat, weight: Int, color: Color, scales: Bool = false) -> some View {
        #if DEBUG
        if #available(iOS 18.0, *) {
            modifier(ParityRenderedTextModifier(text: text, role: role, size: size, weight: weight, color: color, scales: scales))
        } else {
            self
        }
        #else
        self
        #endif
    }

    /// Reports this view's text, style and frame to the parity layout export (debug builds only).
    @ViewBuilder
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil, tracking: CGFloat = 0, box: Color? = nil, radius: CGFloat = 0) -> some View {
        #if DEBUG
        modifier(ParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color, tracking: tracking, box: box, radius: radius))
        #else
        self
        #endif
    }
}

extension View {
    /// The design font at a CSS size and weight, reported to the parity layout export with the text it draws.
    /// With `text:` the lines are read from the text's own layout (one export element per laid-out line, the string shown).
    @ViewBuilder
    func wm(_ size: CGFloat, _ weight: Int = 400, color: Color = PlayarrStyle.ink, text: String? = nil) -> some View {
        if let text {
            font(DesignFont.font(size, weight)).parityRenderedText(text, role: "text", size: size, weight: weight, color: color)
        } else {
            font(DesignFont.font(size, weight)).parityLayout(role: "text", size: size, weight: weight, color: color)
        }
    }

    /// Reports a native control or a view that actually paints a background.
    func parityBox(_ role: String, name: String? = nil, background: Color? = nil, radius: CGFloat = 0) -> some View {
        parityLayout(text: name, role: role, box: background, radius: radius)
    }
}

extension View {
    /// Marks the place where a view really paints `color`: text and controls inside report the composited colour behind them.
    func parityFill(_ color: Color) -> some View {
        #if DEBUG
        modifier(ParityFillModifier(color: color))
        #else
        self
        #endif
    }

    /// Content that a drawer or panel covers: hidden from the layout export (and from accessibility).
    func parityCovered(_ covered: Bool) -> some View {
        #if DEBUG
        environment(\.parityCovered, covered).accessibilityHidden(covered)
        #else
        accessibilityHidden(covered)
        #endif
    }
}

extension View {
    /// `opacity`, also recorded so the exports of everything inside carry the product of their ancestors' opacity.
    func parityOpacity(_ value: Double) -> some View {
        #if DEBUG
        opacity(value).modifier(ParityPaintModifier(opacity: value))
        #else
        opacity(value)
        #endif
    }

    /// `clipped()`, also recorded: content outside this view's frame leaves the layout export.
    func parityClipped() -> some View {
        #if DEBUG
        clipped().modifier(ParityPaintModifier(clip: true))
        #else
        clipped()
        #endif
    }

    /// Records an edge-fade mask already applied to this view (alpha stops along `axis`), so inner exports carry its alpha.
    func parityFade(_ axis: Axis, _ stops: @escaping (CGSize) -> [Gradient.Stop]) -> some View {
        #if DEBUG
        modifier(ParityPaintModifier(fade: stops, horizontal: axis == .horizontal))
        #else
        self
        #endif
    }

    /// `background(_:in:)` for a plain colour: also records the fill, so text and controls inside report the composited colour.
    func background<S: Shape>(_ color: Color, in shape: S) -> some View {
        parityFill(color).background(AnyShapeStyle(color), in: shape)
    }

    /// `background(_:)` for a plain colour, recorded like `background(_:in:)`.
    func background(_ color: Color) -> some View {
        parityFill(color).background(AnyShapeStyle(color))
    }

    /// A native control or container that paints `color` in `shape`: exported with the real fill, and the fill
    /// is the backdrop of everything inside. `nil` paints nothing.
    func parityShape<S: Shape>(_ role: String, name: String? = nil, color: Color?, in shape: S, radius: CGFloat = 0) -> some View {
        parityBox(role, name: name, background: color, radius: radius).background(AnyShapeStyle(color ?? .clear), in: shape)
    }
}
