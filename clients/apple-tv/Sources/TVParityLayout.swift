import SwiftUI
#if os(macOS)
import AppKit
#endif

/// Parity layout export (docs/parity/LAYOUT.md), debug builds only. Views opt in with `.parityLayout(...)`, reporting their
/// text, style and frame in screen points; the registry writes `parity-layout.json` beside `parity-state.json`, which the
/// Apple driver copies next to each screenshot. On tvOS the accessibility tree adds frames and names for what views did not
/// report themselves (no style values: those entries only count for presence and box).
#if DEBUG && (os(tvOS) || os(macOS))
@MainActor
final class TVParityLayoutRegistry {
    static let shared = TVParityLayoutRegistry()

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
        /// The text of each laid-out line when the view draws the lines itself (one Text per line elsewhere).
        var lines: [String]?
        /// The line's bounds in its text view's own space (diagnostic: the view's origin is `rect` minus this).
        var local: CGRect?
        var layer = 0
        var opacity: Double = 1
    }

    private var items: [UUID: Item] = [:]
    /// The laid-out lines of a text view from SwiftUI's own text layout (glyph-run bounds, relative to the view's origin).
    private var lineRects: [UUID: [CGRect]] = [:]
    private var order: [UUID] = []
    private var pending: Task<Void, Never>?

    func set(_ id: UUID, _ item: Item) {
        if items[id] == nil { order.append(id) }
        items[id] = item
        schedule()
    }

    func setLines(_ id: UUID, _ rects: [CGRect]) {
        guard lineRects[id] != rects else { return }
        lineRects[id] = rects
        schedule()
    }

    func remove(_ id: UUID) {
        items[id] = nil
        lineRects[id] = nil
        order.removeAll { $0 == id }
        schedule()
    }

    private var lastSnapshot: Data?

    /// Export only once the view is idle: the file is written when two consecutive snapshots, 0.4 s apart, are identical.
    private func schedule() {
        pending?.cancel()
        lastSnapshot = nil
        pending = Task { @MainActor [weak self] in
            for _ in 0..<40 {
                try? await Task.sleep(nanoseconds: 400_000_000)
                guard !Task.isCancelled, let self else { return }
                guard let data = self.snapshot() else { continue }
                if data == self.lastSnapshot { self.publish(data); return }
                self.lastSnapshot = data
            }
        }
    }

    #if os(tvOS)
    private func accessibilityElements(onlyPresented: Bool) -> [Item] {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return [] }
        var root: NSObject = window
        if onlyPresented {
            var controller = window.rootViewController
            while let presented = controller?.presentedViewController { controller = presented }
            if let view = controller?.view { root = view }
        }
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
                let label = object.accessibilityLabel ?? ""
                found.append(Item(text: label.isEmpty ? nil : label, role: role, rect: object.accessibilityFrame))
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
        visit(root, depth: 0)
        return found
    }
    #elseif os(macOS)
    /// The Mac's accessibility tree (AppKit): frames and names for what views did not report themselves.
    private func accessibilityElements(onlyPresented: Bool) -> [Item] {
        if onlyPresented { return [] } // the Mac draws presentations as styled items only
        guard let window = NSApp.keyWindow ?? NSApp.windows.first, let content = window.contentView else { return [] }
        var found: [Item] = []
        var visited = 0
        let height = content.bounds.height
        func visit(_ object: Any, depth: Int) {
            guard visited < 4000, depth < 40 else { return }
            visited += 1
            guard let element = object as? NSAccessibilityProtocol else { return }
            let role: NSAccessibility.Role? = element.accessibilityRole()
            let label: String = element.accessibilityLabel() ?? ""
            let frame: NSRect = element.accessibilityFrame()
            let skipped: [NSAccessibility.Role] = [.group, .scrollArea, .window]
            if let role, !label.isEmpty || role == NSAccessibility.Role.image, !skipped.contains(role) {
                var mapped = "container"
                if role == NSAccessibility.Role.button { mapped = "button" } else if role == NSAccessibility.Role.link { mapped = "link" }
                else if role == NSAccessibility.Role.image { mapped = "image" } else if role == NSAccessibility.Role.staticText { mapped = "text" }
                // screen coordinates (origin bottom-left) to the content view's top-left origin
                let inWindow = window.convertFromScreen(frame)
                let rect = CGRect(x: inWindow.minX, y: height - inWindow.maxY, width: inWindow.width, height: inWindow.height)
                found.append(Item(text: label.isEmpty ? nil : label, role: mapped, rect: rect))
            }
            for child in element.accessibilityChildren() ?? [] { visit(child, depth: depth + 1) }
        }
        visit(content, depth: 0)
        return found
    }
    #endif

    /// The raw tree, before the translation to the layout schema: every reported item (a text view as one item per laid-out
    /// line), plus the accessibility entries. `scripts/parity/apple/layout-map.mjs` translates it.
    private func snapshot() -> Data? {
        let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        func raw(_ item: Item) -> [String: Any] {
            var out: [String: Any] = [
                "text": item.text ?? "",
                "role": item.role,
                "rect": ["x": Double(item.rect.minX), "y": Double(item.rect.minY), "w": Double(item.rect.width), "h": Double(item.rect.height)],
                "color": item.color as Any? ?? NSNull(),
                "background": item.background as Any? ?? NSNull(),
                "fontSize": item.size.map { Double($0) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
                "radius": Double(min(item.radius, min(item.rect.width, item.rect.height) / 2)), // as drawn: a pill radius is half the box
                "opacity": item.opacity,
            ]
            if let l = item.local { out["local"] = ["x": Double(l.minX), "y": Double(l.minY), "w": Double(l.width), "h": Double(l.height)] }
            return out
        }
        // a text view is one item per laid-out line, each at the view's current origin plus the line's own bounds
        let ordered = order.flatMap { id -> [Item] in
            guard let item = items[id] else { return [] }
            guard let rects = lineRects[id], !rects.isEmpty else { return [item] }
            return rects.enumerated().map { index, rect in
                var line = item
                line.local = rect
                // the first line sits at the view's top: the layout reports it a fraction of the font size lower (leading above the ascent),
                // which is not where the view or its glyphs are; later lines keep the layout's own pitch
                line.rect = rect.offsetBy(dx: item.rect.minX, dy: item.rect.minY - rects[0].minY)
                if let names = item.lines, names.count == rects.count { line.text = names[index] }
                return line
            }
        }
        let top = ordered.map(\.layer).max() ?? 0
        var raws = ordered.filter { $0.layer == top && $0.rect.width > 0 && $0.rect.height > 0 && $0.rect.intersects(screen) }.map(raw)
        for var entry in accessibilityElements(onlyPresented: top > 0) where entry.rect.width > 0 && entry.rect.height > 0 && entry.rect.intersects(screen) {
            entry.background = nil
            var entryRaw = raw(entry); entryRaw["source"] = "ax"; raws.append(entryRaw)
        }
        let document: [String: Any] = [
            "viewport": ["w": 1920.0, "h": 1080.0, "dpr": 1.0],
            "clockPinned": TVParityLaunch.pinnedClock,
            "raw": raws,
        ]
        return try? JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
    }

    private func publish(_ data: Data) {
        guard let url = TVParityState.stateURL?.deletingLastPathComponent().appendingPathComponent("parity-layout.json") else { return }
        try? data.write(to: url, options: .atomic)
    }
}

