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
    /// The string SwiftUI laid out on each line, read from the segment attributes of a `Text(parityWrapped:)` (nil elsewhere).
    private var lineTexts: [UUID: [String]] = [:]
    private var order: [UUID] = []

    func set(_ id: UUID, _ item: Item) {
        startWatching()
        if items[id] == nil { order.append(id) }
        items[id] = item
        schedule()
    }

    func setLines(_ id: UUID, _ rects: [CGRect], texts: [String]) {
        guard lineRects[id] != rects || lineTexts[id] != texts else { return }
        lineRects[id] = rects
        lineTexts[id] = texts
        schedule()
    }

    func remove(_ id: UUID) {
        items[id] = nil
        lineRects[id] = nil
        lineTexts[id] = nil
        order.removeAll { $0 == id }
        schedule()
    }

    private var answeredRequest: String?
    private var lastVisibility: Visibility?
    private var watcher: Task<Void, Never>?

    private var requestURL: URL? { TVParityState.stateURL?.deletingLastPathComponent().appendingPathComponent("parity-layout-request") }

    /// The driver asks for the layout of one capture by writing an id to `parity-layout-request`, after its screenshot. The tree
    /// is published again, once it has settled and its visibility has been measured on the rendered screen, stamped with that id,
    /// so a layout always belongs to the frame the id was written for.
    private func startWatching() {
        guard watcher == nil else { return }
        // A request file left by an earlier launch was answered (or abandoned) there: only a request written after this launch counts.
        answeredRequest = requestURL.flatMap { try? String(contentsOf: $0, encoding: .utf8) }?.trimmingCharacters(in: .whitespacesAndNewlines)
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
                        // A request ending "-a" is the visibility pass (it hides and shows every item, which re-renders the screen); the request
                        // that follows the saved frame reuses that pass's answer and changes nothing on screen, so the frame saved is the one
                        // the layout is published for.
                        let visibility: Visibility
                        if !id.hasSuffix("-a"), let kept = self.lastVisibility { visibility = kept } else { visibility = await self.measureVisibility() }
                        if id.hasSuffix("-a") { self.lastVisibility = visibility }
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
                else if traits.contains(.adjustable) { role = "slider" }
                else if traits.contains(.searchField) { role = "textbox" }
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
                else if role == NSAccessibility.Role.slider { mapped = "slider" } else if role == NSAccessibility.Role.textField { mapped = "textbox" }
                else if role == NSAccessibility.Role.checkBox { mapped = "switch" } else if role == NSAccessibility.Role.popUpButton { mapped = "select" }
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
                // as drawn: the size the view is laid out at, times the scale an ancestor draws it at
                "fontSize": item.size.map { Double($0 * item.scale) } as Any? ?? NSNull(),
                "fontWeight": item.weight as Any? ?? NSNull(),
                // as drawn: scaled with the view; a box's pill radius is half the box. A text run's radius belongs to the capsule it sits
                // on, which is not the glyph line's box, so it is not clamped against the line.
                "radius": Double(item.text != nil && item.size != nil ? item.radius * item.scale : min(item.radius * item.scale, min(item.rect.width, item.rect.height) / 2)),
                "opacity": item.opacity,
            ]
            if let l = item.local { out["local"] = ["x": Double(l.minX), "y": Double(l.minY), "w": Double(l.width), "h": Double(l.height)] }
            return out
        }
        // a text view is one item per laid-out line, each at the view's current origin plus the line's own bounds
        let ordered = order.flatMap { id -> [(Item, Bool?, CGRect?)] in
            guard let item = items[id] else { return [] }
            let seen = visibility?.rects[id]
            let seenBounds = visibility?.seen[id]
            guard let rects = lineRects[id], !rects.isEmpty else { return [(item, seen?.first, seenBounds?.first)] }
            // SwiftUI's text layout gives each line's box but not its string, so a wrapped paragraph whose view does not draw its
            // lines itself is one item over the union of its lines (its whole string, its real bounds): never the whole string
            // repeated on every line.
            let drawn = lineTexts[id]
            let known = drawn?.count == rects.count && drawn?.allSatisfy { !$0.isEmpty } == true
            if rects.count > 1, item.lines?.count != rects.count, !known {
                var union = lineRect(item, rects[0])
                for r in rects.dropFirst() { union = union.union(lineRect(item, r)) }
                var whole = item
                whole.rect = union
                return [(whole, seen.map { $0.contains(true) }, seenBounds.flatMap { $0.filter { !$0.isEmpty }.reduce(nil as CGRect?) { $0?.union($1) ?? $1 } })]
            }
            return rects.enumerated().map { index, rect in
                var line = item
                line.local = rect
                // the line's own bounds from SwiftUI's text layout, in the view's space, carried to the screen by the view's frame
                // origin and scale: no offset is removed or invented
                line.rect = lineRect(item, rect)
                // the text of each line is known only where the view draws its lines itself; otherwise the view's whole string is kept
                if let names = item.lines, names.count == rects.count { line.text = names[index] }
                else if known, let drawn { line.text = drawn[index] }
                return (line, seen.flatMap { index < $0.count ? $0[index] : nil }, seenBounds.flatMap { index < $0.count ? $0[index] : nil })
            }
        }
        let top = ordered.map { $0.0.layer }.max() ?? 0
        // Visible means: hiding the item changed the rendered screen (measureVisibility). Without the measurement nothing is dropped.
        let occluded = visibility == nil ? 0 : ordered.filter { entry in
            entry.0.rect.width > 0 && entry.0.rect.height > 0 && entry.0.rect.intersects(screen) && entry.1 != true
        }.count
        let raws = ordered.filter { entry in
            entry.0.rect.width > 0 && entry.0.rect.height > 0 && entry.0.rect.intersects(screen) && (visibility == nil || entry.1 == true)
        }.map { entry -> [String: Any] in
            var out = raw(entry.0)
            if let bounds = entry.2 { out["visibleBounds"] = ["x": Double(bounds.minX), "y": Double(bounds.minY), "w": Double(bounds.width), "h": Double(bounds.height)] }
            return out
        }
        // An accessibility entry cannot be hidden and re-rendered, so on its own it is not shown to be on screen: it is not exported.
        // What the app reports itself (every control carries a parityBox) is measured; entries with no reported view behind them are
        // listed in the document for the record and left out of the layout.
        var unbacked: [[String: Any]] = []
        for entry in accessibilityElements(onlyPresented: top > 0) where entry.rect.width > 0 && entry.rect.height > 0 && entry.rect.intersects(screen) {
            let backed = ordered.contains { $0.0.text == entry.text && $0.0.rect.intersects(entry.rect) }
            if !backed { unbacked.append(["text": entry.text ?? "", "role": entry.role, "rect": ["x": Double(entry.rect.minX), "y": Double(entry.rect.minY), "w": Double(entry.rect.width), "h": Double(entry.rect.height)]]) }
        }
        var document: [String: Any] = [
            "viewport": ["w": 1920.0, "h": 1080.0, "dpr": 1.0],
            "clockPinned": TVParityLaunch.pinnedClock,
            "raw": raws,
            "occluded": occluded,
            "axUnbacked": unbacked,
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


/// A gradient an ancestor draws over or through its content: with no `color` it is a mask (the content shows at the stop alpha
/// there), with a `color` it is a paint (the colour is laid over the content at the stop alpha, a scrim). Frames are in screen space.
struct TVParityGradient: Equatable {
    struct Stop: Equatable { var location: Double; var alpha: Double }
    var horizontal: Bool
    var frame: CGRect
    var stops: [Stop]
    var color: Color?

    /// The gradient's alpha at a screen point, interpolated between the stops the way the drawn gradient is.
    func alpha(at point: CGPoint) -> Double {
        let length = horizontal ? frame.width : frame.height
        guard length > 0, let first = stops.first, let last = stops.last else { return 1 }
        let t = max(0, min(1, (horizontal ? point.x - frame.minX : point.y - frame.minY) / length))
        if t <= first.location { return first.alpha }
        for index in 1..<stops.count {
            let a = stops[index - 1], b = stops[index]
            if t <= b.location {
                let span = b.location - a.location
                return span <= 0 ? b.alpha : a.alpha + (b.alpha - a.alpha) * (t - a.location) / span
            }
        }
        return last.alpha
    }
}

private struct TVParityGradientsKey: EnvironmentKey { static let defaultValue: [TVParityGradient] = [] }
private struct TVParityOpacityKey: EnvironmentKey { static let defaultValue: Double = 1 }
extension EnvironmentValues {
    /// The masks and scrims of the ancestors, outermost first.
    var parityGradients: [TVParityGradient] {
        get { self[TVParityGradientsKey.self] }
        set { self[TVParityGradientsKey.self] = newValue }
    }
    /// The product of the opacity modifiers of the ancestors.
    var parityOpacity: Double {
        get { self[TVParityOpacityKey.self] }
        set { self[TVParityOpacityKey.self] = newValue }
    }
}

/// What an item at `rect` really shows of itself: the opacity of its ancestors times every ancestor mask at the item's centre.
private func parityEffectiveOpacity(ancestors: Double, gradients: [TVParityGradient], rect: CGRect) -> Double {
    let centre = CGPoint(x: rect.midX, y: rect.midY)
    return gradients.reduce(ancestors) { $0 * ($1.color == nil ? $1.alpha(at: centre) : 1) }
}

/// `base` with every ancestor scrim over it at the item's centre: the colour a box or a text run really sits on.
private func parityComposite(_ base: Color, gradients: [TVParityGradient], rect: CGRect, in environment: EnvironmentValues) -> Color {
    let centre = CGPoint(x: rect.midX, y: rect.midY)
    let first = base.resolve(in: environment)
    var (red, green, blue) = (first.red, first.green, first.blue)
    for gradient in gradients {
        guard let color = gradient.color else { continue }
        let top = color.resolve(in: environment)
        let a = Float(gradient.alpha(at: centre)) * top.opacity
        (red, green, blue) = (top.red * a + red * (1 - a), top.green * a + green * (1 - a), top.blue * a + blue * (1 - a))
    }
    return Color(.sRGB, red: Double(red), green: Double(green), blue: Double(blue))
}

/// Applies a gradient mask and records it for the items inside (the frame is the masked view's, read from the rendered layout).
private struct TVParityMaskModifier: ViewModifier {
    let horizontal: Bool
    let stops: (CGFloat) -> [(Double, Double)]
    @Environment(\.parityGradients) private var inherited
    @State private var frame = CGRect.zero

    private func gradient(_ length: CGFloat) -> LinearGradient {
        LinearGradient(stops: stops(length).map { .init(color: .black.opacity($0.1), location: $0.0) },
                       startPoint: horizontal ? .leading : .top, endPoint: horizontal ? .trailing : .bottom)
    }

    func body(content: Content) -> some View {
        content
            .mask { GeometryReader { proxy in gradient(horizontal ? proxy.size.width : proxy.size.height) } }
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { frame = proxy.frame(in: tvScreenSpace) }
                        .onChange(of: proxy.frame(in: tvScreenSpace)) { _, new in frame = new }
                }
            )
            .environment(\.parityGradients, inherited + [TVParityGradient(horizontal: horizontal, frame: frame,
                stops: stops(horizontal ? frame.width : frame.height).map { .init(location: $0.0, alpha: $0.1) }, color: nil)])
    }
}

