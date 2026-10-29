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
        /// Belongs to a covering layer's own content (a drawer), so that layer does not hide it.
        var inCover = false
    }

    private var items: [UUID: Item] = [:]
    private var textRuns: [UUID: [Item]] = [:]
    private var order: [UUID] = []
    private var pending: Task<Void, Never>?
    /// Views currently on screen: a text run reported after its view left (queued draw callback) is dropped.
    private var alive: Set<UUID> = []

    /// Identifier of the container that holds a covering layer's own content (see `parityCoverLayer`).
    nonisolated static let coverIdentifier = "parity-cover-layer"
    /// Measured frames of the opaque layers currently drawn over content (see `parityCoverLayer`).
    var coverRegions: [UUID: CGRect] = [:]

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

    func setCover(_ id: UUID, _ frame: CGRect?) {
        guard coverRegions[id] != frame else { return }
        coverRegions[id] = frame
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
        func visit(_ object: NSObject, depth: Int, inCover: Bool = false) {
            let inCover = inCover || (object as? UIAccessibilityIdentification)?.accessibilityIdentifier == ParityLayoutRegistry.coverIdentifier
            guard visited < 4000, depth < 40 else { return }
            if let view = object as? UIView, view.isHidden || view.alpha <= 0 { return }
            // Parity-only probes (readiness flags) are not content.
            if (object as? UIAccessibilityIdentification)?.accessibilityIdentifier?.hasPrefix("parity.") == true { return }
            visited += 1
            if object.isAccessibilityElement {
                let traits = object.accessibilityTraits
                var role = "container"
                if traits.contains(.searchField) { role = "textbox" }
                else if traits.contains(.link) { role = "link" }
                else if traits.contains(.button) { role = "button" }
                else if traits.contains(.header) { role = "heading" }
                else if traits.contains(.image) { role = "image" }
                else if traits.contains(.staticText) { role = "text" }
                else if traits.contains(.tabBar) { role = "tab" }
                let frame = object.accessibilityFrame
                // A text field's content is its accessibility value; every other entry is named by its label.
                let label = (role == "textbox" ? object.accessibilityValue : nil) ?? object.accessibilityLabel ?? ""
                found.append(Item(text: label.isEmpty ? nil : label, role: role, size: nil, weight: nil, color: nil, rect: frame, inCover: inCover))
                return
            }
            let count = object.accessibilityElementCount()
            if count != NSNotFound, count > 0 {
                for index in 0..<count { if let child = object.accessibilityElement(at: index) as? NSObject { visit(child, depth: depth + 1, inCover: inCover) } }
                return
            }
            if let elements = object.accessibilityElements as? [NSObject], !elements.isEmpty {
                for child in elements { visit(child, depth: depth + 1, inCover: inCover) }
            }
            if let view = object as? UIView { for sub in view.subviews { visit(sub, depth: depth + 1, inCover: inCover) } }
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
            if styled.contains(where: { $0.text == entry.text && $0.role == entry.role && abs($0.rect.minX - entry.rect.minX) < 3 && abs($0.rect.minY - entry.rect.minY) < 12 }) { return false }
            guard entry.role == "text" || entry.role == "heading", let label = entry.text else { return true }
            let area = entry.rect.insetBy(dx: -3, dy: -3)
            // Dropped only when the styled lines inside its frame draw the whole label, line by line.
            let lines = styled.filter { $0.size != nil && $0.text != nil && area.contains($0.rect) }
                .sorted { ($0.rect.minY, $0.rect.minX) < ($1.rect.minY, $1.rect.minX) }
            func words(_ text: String) -> [Substring] { text.split(whereSeparator: \.isWhitespace) }
            let drawn = lines.flatMap { words($0.text ?? "") }.joined(separator: " ")
            let wanted = words(label).joined(separator: " ")
            return !(drawn == wanted || drawn.hasSuffix("\u{2026}") && wanted.hasPrefix(String(drawn.dropLast())))
        }
        // A native control takes the fill and radius of the painted box registered on its own frame (the control's own
        // paint); with no such box its background is not known and stays null. Containment is never used.
        let boxes = styled.filter { $0.painted && $0.text == nil && $0.size == nil }
        func sameFrame(_ a: CGRect, _ b: CGRect) -> Bool {
            abs(a.minX - b.minX) < 1.5 && abs(a.minY - b.minY) < 1.5 && abs(a.width - b.width) < 1.5 && abs(a.height - b.height) < 1.5
        }
        var ownBoxes: [Item] = []
        let backed = plain.map { entry -> Item in
            var entry = entry
            if let own = boxes.first(where: { sameFrame($0.rect, entry.rect) }) {
                entry.background = own.background; entry.radius = own.radius; entry.opacity = own.opacity
                ownBoxes.append(own)
            }
            return entry
        }
        let remaining = styled.filter { item in !ownBoxes.contains { $0 == item } }
        // Content under an opaque layer drawn over it is not visible: the visible part of its frame lies inside a measured
        // cover (the covering layer's own content is exempt).
        let window = CGRect(origin: .zero, size: screen.size)
        let covers = Array(coverRegions.values)
        func hidden(_ item: Item) -> Bool {
            if item.inCover { return false }
            let visible = item.rect.intersection(window)
            return !visible.isNull && covers.contains { $0.contains(visible) }
        }
        let visibleStyled = remaining.filter { !hidden($0) }
        let uncovered = backed.filter { !hidden($0) }
        var all = (visibleStyled + uncovered).filter { $0.text != nil || $0.size == nil }
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
        if t < 0 || t > 1 { return 0 } // outside the masked frame nothing is drawn
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
struct ParityScale: Equatable {
    var centre: CGPoint
    var factor: Double
}

struct ParityPaint: Equatable {
    var opacity = 1.0
    var clips: [CGRect] = []
    var fades: [ParityFade] = []
    var scales: [ParityScale] = []

    /// `rect` as it is drawn: scaled about the centre of each scaled ancestor, innermost first.
    func drawn(_ rect: CGRect) -> CGRect {
        scales.reversed().reduce(rect) { r, s in
            let f = CGFloat(s.factor)
            return CGRect(x: s.centre.x + (r.minX - s.centre.x) * f, y: s.centre.y + (r.minY - s.centre.y) * f, width: r.width * f, height: r.height * f)
        }
    }

    /// Product of the ancestors' scale factors (font sizes follow it).
    var scale: Double { scales.reduce(1) { $0 * $1.factor } }

    /// Effective opacity at `rect`, or nil when an ancestor clip removes it entirely.
    func effective(_ rect: CGRect) -> Double? {
        var visible = rect.intersection(CGRect(origin: .zero, size: UIScreen.main.bounds.size))
        if visible.isNull || visible.width <= 0 || visible.height <= 0 { return nil }
        for clip in clips {
            visible = visible.intersection(clip)
            if visible.isNull || visible.width <= 0 || visible.height <= 0 { return nil }
        }
        // The mask alpha is sampled in the visible part, not at the centre of an area that is clipped away.
        let centre = CGPoint(x: visible.midX, y: visible.midY)
        let alpha = fades.reduce(opacity) { $0 * $1.alpha(at: centre) }
        return alpha <= 0 ? nil : alpha
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
    var scale = 1.0
    @Environment(\.self) private var environment
    @State private var frame = CGRect.zero

    func body(content: Content) -> some View {
        var paint = environment.parityPaint
        paint.opacity *= opacity
        if scale != 1, frame.width > 0 { paint.scales.append(ParityScale(centre: CGPoint(x: frame.midX, y: frame.midY), factor: scale)) }
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

    /// `top` (r, g, b, alpha) painted over this colour.
    func under(_ top: SIMD4<Float>) -> ParityRGB {
        ParityRGB(r: top.x * top.w + r * (1 - top.w), g: top.y * top.w + g * (1 - top.w), b: top.z * top.w + b * (1 - top.w))
    }

    init(r: Float, g: Float, b: Float) { self.r = r; self.g = g; self.b = b }
    init(_ resolved: Color.Resolved) { r = resolved.red; g = resolved.green; b = resolved.blue }
}

/// The fills painted behind a view, outermost first: flat colours and linear gradients the app really draws.
struct ParityBackdrop: Equatable {
    enum Layer: Equatable {
        case flat(SIMD4<Float>)
        /// Linear gradient over `rect`; stops are (r, g, b, alpha) at `locations`.
        case gradient(rect: CGRect, start: CGPoint, end: CGPoint, stops: [SIMD4<Float>], locations: [Float])
        /// Radial gradient centred at the unit point `center` of `rect`, from radius 0 to `radius` points.
        case radial(rect: CGRect, center: CGPoint, radius: Float, stops: [SIMD4<Float>], locations: [Float])
    }
    var layers: [Layer] = []

    func adding(_ color: Color, _ environment: EnvironmentValues) -> ParityBackdrop {
        let c = color.resolve(in: environment)
        var copy = self
        copy.layers.append(.flat(SIMD4(c.red, c.green, c.blue, c.opacity)))
        return copy
    }

    /// The composited colour at `point` (window coordinates); the theme surface where nothing is painted.
    func rgb(at point: CGPoint, _ environment: EnvironmentValues) -> ParityRGB {
        var result = ParityRGB(PlayarrStyle.surface.resolve(in: environment))
        for layer in layers {
            switch layer {
            case .flat(let colour): result = result.under(colour)
            case .gradient(let rect, let start, let end, let stops, let locations):
                guard rect.width > 0, rect.height > 0, stops.count > 1, stops.count == locations.count else { continue }
                let a = CGPoint(x: rect.minX + start.x * rect.width, y: rect.minY + start.y * rect.height)
                let d = CGPoint(x: (end.x - start.x) * rect.width, y: (end.y - start.y) * rect.height)
                let length = d.x * d.x + d.y * d.y
                guard length > 0 else { continue }
                let t = Float(max(0, min(1, ((point.x - a.x) * d.x + (point.y - a.y) * d.y) / length)))
                var index = 1
                while index < stops.count - 1, t > locations[index] { index += 1 }
                let l0 = locations[index - 1], l1 = locations[index]
                let f = l1 > l0 ? max(0, min(1, (t - l0) / (l1 - l0))) : 1
                result = result.under(stops[index - 1] + (stops[index] - stops[index - 1]) * f)
            case .radial(let rect, let center, let radius, let stops, let locations):
                guard rect.width > 0, radius > 0, stops.count > 1, stops.count == locations.count else { continue }
                let c = CGPoint(x: rect.minX + center.x * rect.width, y: rect.minY + center.y * rect.height)
                let t = min(1, Float(hypot(point.x - c.x, point.y - c.y)) / radius)
                var index = 1
                while index < stops.count - 1, t > locations[index] { index += 1 }
                let l0 = locations[index - 1], l1 = locations[index]
                let f = l1 > l0 ? max(0, min(1, (t - l0) / (l1 - l0))) : 1
                result = result.under(stops[index - 1] + (stops[index] - stops[index - 1]) * f)
            }
        }
        return result
    }
}

private struct ParityBackdropKey: EnvironmentKey { static let defaultValue = ParityBackdrop() }
private struct ParityInCoverKey: EnvironmentKey { static let defaultValue = false }
extension EnvironmentValues {
    /// The composited colour behind this view, set by `parityFill` where a view really paints a background.
    var parityBackdrop: ParityBackdrop {
        get { self[ParityBackdropKey.self] }
        set { self[ParityBackdropKey.self] = newValue }
    }
    /// True inside a covering layer (a drawer): its content is above the covered content.
    var parityInCover: Bool {
        get { self[ParityInCoverKey.self] }
        set { self[ParityInCoverKey.self] = newValue }
    }
}

private struct ParityFillModifier: ViewModifier {
    let color: Color
    var enabled = true
    @Environment(\.self) private var environment
    func body(content: Content) -> some View {
        content.environment(\.parityBackdrop, enabled ? environment.parityBackdrop.adding(color, environment) : environment.parityBackdrop)
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
    let enabled: Bool
    @Environment(\.self) private var environment
    @State private var id = UUID()
    @State private var frame = CGRect.zero

    private var hex: String? { color.map { Self.hex($0, environment) } }

    static func hex(_ color: Color, _ environment: EnvironmentValues) -> String {
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    func body(content: Content) -> some View {
        content
            .environment(\.parityBackdrop, box.map { environment.parityBackdrop.adding($0, environment) } ?? environment.parityBackdrop)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { frame = proxy.frame(in: .global); report(frame) }
                        .onChange(of: proxy.frame(in: .global)) { _, new in frame = new; report(new) }
                }
            )
            .onChange(of: environment.parityPaint) { _, _ in report(frame) }
            .onChange(of: environment.parityBackdrop) { _, _ in report(frame) }
            .onChange(of: environment.colorScheme) { _, _ in report(frame) }
            .onChange(of: enabled) { _, _ in report(frame) }
            .onChange(of: text) { _, _ in report(frame) }
            .onChange(of: box) { _, _ in report(frame) }
            .onChange(of: color) { _, _ in report(frame) }
            .onChange(of: role) { _, _ in report(frame) }
            .onDisappear { ParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ frame: CGRect) {
        let paint = environment.parityPaint
        let drawn = paint.drawn(frame)
        guard enabled, frame.width > 0, let opacity = paint.effective(drawn) else { ParityLayoutRegistry.shared.remove(id); return }
        ParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size.map { $0 * CGFloat(paint.scale) }, weight: weight, color: hex, rect: drawn, tracking: tracking, background: (box.map { environment.parityBackdrop.adding($0, environment) } ?? environment.parityBackdrop).rgb(at: CGPoint(x: drawn.midX, y: drawn.midY), environment).hex, radius: radius * CGFloat(paint.scale), opacity: opacity, painted: box != nil, inCover: environment.parityInCover))
    }
}

/// `#rrggbb` (or `#rrggbbaa`) of `color` as resolved in `environment`.
func parityHex(_ color: Color, _ environment: EnvironmentValues) -> String { ParityLayoutModifier.hex(color, environment) }

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
            ParityRenderedLine(rect: line.typographicBounds.rect, indices: line.flatMap { $0.characterIndices.compactMap(parityOffset) })
        })
    }
}

