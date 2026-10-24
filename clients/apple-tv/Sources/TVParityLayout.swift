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
        /// The CSS line box of a single-line element, when the web box is not the font's content area (the view's own line frame).
        var lineHeight: CGFloat?
        /// A wrapped heading: its lines and the line pitch (the web element spans first ascent to last descent).
        var lines: [String]?
        var pitch: CGFloat = 0
    }

    private var items: [UUID: Item] = [:]
    private var order: [UUID] = []
    private var pending: Task<Void, Never>?

    func set(_ id: UUID, _ item: Item) {
        if items[id] == nil { order.append(id) }
        items[id] = item
        schedule()
    }

    func remove(_ id: UUID) {
        items[id] = nil
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
        visit(window, depth: 0)
        return found
    }
    #elseif os(macOS)
    /// The Mac's accessibility tree (AppKit): frames and names for what views did not report themselves.
    private func accessibilityElements() -> [Item] {
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

    /// The raw tree, before any mapping to the web's boxes: every reported item with its measured text width, plus the
    /// accessibility entries. `scripts/parity/apple/layout-map.mjs` maps it (so the mapping iterates without a hosted run).
    private func snapshot() -> Data? {
        let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        func measure(_ item: Item) -> [String: Any] {
            var raw: [String: Any] = [
                "text": item.text ?? "",
                "role": item.role,
                "rect": ["x": Double(item.rect.minX), "y": Double(item.rect.minY), "w": Double(item.rect.width), "h": Double(item.rect.height)],
                "color": item.color as Any? ?? NSNull(),
                "background": item.background as Any? ?? NSNull(),
                "fontSize": item.size.map { Double($0) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
                "tracking": Double(item.tracking),
                "radius": Double(item.radius),
                "pitch": Double(item.pitch),
            ]
            if let lh = item.lineHeight { raw["lineHeight"] = Double(lh) }
            if let size = item.size, let weight = item.weight,
               let font = DesignFont.uiFont(family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: size, weight: weight, fixedAxes: [:]) {
                func width(_ text: String) -> Double { Double((text as NSString).size(withAttributes: [.font: font, .kern: item.tracking]).width) }
                if let lines = item.lines { raw["lines"] = lines; raw["width"] = lines.map(width).max() ?? 0 }
                else if let text = item.text { raw["width"] = width(text) }
            }
            return raw
        }
        let styled = order.compactMap { items[$0] }.filter { $0.rect.width > 0 && $0.rect.height > 0 && $0.rect.intersects(screen) }
        var raws = styled.map(measure)
        for var entry in accessibilityElements() where entry.rect.width > 0 && entry.rect.height > 0 && entry.rect.intersects(screen) {
            entry.background = nil
            var raw = measure(entry); raw["source"] = "ax"; raws.append(raw)
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

/// A card's visual transform (focus scale and lift). SwiftUI frames do not include `scaleEffect`, so views inside a scaled card
/// report layout frames; the scope publishes the card's own frame and transform, and the reporting modifiers apply it, so the
/// export holds what is drawn.
struct TVParityTransform: Equatable {
    var frame: CGRect = .zero
    var scale: CGFloat = 1
    var anchor = CGPoint(x: 0.5, y: 0.5)
    var lift: CGFloat = 0

    func apply(_ rect: CGRect) -> CGRect {
        guard scale != 1 || lift != 0, frame.width > 0 else { return rect }
        let ax = frame.minX + frame.width * anchor.x, ay = frame.minY + frame.height * anchor.y
        return CGRect(x: ax + (rect.minX - ax) * scale, y: ay + (rect.minY - ay) * scale + lift,
                      width: rect.width * scale, height: rect.height * scale)
    }
}

private struct TVParityTransformKey: EnvironmentKey { static let defaultValue = TVParityTransform() }
extension EnvironmentValues {
    var parityTransform: TVParityTransform {
        get { self[TVParityTransformKey.self] }
        set { self[TVParityTransformKey.self] = newValue }
    }
}

private struct TVParityTransformScope: ViewModifier {
    let scale: CGFloat
    let anchor: CGPoint
    let lift: CGFloat
    @State private var frame: CGRect = .zero

    func body(content: Content) -> some View {
        content
            .background(GeometryReader { proxy in
                let f = proxy.frame(in: tvScreenSpace)
                Color.clear.onAppear { frame = f }.onChange(of: f) { _, new in frame = new }
            })
            .environment(\.parityTransform, TVParityTransform(frame: frame, scale: scale, anchor: anchor, lift: lift))
    }
}

private struct TVParityLayoutModifier: ViewModifier {
    let text: String?
    let role: String
    let size: CGFloat?
    let weight: Int?
    let color: Color?
    let tracking: CGFloat
    var lineHeight: CGFloat? = nil
    var lines: [String]? = nil
    var pitch: CGFloat = 0
    var onPage = false
    @Environment(\.self) private var environment
    @Environment(\.parityTransform) private var transform
    @State private var id = UUID()

    private func hex(_ color: Color) -> String {
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                        .onChange(of: transform) { _, _ in report(frame) }
                }
            )
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ frame: CGRect) {
        TVParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size, weight: weight, color: color.map(hex), rect: transform.apply(frame), tracking: tracking,
                                                 background: hex(onPage ? DesignTokens.Stage.bg : DesignTokens.Stage.surface),
                                                 lineHeight: lineHeight, lines: lines, pitch: pitch)) // web: header on the page, content on the surface
    }
}

private struct TVParityBoxModifier: ViewModifier {
    let text: String?
    let role: String
    let radius: CGFloat
    let fill: Color?
    @Environment(\.self) private var environment
    @Environment(\.parityTransform) private var transform
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                        .onChange(of: transform) { _, _ in report(frame) }
                }
            )
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ frame: CGRect) {
        var item = TVParityLayoutRegistry.Item(text: text, role: role, rect: transform.apply(frame))
        if let fill {
            let r = fill.resolve(in: environment)
            func byte(_ v: Float) -> Int { max(0, min(255, Int((v * 255).rounded()))) }
            item.background = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        } else {
            item.background = "#000000"
        }
        item.radius = radius
        TVParityLayoutRegistry.shared.set(id, item)
    }
}
#endif

extension View {
    /// Marks a card's focus transform for the layout export (debug builds only).
    @ViewBuilder
    func parityTransformScope(scale: CGFloat, anchor: CGPoint = CGPoint(x: 0.5, y: 0.5), lift: CGFloat = 0) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityTransformScope(scale: scale, anchor: anchor, lift: lift))
        #else
        self
        #endif
    }

    /// Reports a box (card link, image, container with a fill and radius) to the parity layout export (debug builds only).
    @ViewBuilder
    func parityBox(_ role: String, text: String? = nil, radius: CGFloat = 0, fill: Color? = nil) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityBoxModifier(text: text, role: role, radius: radius, fill: fill))
        #else
        self
        #endif
    }

    /// Reports this view's text, style and frame to the parity layout export (debug builds only).
    @ViewBuilder
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil, tracking: CGFloat = 0, lineHeight: CGFloat? = nil, lines: [String]? = nil, pitch: CGFloat = 0, onPage: Bool = false) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color, tracking: tracking, lineHeight: lineHeight, lines: lines, pitch: pitch, onPage: onPage))
        #else
        self
        #endif
    }
}
