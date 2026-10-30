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
        /// The text of each laid-out line when the view draws the lines itself (one Text per line elsewhere).
        var lines: [String]?
        /// The line's bounds in its text view's own space (diagnostic: the view's origin is `rect` minus this).
        var local: CGRect?
        var layer = 0
        var opacity: Double = 1
        /// The scale the view is drawn at (its transformed frame over its own size), 1 when no ancestor scales it.
        var scale: CGFloat = 1
    }

    private var items: [UUID: Item] = [:]
    /// The laid-out lines of a text view from SwiftUI's own text layout (glyph-run bounds, relative to the view's origin).
    private var lineRects: [UUID: [CGRect]] = [:]
    private var order: [UUID] = []

    func set(_ id: UUID, _ item: Item) {
        startWatching()
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

    private var answeredRequest: String?
    private var watcher: Task<Void, Never>?

    private var requestURL: URL? { TVParityState.stateURL?.deletingLastPathComponent().appendingPathComponent("parity-layout-request") }

    /// The driver asks for the layout of one capture by writing an id to `parity-layout-request`, after its screenshot. The tree
    /// is published again, once it has settled and its visibility has been measured on the rendered screen, stamped with that id,
    /// so a layout always belongs to the frame the id was written for.
    private func startWatching() {
        guard watcher == nil else { return }
        watcher = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard let self, let url = self.requestURL,
                      let id = (try? String(contentsOf: url, encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !id.isEmpty, id != self.answeredRequest else { continue }
                var previous: Data?
                for _ in 0..<25 {
                    guard let data = self.snapshot(captureID: id, visibility: nil) else { try? await Task.sleep(nanoseconds: 300_000_000); continue }
                    if data == previous {
                        let visibility = await self.measureVisibility()
                        if let data = self.snapshot(captureID: id, visibility: visibility) { self.publish(data) }
                        self.answeredRequest = id
                        break
                    }
                    previous = data
                    try? await Task.sleep(nanoseconds: 300_000_000)
                }
            }
        }
    }

    // MARK: Visibility from the rendered screen

    /// What the rendered screen shows of each reported item. Every item is hidden in turn (several at once when their boxes are
    /// apart) and the screen is rendered again: an item with no pixel of its own that changes is not visible, whatever its frame,
    /// its layer or the opacity and clipping of its ancestors say. Nothing about visibility is inferred from geometry.
    struct Visibility {
        /// For each reported view, one flag per line rect (or one for the box): did hiding the view change pixels in that rect.
        var rects: [UUID: [Bool]] = [:]
        /// The bounds of the pixels that changed, per rect, for the record.
        var seen: [UUID: [CGRect]] = [:]
        /// For text: the colour most common behind it, read from the render with the text hidden (the backdrop it is drawn on).
        var behind: [UUID: [String?]] = [:]
        /// False when the screen could not be rendered (a blank render proves nothing): the export must then be refused.
        var rendered = true
    }

    private func lineRect(_ item: Item, _ local: CGRect) -> CGRect {
        let k = item.scale
        return CGRect(x: item.rect.minX + local.minX * k, y: item.rect.minY + local.minY * k, width: local.width * k, height: local.height * k)
    }

    private func measureVisibility() async -> Visibility {
        let hide = TVParityHide.shared
        let settle: UInt64 = 160_000_000
        hide.hidden = []
        try? await Task.sleep(nanoseconds: settle)
        guard let base = TVParityStageRender.capture() else { return Visibility(rendered: false) }
        try? await Task.sleep(nanoseconds: settle)
        guard let again = TVParityStageRender.capture(), base.hasContent else { return Visibility(rendered: false) }
        // units: each reported view with the rect(s) it draws
        var units: [(id: UUID, rects: [CGRect], hull: CGRect)] = []
        for id in order {
            guard let item = items[id] else { continue }
            var rects = [item.rect]
            if let lines = lineRects[id], !lines.isEmpty { rects = lines.map { lineRect(item, $0) } }
            var hull = rects[0]
            for rect in rects.dropFirst() { hull = hull.union(rect) }
            guard hull.width > 0, hull.height > 0 else { continue }
            units.append((id, rects, hull))
        }
        // views whose boxes are apart can be hidden together: one render for the whole batch
        var batches: [[Int]] = []
        for index in units.indices {
            let box = units[index].hull.insetBy(dx: -3, dy: -3)
            if let slot = batches.firstIndex(where: { batch in batch.allSatisfy { !units[$0].hull.insetBy(dx: -3, dy: -3).intersects(box) } }) {
                batches[slot].append(index)
            } else {
                batches.append([index])
            }
        }
        var result = Visibility()
        for batch in batches {
            hide.hidden = Set(batch.map { units[$0].id })
            try? await Task.sleep(nanoseconds: settle)
            guard let hidden = TVParityStageRender.capture() else { hide.hidden = []; return Visibility(rendered: false) }
            for index in batch {
                let unit = units[index]
                let changes = unit.rects.map { hidden.changed(in: $0, from: base, stableWith: again) }
                result.rects[unit.id] = changes.map { $0 != nil }
                result.seen[unit.id] = changes.map { $0 ?? .zero }
                if items[unit.id]?.size != nil, items[unit.id]?.text != nil {
                    result.behind[unit.id] = unit.rects.map { hidden.dominantColour(in: $0) }
                }
            }
        }
        hide.hidden = []
        try? await Task.sleep(nanoseconds: settle)
        return result
    }

    /// The tree is never published on its own: only for a capture request (`startWatching`), so a file always has an id.
    private func schedule() {}

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
    private func snapshot(captureID: String? = nil, visibility: Visibility?) -> Data? {
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
        let ordered = order.flatMap { id -> [(Item, Bool?, CGRect?, String?)] in
            guard let item = items[id] else { return [] }
            let seen = visibility?.rects[id]
            let seenBounds = visibility?.seen[id]
            let behind = visibility?.behind[id]
            guard let rects = lineRects[id], !rects.isEmpty else { return [(item, seen?.first, seenBounds?.first, behind?.first ?? nil)] }
            return rects.enumerated().map { index, rect in
                var line = item
                line.local = rect
                // the line's own bounds from SwiftUI's text layout, in the view's space, carried to the screen by the view's frame
                // origin and scale: no offset is removed or invented
                line.rect = lineRect(item, rect)
                // the text of each line is known only where the view draws its lines itself; otherwise the view's whole string is kept
                if let names = item.lines, names.count == rects.count { line.text = names[index] }
                return (line, seen.flatMap { index < $0.count ? $0[index] : nil }, seenBounds.flatMap { index < $0.count ? $0[index] : nil },
                        behind.flatMap { index < $0.count ? $0[index] : nil })
            }
        }
        let top = ordered.map { $0.0.layer }.max() ?? 0
        // Visible means: hiding the item changed the rendered screen (measureVisibility). Without the measurement nothing is dropped.
        var raws = ordered.filter { entry in
            entry.0.rect.width > 0 && entry.0.rect.height > 0 && entry.0.rect.intersects(screen) && (visibility == nil || entry.1 == true)
        }.map { entry -> [String: Any] in
            var out = raw(entry.0)
            if let behind = entry.3 { out["background"] = behind }
            if let bounds = entry.2 { out["visibleBounds"] = ["x": Double(bounds.minX), "y": Double(bounds.minY), "w": Double(bounds.width), "h": Double(bounds.height)] }
            return out
        }
        let visibleRects = ordered.filter { visibility != nil && $0.1 == true }.map { $0.0.rect }
        // An accessibility entry cannot be hidden and re-rendered: it is on screen when what it holds is, that is when a visible
        // reported item lies inside it or it lies inside one.
        for var entry in accessibilityElements(onlyPresented: top > 0) where entry.rect.width > 0 && entry.rect.height > 0 && entry.rect.intersects(screen) {
            if visibility != nil {
                let centre = CGPoint(x: entry.rect.midX, y: entry.rect.midY)
                guard visibleRects.contains(where: { $0.contains(centre) || entry.rect.contains(CGPoint(x: $0.midX, y: $0.midY)) }) else { continue }
            }
            entry.background = nil
            var entryRaw = raw(entry); entryRaw["source"] = "ax"; raws.append(entryRaw)
        }
        var document: [String: Any] = [
            "viewport": ["w": 1920.0, "h": 1080.0, "dpr": 1.0],
            "clockPinned": TVParityLaunch.pinnedClock,
            "raw": raws,
        ]
        if let captureID { document["captureID"] = captureID }
        if let visibility { document["visibility"] = visibility.rendered ? "rendered" : "unavailable" }
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


/// The views the visibility pass hides: each reported view fades to nothing while it is in the set.
@Observable
final class TVParityHide {
    static let shared = TVParityHide()
    var hidden: Set<UUID> = []
}

/// The rendered stage as RGBA pixels, 1920 x 1080 (the stage in points; the Mac scales its window to it).
struct TVParityStageRender {
    static let width = 1920
    static let height = 1080
    var pixels: [UInt8]

    /// A render that is one flat colour proves nothing (the render path produced nothing).
    var hasContent: Bool {
        var seen = Set<UInt32>()
        var index = 0
        let step = 4 * 997
        while index + 3 < pixels.count && seen.count < 8 {
            seen.insert(UInt32(pixels[index]) << 16 | UInt32(pixels[index + 1]) << 8 | UInt32(pixels[index + 2]))
            index += step
        }
        return seen.count >= 8
    }

    /// The bounds of the pixels inside `rect` that differ from `base` by more than 3 in any channel, ignoring pixels that moved
    /// between two renders of the unchanged screen (`stable`). Nil when none differ.
    func changed(in rect: CGRect, from base: TVParityStageRender, stableWith stable: TVParityStageRender) -> CGRect? {
        let x0 = max(0, Int(rect.minX.rounded(.down))), x1 = min(Self.width, Int(rect.maxX.rounded(.up)))
        let y0 = max(0, Int(rect.minY.rounded(.down))), y1 = min(Self.height, Int(rect.maxY.rounded(.up)))
        guard x0 < x1, y0 < y1 else { return nil }
        var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1
        pixels.withUnsafeBufferPointer { now in
            base.pixels.withUnsafeBufferPointer { was in
                stable.pixels.withUnsafeBufferPointer { again in
                    for y in y0..<y1 {
                        var o = (y * Self.width + x0) * 4
                        for x in x0..<x1 {
                            for c in 0..<3 {
                                let moved = abs(Int(now[o + c]) - Int(was[o + c])) > 3
                                if moved && abs(Int(again[o + c]) - Int(was[o + c])) <= 3 {
                                    minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
                                    break
                                }
                            }
                            o += 4
                        }
                    }
                }
            }
        }
        return maxX < 0 ? nil : CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    }

    /// The colour most common inside `rect` (sampled every 2 pixels), as #rrggbb: what a view is drawn on, when read from a render
    /// of the screen without that view.
    func dominantColour(in rect: CGRect) -> String? {
        let x0 = max(0, Int(rect.minX.rounded(.down))), x1 = min(Self.width, Int(rect.maxX.rounded(.up)))
        let y0 = max(0, Int(rect.minY.rounded(.down))), y1 = min(Self.height, Int(rect.maxY.rounded(.up)))
        guard x0 < x1, y0 < y1 else { return nil }
        var counts: [UInt32: Int] = [:]
        pixels.withUnsafeBufferPointer { px in
            for y in stride(from: y0, to: y1, by: 2) {
                for x in stride(from: x0, to: x1, by: 2) {
                    let o = (y * Self.width + x) * 4
                    counts[UInt32(px[o]) << 16 | UInt32(px[o + 1]) << 8 | UInt32(px[o + 2]), default: 0] += 1
                }
            }
        }
        guard let best = counts.max(by: { $0.value < $1.value })?.key else { return nil }
        return String(format: "#%02x%02x%02x", (best >> 16) & 255, (best >> 8) & 255, best & 255)
    }

    private static func pixels(of image: CGImage) -> [UInt8]? {
        var data = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = data.withUnsafeMutableBytes { buffer -> Bool in
            guard let ctx = CGContext(data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return drawn ? data : nil
    }

    #if os(tvOS)
    @MainActor
    static func capture() -> TVParityStageRender? {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: window.bounds.size, format: format).image { _ in
            window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        return image.cgImage.flatMap(pixels(of:)).map(TVParityStageRender.init)
    }
    #elseif os(macOS)
    /// The window's layer tree at stage size, the way the debug remote takes the screenshot (MacDebugRemote.snapshot).
    @MainActor
    static func capture() -> TVParityStageRender? {
        guard let window = NSApp.keyWindow ?? NSApp.windows.first, let view = window.contentView, let layer = view.layer, view.bounds.width > 0,
              let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        let scale = 1 / min(view.bounds.width / 1920, view.bounds.height / 1080)
        if layer.isGeometryFlipped || view.isFlipped {
            ctx.translateBy(x: 0, y: CGFloat(height))
            ctx.scaleBy(x: scale, y: -scale)
        } else {
            ctx.scaleBy(x: scale, y: scale)
        }
        layer.render(in: ctx)
        guard let image = ctx.makeImage() else { return nil }
        return pixels(of: image).map(TVParityStageRender.init)
    }
    #endif
}

/// SwiftUI's own text layout, observed while it draws: the typographic bounds of each laid-out line (glyph-run boxes).
/// Drawing is unchanged; nothing is measured by another renderer.
@available(tvOS 18.0, macOS 15.0, *)
private struct TVParityTextRenderer: TextRenderer {
    let report: ([CGRect]) -> Void

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout { context.draw(line) }
        report(layout.map { $0.typographicBounds.rect })
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
    /// A text run that sits on its own painted pill (web: the text node's parent carries the fill and radius): the pill's fill at
    /// `fillAlpha` composited over the backdrop is the colour behind the text, and `radius` is the pill's.
    var fill: Color? = nil
    var fillAlpha: Double = 1
    var radius: CGFloat = 0
    /// The colour the pill's fill is composited over when it is not the backdrop (a pill that paints over the page surface, not its card).
    var over: Color? = nil
    @Environment(\.self) private var environment
    @Environment(\.parityLayer) private var layer
    @Environment(\.parityBackdrop) private var backdrop
    @Environment(\.colorScheme) private var scheme
    @State private var id = UUID()
    private let hide = TVParityHide.shared

    private func hex(_ color: Color) -> String {
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    private var behind: Color {
        let base = over ?? backdrop ?? (onPage ? DesignTokens.Stage.bg : DesignTokens.Stage.surface)
        guard let fill else { return base }
        let top = fill.resolve(in: environment)
        let under = base.resolve(in: environment)
        let a = Float(fillAlpha)
        return Color(.sRGB, red: Double(top.red * a + under.red * (1 - a)), green: Double(top.green * a + under.green * (1 - a)), blue: Double(top.blue * a + under.blue * (1 - a)))
    }

    private func item(_ rect: CGRect, scale: CGFloat) -> TVParityLayoutRegistry.Item {
        .init(text: text, role: role, size: size, weight: weight, color: color.map(hex), rect: rect, tracking: tracking,
              background: hex(behind), radius: radius, lines: lines, layer: layer, scale: scale)
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
            .opacity(hide.hidden.contains(id) ? 0 : 1)
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    let scale = Self.scale(of: frame, size: proxy.size)
                    Color.clear
                        .onAppear { report(frame, scale) }
                        .onChange(of: frame) { _, new in report(new, scale) }
                        .onChange(of: scale) { _, new in report(frame, new) }
                        // anything the item records but the frame: text, colour, fill, backdrop, radius, role, layer, size, weight
                        .onChange(of: item(.zero, scale: 1)) { _, _ in report(frame, scale) }
                }
            )
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    /// The scale an ancestor draws this view at: its transformed frame over the size it was laid out at.
    private static func scale(of frame: CGRect, size: CGSize) -> CGFloat {
        guard size.width > 1 else { return 1 }
        let k = frame.width / size.width
        return abs(k - 1) < 0.002 ? 1 : k
    }

    private func report(_ rect: CGRect, _ scale: CGFloat) {
        TVParityLayoutRegistry.shared.set(id, item(rect, scale: scale))
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
    private let hide = TVParityHide.shared

    func body(content: Content) -> some View {
        content
            .opacity(hide.hidden.contains(id) ? 0 : 1)
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                        .onChange(of: build(.zero)) { _, _ in report(frame) }
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
        TVParityLayoutRegistry.shared.set(id, build(frame))
    }

    private func build(_ frame: CGRect) -> TVParityLayoutRegistry.Item {
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
        return item
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
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil, tracking: CGFloat = 0, lines: [String]? = nil, onPage: Bool = false, fill: Color? = nil, fillAlpha: Double = 1, radius: CGFloat = 0, over: Color? = nil) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color, tracking: tracking, lines: lines, onPage: onPage, fill: fill, fillAlpha: fillAlpha, radius: radius, over: over))
        #else
        self
        #endif
    }
}