/// `Text.Layout.CharacterIndex` as a plain offset into the text's characters.
func parityOffset(_ index: Any) -> Int? {
    if let plain = index as? Int { return plain }
    return Mirror(reflecting: index).children.lazy.compactMap { $0.value as? Int }.first
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
    @Environment(\.self) private var environment
    @State private var id = UUID()
    @State private var frame = CGRect.zero
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
            .onChange(of: environment.colorScheme) { _, _ in publish() }
            .onChange(of: text) { _, _ in publish() }
            .onChange(of: color) { _, _ in publish() }
            .onChange(of: weight) { _, _ in publish() }
            .onChange(of: lines) { _, _ in publish() }
            .onChange(of: environment.parityBackdrop) { _, _ in publish() }
            .onChange(of: frame) { _, _ in publish() }
            .onChange(of: environment.parityPaint) { _, _ in publish() }
            .onDisappear { ParityLayoutRegistry.shared.remove(id) }
    }

    /// Turns the measured lines into registry items (displayed string, drawn size, effective opacity).
    private func publish() {
        guard frame.width > 0, frame.height > 0, !lines.isEmpty else { return }
        let strings = parityDisplayedLines(text, lines)
        let colour = ParityLayoutModifier.hex(color, environment)
        let paint = environment.parityPaint
        let runs = lines.enumerated().compactMap { index, line -> ParityLayoutRegistry.Item? in
            // The line rectangle is in the text view's space; ancestors' scale transforms are applied to it.
            let rect = paint.drawn(line.rect.offsetBy(dx: frame.minX, dy: frame.minY))
            let background = environment.parityBackdrop.rgb(at: CGPoint(x: rect.midX, y: rect.midY), environment).hex
            guard let opacity = paint.effective(rect) else { return nil }
            // A line whose characters cannot be read back from the layout is not exported with the whole source string.
            guard strings.count == lines.count, !strings[index].isEmpty else { return nil }
            return ParityLayoutRegistry.Item(text: strings[index], role: role,
                                              size: (size * CGFloat(paint.scale) * 100).rounded() / 100, weight: weight, color: colour, rect: rect,
                                              background: background, opacity: opacity, inCover: environment.parityInCover)
        }
        Task { @MainActor in ParityLayoutRegistry.shared.setTextRuns(id, runs) }
    }
}
/// Records a linear gradient this view really paints, so text and controls over it report the colour at their own position.
private struct ParityGradientModifier: ViewModifier {
    let gradient: Gradient
    let start: UnitPoint
    let end: UnitPoint
    var radius: CGFloat?
    /// Where the drawn gradient lies in this view's own space, when it is not the whole view.
    var local: CGRect?
    @Environment(\.self) private var environment
    @State private var frame = CGRect.zero

