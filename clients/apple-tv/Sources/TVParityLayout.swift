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

    /// Web text boxes are the glyph run: the text width by the font's content-area height (Chromium: rounded ascent plus
    /// rounded descent of Nunito Sans), centred in the frame the view was given.
    private func glyphRun(_ item: Item) -> Item {
        guard let size = item.size, let weight = item.weight,
              let font = DesignFont.uiFont(family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: size, weight: weight, fixedAxes: [:]) else { return item }
        let content = (1.011 * size).rounded() + (0.353 * size).rounded()
        func width(_ text: String) -> CGFloat { (text as NSString).size(withAttributes: [.font: font, .kern: item.tracking]).width }
        var out = item
        if let lines = item.lines, !lines.isEmpty {
            let top = item.rect.minY + item.pitch / 2 - content / 2
            out.rect = CGRect(x: item.rect.minX, y: top, width: lines.map(width).max() ?? 0, height: item.pitch * CGFloat(lines.count - 1) + content)
            return out
        }
        guard let text = item.text else { return item }
        let w = width(text)
        if w > item.rect.width + 0.5 { return item } // wrapped: the view's own box is the text block
        let height = item.lineHeight ?? content
        out.rect = CGRect(x: item.rect.minX, y: item.rect.midY - height / 2, width: w, height: height)
        return out
    }

    private func snapshot() -> Data? {
        let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)
        let styled = order.compactMap { items[$0] }
        let plain = accessibilityElements().filter { entry in
            !styled.contains { $0.text == entry.text && abs($0.rect.minX - entry.rect.minX) < 3 && abs($0.rect.minY - entry.rect.minY) < 12 }
        }
        let elements: [[String: Any]] = (styled.map(glyphRun) + plain).compactMap { item in
            guard item.rect.width > 0, item.rect.height > 0, item.rect.intersects(screen) else { return nil } // off-viewport lazy items are dropped
            var element: [String: Any] = [
                "text": item.text ?? "",
                "role": item.role,
                "rect": ["x": Double(item.rect.minX), "y": Double(item.rect.minY), "w": Double(item.rect.width), "h": Double(item.rect.height)],
                "color": item.color as Any? ?? NSNull(),
                "background": item.background as Any? ?? NSNull(),
                "fontSize": item.size.map { Double($0) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
            ]
            if item.radius > 0 { element["radius"] = Double(item.radius) }
            return element
        }
        let document: [String: Any] = [
            "viewport": ["w": 1920.0, "h": 1080.0, "dpr": 1.0],
            "clockPinned": TVParityLaunch.pinnedClock,
            "elements": elements,
        ]
        return try? JSONSerialization.data(withJSONObject: document, options: [.sortedKeys])
    }

    private func publish(_ data: Data) {
        guard let url = TVParityState.stateURL?.deletingLastPathComponent().appendingPathComponent("parity-layout.json") else { return }
        try? data.write(to: url, options: .atomic)
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
                }
            )
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ frame: CGRect) {
        TVParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size, weight: weight, color: color.map(hex), rect: frame, tracking: tracking,
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
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                }
            )
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    private func report(_ frame: CGRect) {
        var item = TVParityLayoutRegistry.Item(text: text, role: role, rect: frame)
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
