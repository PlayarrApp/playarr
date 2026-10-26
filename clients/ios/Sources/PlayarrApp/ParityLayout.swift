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
        // A plain accessibility entry is dropped when a styled one has the same text and nearly the same frame.
        let plain = accessibilityElements().filter { entry in
            !styled.contains { $0.text == entry.text && abs($0.rect.minX - entry.rect.minX) < 3 && abs($0.rect.minY - entry.rect.minY) < 12 }
        }
        // Only registered views and native accessibility elements exist in the export. A style on a parent with no
        // source string cannot identify a child text run, so keep the child's accessibility entry without guessed style.
        var all = styled.filter { $0.text != nil || $0.size == nil } + plain
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
                    let frame = proxy.frame(in: .global)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                }
            )
            .onDisappear { ParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ frame: CGRect) {
        guard !environment.parityCovered else { ParityLayoutRegistry.shared.remove(id); return }
        ParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size, weight: weight, color: hex, rect: frame, tracking: tracking, background: box.map { ParityRGB.over($0, environment.parityBackdrop, environment).hex } ?? pageHex, radius: radius))
    }
}

/// Observe the exact layout handed to SwiftUI's drawing context. Drawing is unchanged; no font metrics or line
/// positions from another renderer are substituted. WMText contains one style and one laid-out line.
@available(iOS 18.0, *)
struct ParityTextRenderer: TextRenderer {
    let report: ([CGRect]) -> Void

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout { context.draw(line) }
        report(layout.map { $0.typographicBounds.rect })
    }
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

    func body(content: Content) -> some View {
        let colour = ParityLayoutModifier.hex(color, environment)
        let background = (environment.parityBackdrop ?? ParityRGB(PlayarrStyle.surface.resolve(in: environment))).hex
        let covered = environment.parityCovered
        content
            .textRenderer(ParityTextRenderer { bounds in
                guard frame.width > 0, frame.height > 0, !covered else { return }
                let runs = bounds.map { rect in
                    ParityLayoutRegistry.Item(text: text, role: role, size: size, weight: weight, color: colour,
                                              rect: rect.offsetBy(dx: frame.minX, dy: frame.minY), background: background)
                }
                Task { @MainActor in ParityLayoutRegistry.shared.setTextRuns(id, runs) }
            })
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { ParityLayoutRegistry.shared.markAlive(id); frame = proxy.frame(in: .global) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in frame = value }
            })
            .onChange(of: covered, initial: true) { _, isCovered in
                // A panel opened over this text: it is no longer visible, so its runs leave the export.
                if isCovered { ParityLayoutRegistry.shared.remove(id) } else { ParityLayoutRegistry.shared.markAlive(id) }
            }
            .onDisappear { ParityLayoutRegistry.shared.remove(id) }
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
    func wm(_ size: CGFloat, _ weight: Int = 400, color: Color = PlayarrStyle.ink) -> some View {
        font(DesignFont.font(size, weight))
            .parityLayout(role: "text", size: size, weight: weight, color: color)
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