/// Records a scrim an ancestor lays over its siblings' backdrop (drawn by a sibling view, so the frame is the design's).
private struct TVParityScrimModifier: ViewModifier {
    let gradient: TVParityGradient
    @Environment(\.parityGradients) private var inherited
    func body(content: Content) -> some View { content.environment(\.parityGradients, inherited + [gradient]) }
}

private struct TVParityOpacityModifier: ViewModifier {
    let value: Double
    @Environment(\.parityOpacity) private var inherited
    func body(content: Content) -> some View {
        content.opacity(value).environment(\.parityOpacity, inherited * value)
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
    let report: ([CGRect], [String]) -> Void

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        for line in layout { context.draw(line) }
        // each line's string is what SwiftUI placed on it: the segments (words) carried by its glyph runs, in order
        let strings = layout.map { line -> String in
            var parts: [String] = []
            for run in line {
                if let segment = run[TVParitySegment.self]?.string, parts.last != segment { parts.append(segment) }
            }
            return parts.joined().trimmingCharacters(in: .whitespaces)
        }
        report(layout.map { $0.typographicBounds.rect }, strings)
    }
}

/// A word of a wrapped paragraph, attached to its glyph runs so the layout export can read each line's real string.
@available(tvOS 18.0, macOS 15.0, *)
private struct TVParitySegment: TextAttribute {
    let string: String
}