/// The presentation layer of a view: 0 for the shell, +1 for each full-screen presentation (Who's watching, the player).
/// Only the topmost layer is exported, as only it is visible.
private struct TVParityLayerKey: EnvironmentKey { static let defaultValue = 0 }
extension EnvironmentValues {
    var parityLayer: Int {
        get { self[TVParityLayerKey.self] }
        set { self[TVParityLayerKey.self] = newValue }
    }
}

private struct TVParityLayerScope: ViewModifier {
    @Environment(\.parityLayer) private var layer
    func body(content: Content) -> some View { content.environment(\.parityLayer, layer + 1) }
}

/// The flat colour a view is drawn on (CSS ancestor background): set where an element really paints a fill, read by every item inside.
private struct TVParityBackdropKey: EnvironmentKey { static let defaultValue: Color? = nil }
extension EnvironmentValues {
    var parityBackdrop: Color? {
        get { self[TVParityBackdropKey.self] }
        set { self[TVParityBackdropKey.self] = newValue }
    }
}


/// SwiftUI's own text layout, observed while it draws: the typographic bounds of each laid-out line (glyph-run boxes).
/// Drawing is unchanged; nothing is measured by another renderer.
@available(tvOS 18.0, macOS 15.0, *)
private struct TVParityTextRenderer: TextRenderer {
    let report: ([CGRect]) -> Void

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout { context.draw(line) }
        // the glyph runs' own bounds: the line's bounds carry the tracking's leading space, which no glyph occupies
        report(layout.map { line in line.reduce(CGRect.null) { $0.union($1.typographicBounds.rect) }.standardized.isNull ? line.typographicBounds.rect : line.reduce(CGRect.null) { $0.union($1.typographicBounds.rect) } })
    }
}

private struct TVParityLayoutModifier: ViewModifier {
    let text: String?
    let role: String
    let size: CGFloat?
    let weight: Int?
    let color: Color?
    let tracking: CGFloat
    /// The text of each laid-out line when the view draws the lines itself (a wrapped heading built from one Text per line).
    var lines: [String]? = nil
    var onPage = false
    @Environment(\.self) private var environment
    @Environment(\.parityLayer) private var layer
    @Environment(\.parityBackdrop) private var backdrop
    @Environment(\.colorScheme) private var scheme
    @State private var id = UUID()