    func body(content: Content) -> some View {
        let placed = local.map { CGRect(x: frame.minX + $0.minX, y: frame.minY + $0.minY, width: $0.width, height: $0.height) } ?? frame
        var backdrop = environment.parityBackdrop
        let resolved = gradient.stops.map { $0.color.resolve(in: environment) }
        let colours = resolved.map { SIMD4($0.red, $0.green, $0.blue, $0.opacity) }, locations = gradient.stops.map { Float($0.location) }
        if let radius {
            backdrop.layers.append(.radial(rect: placed, center: CGPoint(x: start.x, y: start.y), radius: Float(radius), stops: colours, locations: locations))
        } else {
            backdrop.layers.append(.gradient(rect: placed, start: CGPoint(x: start.x, y: start.y), end: CGPoint(x: end.x, y: end.y), stops: colours, locations: locations))
        }
        return content
            .environment(\.parityBackdrop, backdrop)
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { frame = proxy.frame(in: .global) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in frame = value }
            })
    }
}

/// A covering layer (a drawer): its measured frame hides what lies under it, and its own content is exempt.
private struct ParityCoverLayer: ViewModifier {
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .environment(\.parityInCover, true)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(ParityLayoutRegistry.coverIdentifier)
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { ParityLayoutRegistry.shared.setCover(id, proxy.frame(in: .global)) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in ParityLayoutRegistry.shared.setCover(id, value) }
            })
            .onDisappear { ParityLayoutRegistry.shared.setCover(id, nil) }
    }
}

