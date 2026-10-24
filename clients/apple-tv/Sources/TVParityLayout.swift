import SwiftUI

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

    private func schedule() {
        pending?.cancel()
        pending = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let self else { return }
            self.write()
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
    #endif

    /// Web text boxes are the glyph run: the text width by the font's content-area height (Chromium: rounded ascent plus
    /// rounded descent of Nunito Sans), centred in the frame the view was given.
    private func glyphRun(_ item: Item) -> Item {
        guard let text = item.text, let size = item.size, let weight = item.weight,
              let font = DesignFont.uiFont(family: "Nunito Sans", postScriptName: DesignFont.nunitoPostScriptName, size: size, weight: weight, fixedAxes: [:]) else { return item }
        var out = item
        let width = (text as NSString).size(withAttributes: [.font: font, .kern: item.tracking]).width
        let height = (1.011 * size).rounded() + (0.353 * size).rounded()
        out.rect = CGRect(x: item.rect.minX, y: item.rect.midY - height / 2, width: min(width, item.rect.width), height: height)
        if size >= 14 && weight >= 560 { out.role = "heading" }
        return out
    }

    private func write() {
        let styled = order.compactMap { items[$0] }
        #if os(tvOS)
        let plain = accessibilityElements().filter { entry in
            !styled.contains { $0.text == entry.text && abs($0.rect.minX - entry.rect.minX) < 3 && abs($0.rect.minY - entry.rect.minY) < 12 }
        }
        #else
        let plain: [Item] = []
        #endif
        let elements: [[String: Any]] = (styled.map(glyphRun) + plain).compactMap { item in
            guard item.rect.width > 0, item.rect.height > 0 else { return nil }
            return [
                "text": item.text ?? "",
                "role": item.role,
                "rect": ["x": Double(item.rect.minX), "y": Double(item.rect.minY), "w": Double(item.rect.width), "h": Double(item.rect.height)],
                "color": item.color as Any? ?? NSNull(),
                "background": item.background as Any? ?? NSNull(),
                "fontSize": item.size.map { Double($0) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
            ]
        }
        let document: [String: Any] = [
            "viewport": ["w": 1920.0, "h": 1080.0, "dpr": 1.0],
            "clockPinned": TVParityLaunch.pinnedClock,
            "elements": elements,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: document),
              let url = TVParityState.stateURL?.deletingLastPathComponent().appendingPathComponent("parity-layout.json") else { return }
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
        TVParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size, weight: weight, color: color.map(hex), rect: frame, tracking: tracking, background: hex(DesignTokens.Stage.bg)))
    }
}
#endif

extension View {
    /// Reports this view's text, style and frame to the parity layout export (debug builds only).
    @ViewBuilder
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil, tracking: CGFloat = 0) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color, tracking: tracking))
        #else
        self
        #endif
    }
}