    private func hex(_ color: Color) -> String {
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    private func item(_ rect: CGRect) -> TVParityLayoutRegistry.Item {
        .init(text: text, role: role, size: size, weight: weight, color: color.map(hex), rect: rect, tracking: tracking,
              background: hex(backdrop ?? (onPage ? DesignTokens.Stage.bg : DesignTokens.Stage.surface)), lines: lines, layer: layer)
    }

    @ViewBuilder
    private func rendered(_ content: Content) -> some View {
        if #available(tvOS 18.0, macOS 15.0, *), text != nil, size != nil {
            content.textRenderer(TVParityTextRenderer { bounds in
                let key = id
                Task { @MainActor in TVParityLayoutRegistry.shared.setLines(key, bounds) }
            })
        } else {
            content
        }
    }

    func body(content: Content) -> some View {
        rendered(content)
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                        .onChange(of: scheme) { _, _ in report(frame) }
                        .onChange(of: text) { _, _ in report(frame) }
                }
            )
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ rect: CGRect) {
        TVParityLayoutRegistry.shared.set(id, item(rect))
    }
}

private struct TVParityBoxModifier: ViewModifier {
    let text: String?
    let role: String
    let radius: CGFloat
    let fill: Color?
    /// The opacity the fill is painted at: the box's colour is the fill composited over what is behind it.
    var alpha: Double = 1
    var opacity: Double = 1
    /// A full-bleed box reports the whole screen, not the TV safe area.
    var bleed = false
    /// The font the box's own text is set in, when the box carries its text itself (a button or caption with no separate Text view).
    var textStyle: (size: CGFloat, weight: Int, color: Color)? = nil
    @Environment(\.self) private var environment
    @Environment(\.parityBackdrop) private var backdrop
    @Environment(\.colorScheme) private var scheme
    @Environment(\.parityLayer) private var layer
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                        .onChange(of: scheme) { _, _ in report(frame) }
                        .onChange(of: text) { _, _ in report(frame) }
                }
                .ignoresSafeArea(edges: bleed ? .all : [])
            )
            .environment(\.parityBackdrop, painted)
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    /// The colour this box paints on screen: its fill at `alpha` composited over the backdrop (the page background by default).
    private var painted: Color? {
        guard let fill else { return backdrop }
        let top = fill.resolve(in: environment)
        guard alpha < 0.999 else { return Color(.sRGB, red: Double(top.red), green: Double(top.green), blue: Double(top.blue)) }
        let base = (backdrop ?? DesignTokens.Stage.bg).resolve(in: environment)
        let a = Float(alpha)
        return Color(.sRGB, red: Double(top.red * a + base.red * (1 - a)), green: Double(top.green * a + base.green * (1 - a)), blue: Double(top.blue * a + base.blue * (1 - a)))
    }

    private func report(_ frame: CGRect) {
        var item = TVParityLayoutRegistry.Item(text: text, role: role, rect: frame)
        if let painted {
            let r = painted.resolve(in: environment)
            func byte(_ v: Float) -> Int { max(0, min(255, Int((v * 255).rounded()))) }
            item.background = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        } else {
            item.background = nil
        }
        if let textStyle {
            item.size = textStyle.size
            item.weight = textStyle.weight
            let c = textStyle.color.resolve(in: environment)
            func byte(_ v: Float) -> Int { max(0, min(255, Int((v * 255).rounded()))) }
            item.color = String(format: "#%02x%02x%02x", byte(c.red), byte(c.green), byte(c.blue))
        }
        item.radius = radius
        item.opacity = opacity
        item.layer = layer
        TVParityLayoutRegistry.shared.set(id, item)
    }
}
#endif

extension View {
    /// Marks a full-screen presentation: items inside it are the visible layer, items beneath it are occluded.
    @ViewBuilder
    func parityLayerScope() -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityLayerScope())
        #else
        self
        #endif
    }

    /// Declares the flat colour this view paints (web: the ancestor background), for every item inside it.
    @ViewBuilder
    func parityBackdrop(_ color: Color) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        environment(\.parityBackdrop, color)
        #else
        self
        #endif
    }

    /// Reports a box (card link, image, container with a fill and radius) to the parity layout export (debug builds only).
    @ViewBuilder
    func parityBox(_ role: String, text: String? = nil, radius: CGFloat = 0, fill: Color? = nil, alpha: Double = 1, opacity: Double = 1, bleed: Bool = false, textStyle: (size: CGFloat, weight: Int, color: Color)? = nil) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityBoxModifier(text: text, role: role, radius: radius, fill: fill, alpha: alpha, opacity: opacity, bleed: bleed, textStyle: textStyle))
        #else
        self
        #endif
    }

    /// Reports this view's text, style and frame to the parity layout export (debug builds only).
    @ViewBuilder
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil, tracking: CGFloat = 0, lines: [String]? = nil, onPage: Bool = false) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color, tracking: tracking, lines: lines, onPage: onPage))
        #else
        self
        #endif
    }
}
