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
        guard ParityLaunch.isActive else { return }
        pending?.cancel()
        pending = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled, let self else { return }
            self.write()
        }
    }

    private func write() {
        let screen = UIScreen.main.bounds
        let elements: [[String: Any]] = order.compactMap { id in
            guard let item = items[id], item.rect.width > 0, item.rect.height > 0 else { return nil }
            var element: [String: Any] = [
                "text": item.text ?? "",
                "role": item.role,
                "rect": ["x": Double(item.rect.minX), "y": Double(item.rect.minY), "w": Double(item.rect.width), "h": Double(item.rect.height)],
                "color": item.color as Any? ?? NSNull(),
                "background": NSNull(),
                "fontSize": item.size.map { Double($0) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
            ]
            if item.color == nil { element["color"] = NSNull() }
            return element
        }
        let document: [String: Any] = [
            "viewport": ["w": Double(screen.width), "h": Double(screen.height), "dpr": Double(UIScreen.main.scale)],
            "clockPinned": ParityLaunch.frozenNow != nil,
            "elements": elements,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: document) else { return }
        let url = ParityLaunch.acceptanceStateURL.deletingLastPathComponent().appendingPathComponent("parity-layout.json")
        try? data.write(to: url, options: .atomic)
    }
}

private struct ParityLayoutModifier: ViewModifier {
    let text: String?
    let role: String
    let size: CGFloat?
    let weight: Int?
    let color: Color?
    @Environment(\.self) private var environment
    @State private var id = UUID()

    private var hex: String? {
        guard let color else { return nil }
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    func body(content: Content) -> some View {
        content
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
        ParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size, weight: weight, color: hex, rect: frame))
    }
}
#endif

extension View {
    /// Reports this view's text, style and frame to the parity layout export (debug builds only).
    @ViewBuilder
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil) -> some View {
        #if DEBUG
        modifier(ParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color))
        #else
        self
        #endif
    }
}
