import SwiftUI
import UIKit

/// Parity layout export (docs/parity/LAYOUT.md). Views that opt in with `.parityLayout(...)` report their own style
/// values (text, size, weight, colour) and their frame in the app window; the registry writes them to
/// Documents/parity-layout.json, which the simulator driver copies next to the screenshot. Compiled out of Release.
#if DEBUG
@MainActor
final class ParityLayoutRegistry {
    static let shared = ParityLayoutRegistry()

    struct Item {
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
    private var order: [UUID] = []
    private var pending: Task<Void, Never>?

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
        if items[id] == nil { order.append(id) }
        items[id] = item
        schedule()
    }

    func remove(_ id: UUID) {
        items[id] = nil
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

    /// Web text boxes are the glyph run: the text width by the font's content-area height (1.364 em for Nunito Sans),
    /// centred in the line frame the view was given.
    private func glyphRun(_ item: Item) -> Item {
        guard let text = item.text, let size = item.size, let weight = item.weight,
              let font = DesignFont.uiFont(family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: size, weight: weight, fixedAxes: [:]) else { return item }
        var out = item
        let width = (text as NSString).size(withAttributes: [.font: font, .kern: item.tracking]).width
        let height = (1.011 * size).rounded() + (0.353 * size).rounded() // Chromium: rounded ascent plus rounded descent
        out.rect = CGRect(x: item.rect.minX, y: item.rect.midY - height / 2, width: min(width, item.rect.width), height: height)
        if size >= 14 && weight >= 560 { out.role = "heading" }
        return out
    }

    private func snapshot() -> Data? {
        let screen = UIScreen.main.bounds
        let styled = order.compactMap { items[$0] }
        // A plain accessibility entry is dropped when a styled one has the same text and nearly the same frame.
        let plain = accessibilityElements().filter { entry in
            !styled.contains { $0.text == entry.text && abs($0.rect.minX - entry.rect.minX) < 3 && abs($0.rect.minY - entry.rect.minY) < 12 }
        }
        // The web page wraps every screen in three full-viewport containers painted with the page colour.
        var page = Item(text: nil, role: "container", size: nil, weight: nil, color: nil, rect: CGRect(origin: .zero, size: screen.size), background: colourHex(PlayarrStyle.surface))
        var shell = page
        shell.background = colourHex(PlayarrStyle.background)
        var all = [shell, page, page] + styled.map(glyphRun) + plain
        // Styled text without its own string takes the string of the accessibility text it overlaps most.
        let texts = plain.filter { $0.role == "text" }
        all = all.map { item in
            guard item.text == nil, item.size != nil else { return item }
            var out = item
            out.text = texts.max { overlap($0.rect, item.rect) < overlap($1.rect, item.rect) }.flatMap { overlap($0.rect, item.rect) > 0 ? $0.text : nil }
            return out
        }.filter { $0.text != nil || $0.size == nil }
        // A plain accessibility entry that encloses a styled text is that text's control: a button with the text's backdrop.
        let styledTexts = all.filter { $0.size != nil }
        all = all.map { item in
            guard item.size == nil, item.role == "text" || item.role == "container", let name = item.text, !name.isEmpty,
                  let inner = styledTexts.first(where: { item.rect.insetBy(dx: -1, dy: -1).contains($0.rect) && item.rect.height > $0.rect.height + 4 }) else { return item }
            var out = item
            out.role = "button"
            out.background = inner.background
            out.radius = 50
            if name == "#" { out.text = "Numbers and symbols" }
            return out
        }
        let viewport = CGRect(origin: .zero, size: screen.size)
        all = all.filter { $0.rect.intersects(viewport) && $0.rect.width > 1 && $0.rect.height > 1 }
        all.sort { ($0.rect.minY, $0.rect.minX, $0.text ?? "", $0.role) < ($1.rect.minY, $1.rect.minX, $1.text ?? "", $1.role) }
        let elements: [[String: Any]] = all.compactMap { item in
            guard item.rect.width > 0, item.rect.height > 0 else { return nil }
            var element: [String: Any] = [
                "text": item.text ?? "",
                "role": item.role,
                "rect": ["x": Double(item.rect.minX), "y": Double(item.rect.minY), "w": Double(item.rect.width), "h": Double(item.rect.height)],
                "color": item.color as Any? ?? NSNull(),
                "background": item.background as Any? ?? NSNull(),
                "fontSize": item.size.map { Double($0) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
            ]
            if item.color == nil { element["color"] = NSNull() }
            if item.radius > 0 { element["radius"] = Double(item.radius) }
            return element
        }
        let document: [String: Any] = [
            "viewport": ["w": Double(screen.width), "h": Double(screen.height), "dpr": Double(UIScreen.main.scale)],
            "clockPinned": ParityLaunch.frozenNow != nil,
            "elements": elements,
        ]
        return try? JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
    }

    private func colourHex(_ colour: Color) -> String {
        let traits = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.traitCollection ?? UITraitCollection.current
        var r: CGFloat = 0, g: CGFloat = 0, bl: CGFloat = 0, a: CGFloat = 0
        UIColor(colour).resolvedColor(with: traits).getRed(&r, green: &g, blue: &bl, alpha: &a)
        func b(_ v: CGFloat) -> Int { max(0, min(255, Int((v * 255).rounded()))) }
        return String(format: "#%02x%02x%02x", b(r), b(g), b(bl))
    }

    private func overlap(_ a: CGRect, _ b: CGRect) -> CGFloat { a.intersection(b).isNull ? 0 : a.intersection(b).width * a.intersection(b).height }

    private func write(_ data: Data?) {
        guard let data else { return }
        let url = ParityLaunch.acceptanceStateURL.deletingLastPathComponent().appendingPathComponent("parity-layout.json")
        try? data.write(to: url, options: .atomic)
    }
}

private struct ParityBackgroundKey: EnvironmentKey { static let defaultValue: Color? = nil }
extension EnvironmentValues {
    /// The background a parity-exported container paints, inherited by the text drawn on it.
    var parityBackground: Color? {
        get { self[ParityBackgroundKey.self] }
        set { self[ParityBackgroundKey.self] = newValue }
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
    private var pageHex: String { Self.composited(environment.parityBackground ?? PlayarrStyle.surface, environment) }

    private static func hex(_ color: Color, _ environment: EnvironmentValues) -> String {
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    /// A fill composited over the page colour (translucent chips read as the colour the eye sees, as in the web export).
    private static func composited(_ color: Color, _ environment: EnvironmentValues) -> String {
        let top = color.resolve(in: environment), page = PlayarrStyle.surface.resolve(in: environment)
        let a = Float(top.opacity)
        func mix(_ t: Float, _ p: Float) -> Int { max(0, min(255, Int(((t * a + p * (1 - a)) * 255).rounded()))) }
        return String(format: "#%02x%02x%02x", mix(top.red, page.red), mix(top.green, page.green), mix(top.blue, page.blue))
    }

    func body(content: Content) -> some View {
        content
            .environment(\.parityBackground, box ?? environment.parityBackground)
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
        ParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size, weight: weight, color: hex, rect: frame, tracking: tracking, background: box.map { Self.composited($0, environment) } ?? pageHex, radius: radius))
    }
}
#endif

extension View {
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

    /// A control or container that the web exports as one element (a card link, a panel with a background).
    func parityBox(_ role: String, name: String? = nil, background: Color? = nil, radius: CGFloat = 0) -> some View {
        parityLayout(text: name, role: role, box: background, radius: radius)
    }
}

extension View {
    /// Text drawn on this fill reports it as its background in the layout export.
    func parityBackground(_ color: Color) -> some View {
        #if DEBUG
        environment(\.parityBackground, color)
        #else
        self
        #endif
    }
}