extension Text {
    /// The same text as `Text(string)`, built from word segments that carry their own string, so the parity export can read the
    /// string SwiftUI drew on each wrapped line. Drawing is unchanged.
    static func parityWrapped(_ string: String) -> Text {
        guard #available(tvOS 18.0, macOS 15.0, *) else { return Text(string) }
        var words: [String] = []
        var current = ""
        for ch in string {
            current.append(ch)
            if ch == " " || ch == "\n" { words.append(current); current = "" }
        }
        if !current.isEmpty { words.append(current) }
        return words.reduce(Text("")) { $0 + Text($1).customAttribute(TVParitySegment(string: $1)) }
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
    @Environment(\.parityGradients) private var gradients
    @Environment(\.parityOpacity) private var ancestorOpacity
    @Environment(\.colorScheme) private var scheme
    @State private var id = UUID()
    private let hide = TVParityHide.shared

    private func hex(_ color: Color) -> String {
        let r = color.resolve(in: environment)
        func byte(_ value: Float) -> Int { max(0, min(255, Int((value * 255).rounded()))) }
        let base = String(format: "#%02x%02x%02x", byte(r.red), byte(r.green), byte(r.blue))
        return r.opacity < 0.999 ? base + String(format: "%02x", byte(r.opacity)) : base
    }

    private func behind(_ rect: CGRect) -> Color {
        let flat = over ?? backdrop ?? (onPage ? DesignTokens.Stage.bg : DesignTokens.Stage.surface)
        let base = over == nil ? parityComposite(flat, gradients: gradients, rect: rect, in: environment) : flat
        guard let fill else { return base }
        let top = fill.resolve(in: environment)
        let under = base.resolve(in: environment)
        let a = Float(fillAlpha) * top.opacity
        return Color(.sRGB, red: Double(top.red * a + under.red * (1 - a)), green: Double(top.green * a + under.green * (1 - a)), blue: Double(top.blue * a + under.blue * (1 - a)))
    }

    private func item(_ rect: CGRect, scale: CGFloat) -> TVParityLayoutRegistry.Item {
        .init(text: text, role: role, size: size, weight: weight, color: color.map(hex), rect: rect, tracking: tracking,
              background: hex(behind(rect)), radius: radius, lines: lines, layer: layer,
              opacity: parityEffectiveOpacity(ancestors: ancestorOpacity, gradients: gradients, rect: rect), scale: scale)
    }

    @ViewBuilder
    private func rendered(_ content: Content) -> some View {
        if #available(tvOS 18.0, macOS 15.0, *), text != nil, size != nil {
            content.textRenderer(TVParityTextRenderer { bounds, strings in
                let key = id
                Task { @MainActor in TVParityLayoutRegistry.shared.setLines(key, bounds, texts: strings) }
            })
        } else {
            content
        }
    }