#endif

extension View {
    @ViewBuilder
    func parityRenderedText(_ text: String, role: String, size: CGFloat, weight: Int, color: Color) -> some View {
        #if DEBUG
        if #available(iOS 18.0, *) {
            modifier(ParityRenderedTextModifier(text: text, role: role, size: size, weight: weight, color: color))
        } else {
            self
        }
        #else
        self
        #endif
    }

    /// Reports this view's text, style and frame to the parity layout export (debug builds only).
    @ViewBuilder
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil, tracking: CGFloat = 0, box: Color? = nil, radius: CGFloat = 0, enabled: Bool = true) -> some View {
        #if DEBUG
        modifier(ParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color, tracking: tracking, box: box, radius: radius, enabled: enabled))
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
    func parityBox(_ role: String, name: String? = nil, background: Color? = nil, radius: CGFloat = 0, enabled: Bool = true) -> some View {
        parityLayout(text: name, role: role, box: background, radius: radius, enabled: enabled)
    }
}

extension View {
    /// Marks a linear gradient painted over this view's frame (the same stops and points as the drawn `LinearGradient`).
    func parityGradient(_ stops: [Gradient.Stop], from start: UnitPoint, to end: UnitPoint) -> some View {
        #if DEBUG
        modifier(ParityGradientModifier(gradient: Gradient(stops: stops), start: start, end: end))
        #else
        self
        #endif
    }
}

extension View {
    /// Marks an opaque layer drawn over other content (a drawer): its measured frame hides what it covers.
    func parityCoverLayer() -> some View {
        #if DEBUG
        modifier(ParityCoverLayer())
        #else
        self
        #endif
    }

    /// Marks the place where a view really paints `color`: text and controls inside report the composited colour behind them.
    func parityFill(_ color: Color, when condition: Bool = true) -> some View {
        #if DEBUG
        modifier(ParityFillModifier(color: color, enabled: condition))
        #else
        self
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

    /// `scaleEffect`, also recorded: exports inside carry the transform (rects scale about this view's centre, sizes follow).
    func parityScale(_ factor: Double) -> some View {
        #if DEBUG
        scaleEffect(factor).modifier(ParityPaintModifier(scale: factor))
        #else
        scaleEffect(factor)
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