    func body(content: Content) -> some View {
        rendered(content)
            .accessibilityAddTraits(role == "heading" ? .isHeader : []) // the role declared to the export is the one the app reports
            .opacity(hide.hidden.contains(id) ? 0 : 1)
            .animation(nil, value: hide.hidden.contains(id)) // the measurement hides without any ancestor animation
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
                        .onChange(of: gradients) { _, _ in report(frame, scale) }
                        .onChange(of: ancestorOpacity) { _, _ in report(frame, scale) }
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
    @Environment(\.parityGradients) private var gradients
    @Environment(\.parityOpacity) private var ancestorOpacity
    @Environment(\.colorScheme) private var scheme
    @Environment(\.parityLayer) private var layer
    @State private var id = UUID()
    private let hide = TVParityHide.shared

    func body(content: Content) -> some View {
        content
            .opacity(hide.hidden.contains(id) ? 0 : 1)
            .animation(nil, value: hide.hidden.contains(id)) // the measurement hides without any ancestor animation
            .background(
                GeometryReader { proxy in
                    let frame = proxy.frame(in: tvScreenSpace)
                    Color.clear
                        .onAppear { report(frame) }
                        .onChange(of: frame) { _, new in report(new) }
                        .onChange(of: build(.zero)) { _, _ in report(frame) }
                        .onChange(of: gradients) { _, _ in report(frame) }
                        .onChange(of: ancestorOpacity) { _, _ in report(frame) }
                }
                .ignoresSafeArea(edges: bleed ? .all : [])
            )
            .environment(\.parityBackdrop, painted(.zero, scrims: false))
            .transformEnvironment(\.parityGradients) { all in
                if solid { all.removeAll { $0.color != nil } } // an opaque fill covers the scrims that were under it
            }
            .onDisappear { TVParityLayoutRegistry.shared.remove(id) }
    }

    /// The colour this box paints on screen: its fill at `alpha` (times the fill's own opacity and the ancestors') composited over
    /// what is behind it: the backdrop (the page background by default) with the ancestor scrims over it at the box's centre.
    private var solid: Bool { fill != nil && Float(alpha) * (fill?.resolve(in: environment).opacity ?? 1) * Float(ancestorOpacity) >= 0.999 }

    private func painted(_ frame: CGRect, scrims: Bool = true) -> Color? {
        guard let fill else { return backdrop }
        let top = fill.resolve(in: environment)
        let a = Float(alpha) * top.opacity * Float(ancestorOpacity)
        guard a < 0.999 else { return Color(.sRGB, red: Double(top.red), green: Double(top.green), blue: Double(top.blue)) }
        let flat = backdrop ?? DesignTokens.Stage.bg
        let base = (scrims ? parityComposite(flat, gradients: gradients, rect: frame, in: environment) : flat).resolve(in: environment)
        return Color(.sRGB, red: Double(top.red * a + base.red * (1 - a)), green: Double(top.green * a + base.green * (1 - a)), blue: Double(top.blue * a + base.blue * (1 - a)))
    }

    private func report(_ frame: CGRect) {
        TVParityLayoutRegistry.shared.set(id, build(frame))
    }

    private func build(_ frame: CGRect) -> TVParityLayoutRegistry.Item {
        var item = TVParityLayoutRegistry.Item(text: text, role: role, rect: frame)
        if let painted = painted(frame) {
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
        item.opacity = opacity * parityEffectiveOpacity(ancestors: ancestorOpacity, gradients: gradients, rect: frame)
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

    /// A gradient mask (black at each stop's alpha, stops as `(location, alpha)` for a given length along the axis). Release builds
    /// draw the same mask; debug builds also record it so the items inside report what the mask leaves of them.
    @ViewBuilder
    func parityFadeMask(horizontal: Bool, stops: @escaping (CGFloat) -> [(Double, Double)]) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityMaskModifier(horizontal: horizontal, stops: stops))
        #else
        mask {
            GeometryReader { proxy in
                LinearGradient(stops: stops(horizontal ? proxy.size.width : proxy.size.height).map { .init(color: .black.opacity($0.1), location: $0.0) },
                               startPoint: horizontal ? .leading : .top, endPoint: horizontal ? .trailing : .bottom)
            }
        }
        #endif
    }

    /// Declares a scrim a sibling view draws over the backdrop of the items inside (debug builds only): `color` at each stop's alpha
    /// over `frame` (screen space), stops as `(location, alpha)`.
    @ViewBuilder
    func parityScrim(_ color: Color, horizontal: Bool = false, frame: CGRect, stops: [(Double, Double)]) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityScrimModifier(gradient: TVParityGradient(horizontal: horizontal, frame: frame, stops: stops.map { .init(location: $0.0, alpha: $0.1) }, color: color)))
        #else
        self
        #endif
    }

    /// `opacity(_:)` that also tells the items inside how much of them the ancestors leave (debug builds record the product).
    @ViewBuilder
    func parityOpacity(_ value: Double) -> some View {
        #if DEBUG && (os(tvOS) || os(macOS))
        modifier(TVParityOpacityModifier(value: value))
        #else
        opacity(value)
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
