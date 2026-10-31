import SwiftUI
import UIKit

/// Parity layout export (docs/parity/LAYOUT.md). Views that opt in with `.parityLayout(...)` report their own style
/// values (text, size, weight, colour) and their frame in the app window; the registry writes them to
/// Documents/parity-layout.json, which the simulator driver copies next to the screenshot. Compiled out of Release.
#if DEBUG
/// The views whose drawing the visibility probe currently hides (opacity 0, layout unchanged).
@Observable
@MainActor
final class ParityHide {
    static let shared = ParityHide()
    var ids: Set<UUID> = []
    /// UIKit views that draw a reported element (a measured label) cannot read `ids` through SwiftUI; they hide themselves here.
    @ObservationIgnored var hooks: [UUID: @MainActor () -> Void] = [:]

    func apply(_ hidden: Set<UUID>) {
        ids = hidden
        for hook in hooks.values { hook() }
    }
}

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
        /// The composited colour behind the view before its own fill (where it paints one); `nil` when `background` already is that.
        var outer: String?
        var radius: CGFloat = 0
        /// Product of the ancestors' opacity and mask alpha at this element (docs/parity/LAYOUT.md `opacity`).
        var opacity: Double = 1
        /// True when the view paints its own fill (so its `background` includes that fill).
        var painted = false
        /// Belongs to a covering layer's own content (a drawer), so that layer does not hide it.
        var inCover = false
        /// The view whose opacity the visibility probe toggles to see whether this element draws pixels, and the line within it.
        var toggle: UUID?
        var slot = 0
    }

    struct ProbeKey: Hashable {
        let id: UUID
        let slot: Int
    }

    private var items: [UUID: Item] = [:]
    private var textRuns: [UUID: [Item]] = [:]
    private var order: [UUID] = []
    private var pending: Task<Void, Never>?
    /// Views currently on screen: a text run reported after its view left (queued draw callback) is dropped.
    private var alive: Set<UUID> = []

    /// Measured frames of the opaque layers currently drawn over content (see `parityCoverLayer`).
    var coverRegions: [UUID: CGRect] = [:]
    /// What the ancestors of a tagged accessibility container do to its pixels (opacity, clips, edge masks).
    private var paintRegions: [UUID: ParityPaint] = [:]
    /// Frames of controls that can be hidden through `parityToggle` (buttons and links without a styled box of their own).
    private var toggleFrames: [UUID: CGRect] = [:]
    /// The composited colour behind each toggled view (what the web reports as the background of a control that paints none).
    private var toggleBackdrops: [UUID: String] = [:]
    /// A control that has no toggle of its own is judged through the views drawn inside its frame: the probe hides all of
    /// them together under one group id. The ids are kept so the two snapshots of one probe agree on them.
    private var groupIDs: [String: UUID] = [:]
    private(set) var groups: [UUID: [UUID]] = [:]
    nonisolated static let paintIdentifierPrefix = "parity-paint-"

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
        var item = item
        item.toggle = id; item.slot = 0
        guard items[id] != item else { return }
        if items[id] == nil { order.append(id) }
        items[id] = item
        schedule()
    }

    func setTextRuns(_ id: UUID, _ runs: [Item]) {
        _ = Self.enableAccessibility
        let runs = runs.enumerated().map { index, run -> Item in var run = run; run.toggle = id; run.slot = index; return run }
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

    func setToggle(_ id: UUID, _ frame: CGRect?, backdrop: String? = nil) {
        guard toggleFrames[id] != frame || toggleBackdrops[id] != backdrop else { return }
        toggleFrames[id] = frame
        toggleBackdrops[id] = backdrop
        schedule()
    }

    func setPaint(_ id: UUID, _ paint: ParityPaint?) {
        guard paintRegions[id] != paint else { return }
        paintRegions[id] = paint
        schedule()
    }

    func remove(_ id: UUID) {
        alive.remove(id)
        toggleFrames[id] = nil
        toggleBackdrops[id] = nil
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
                let current = self.snapshot().data
                if current == previous { if let final = await self.probe() { self.write(final) }; return }
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
        let screenBounds = window.bounds
        var visited = 0
        func visit(_ object: NSObject, depth: Int, paint: ParityPaint? = nil) {
            var paint = paint
            // SwiftUI's accessibility nodes do not declare the identification protocol, so the identifier is read by selector.
            let identifier = Self.identifier(of: object)
            if let identifier, identifier.hasPrefix(Self.paintIdentifierPrefix),
               let id = UUID(uuidString: String(identifier.dropFirst(Self.paintIdentifierPrefix.count))), let region = paintRegions[id] {
                paint = region
            }
            guard visited < 4000, depth < 40 else { return }
            if let view = object as? UIView, view.isHidden || view.alpha <= 0 { return }
            // Parity-only probes (readiness flags) are not content.
            if identifier?.hasPrefix("parity.") == true { return }
            visited += 1
            if object.isAccessibilityElement {
                let traits = object.accessibilityTraits
                var role = "container"
                if traits.contains(.searchField) { role = "textbox" }
                else if traits.contains(.adjustable) { role = "slider" }
                else if traits.contains(.link) { role = "link" }
                else if traits.contains(.button) { role = "button" }
                else if traits.contains(.header) { role = "heading" }
                else if traits.contains(.image) { role = "image" }
                else if traits.contains(.staticText) { role = "text" }
                else if traits.contains(.tabBar) { role = "tab" }
                let frame = object.accessibilityFrame
                // A text field's content is its accessibility value; every other entry is named by its label.
                let label = (role == "textbox" ? object.accessibilityValue : nil) ?? object.accessibilityLabel ?? ""
                var entry = Item(text: label.isEmpty ? nil : label, role: role, size: nil, weight: nil, color: nil, rect: frame)
                // What the ancestors do to its pixels (opacity, edge masks, clips) comes from the tagged container it sits in.
                if let paint, frame.intersects(screenBounds) {
                    // Whether clips or masks leave any pixel of it is decided by the visibility probe, not by this geometry.
                    entry.opacity = paint.effective(frame) ?? paint.opacity
                }
                found.append(entry)
                return
            }
            let count = object.accessibilityElementCount()
            if count != NSNotFound, count > 0 {
                for index in 0..<count { if let child = object.accessibilityElement(at: index) as? NSObject { visit(child, depth: depth + 1, paint: paint) } }
                return
            }
            if let elements = object.accessibilityElements as? [NSObject], !elements.isEmpty {
                for child in elements { visit(child, depth: depth + 1, paint: paint) }
            }
            if let view = object as? UIView { for sub in view.subviews { visit(sub, depth: depth + 1, paint: paint) } }
        }
        visit(window, depth: 0)
        return found
    }

    private static func identifier(of object: NSObject) -> String? {
        guard object.responds(to: NSSelectorFromString("accessibilityIdentifier")) else { return nil }
        return object.value(forKey: "accessibilityIdentifier") as? String
    }

    /// Every exported element with the view that can hide it, and the document built from the ones in `visible` (all when nil).
    private func snapshot(visible: Set<ProbeKey>? = nil) -> (data: Data?, candidates: [Item], dropped: Int) {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return (nil, [], 0) }
        let screen = window.bounds
        let styled = order.flatMap { id -> [Item] in
            if let runs = textRuns[id] { return runs }
            return items[id].map { [$0] } ?? []
        }
        // Styled text lines are the only text in the export: an accessibility text or heading entry is a widget frame, not a
        // glyph run, so it never stands in for a line. Controls keep their frame and accessible name.
        let walked = accessibilityElements()
        let plain = walked.filter { entry in
            if entry.role == "text" || entry.role == "heading" { return false }
            // The same control: the styled record lies inside the accessibility frame (a focus ring widens only the latter).
            return !styled.contains(where: { $0.text == entry.text && $0.role == entry.role && entry.rect.insetBy(dx: -2, dy: -2).contains($0.rect) && entry.rect.width - $0.rect.width < 16 && entry.rect.height - $0.rect.height < 16 })
        }
        // A native control takes the fill and radius of the painted box of its own role registered on its own frame (the
        // control's own paint); with no such box its background is not known and stays null. Containment is never used.
        let boxes = styled.filter { $0.painted && $0.text == nil && $0.size == nil }
        func sameFrame(_ a: CGRect, _ b: CGRect) -> Bool {
            abs(a.minX - b.minX) < 1.5 && abs(a.minY - b.minY) < 1.5 && abs(a.width - b.width) < 1.5 && abs(a.height - b.height) < 1.5
        }
        func distance(_ a: CGRect, _ b: CGRect) -> CGFloat { abs(a.minX - b.minX) + abs(a.minY - b.minY) + abs(a.width - b.width) + abs(a.height - b.height) }
        var ownBoxes: [Item] = []
        groups = [:]
        let backed = plain.map { entry -> Item in
            var entry = entry
            let candidates = boxes.filter { $0.role == entry.role && sameFrame($0.rect, entry.rect) && !ownBoxes.contains($0) }
            if let own = candidates.min(by: { distance($0.rect, entry.rect) < distance($1.rect, entry.rect) }) {
                entry.background = own.background; entry.radius = own.radius; entry.opacity = min(entry.opacity, own.opacity)
                entry.toggle = own.toggle
                ownBoxes.append(own)
            } else if let target = toggleFrames.filter({ distance($0.value, entry.rect) < 6 }).min(by: { distance($0.value, entry.rect) < distance($1.value, entry.rect) }) {
                // A control without a styled box: the view that draws it carries a `parityToggle`, found by its frame.
                entry.toggle = target.key
                // A control that paints nothing of its own sits on whatever is behind it, as in the web export.
                if entry.background == nil { entry.background = toggleBackdrops[target.key] }
                // The control's own container carries the ancestors' opacity: an artwork image reports it from there.
                if entry.opacity >= 0.995, let paint = paintRegions[target.key] { entry.opacity = paint.effective(entry.rect) ?? paint.opacity }
            } else if entry.rect.width > 1, entry.rect.height > 1 {
                // A control drawn by the views inside its frame (a menu, a card, a letter): hiding all of them is hiding it.
                let box = entry.rect.insetBy(dx: -1.5, dy: -1.5)
                var inside = Set<UUID>()
                for (id, frame) in toggleFrames where frame.width > 0 && box.contains(frame) { inside.insert(id) }
                for (id, item) in items where box.contains(item.rect) { inside.insert(id) }
                for (id, runs) in textRuns where runs.contains(where: { box.contains($0.rect) }) { inside.insert(id) }
                if !inside.isEmpty {
                    // A control that paints nothing of its own reports what is painted behind it (the web backdrop: ancestors
                    // only, never a child's own fill). Taken from the largest view inside it, before that view's own fill.
                    if entry.background == nil {
                        var best: (area: CGFloat, colour: String?) = (0, nil)
                        func consider(_ rect: CGRect, _ colour: String?) {
                            guard let colour, rect.width * rect.height > best.area else { return }
                            best = (rect.width * rect.height, colour)
                        }
                        for (id, frame) in toggleFrames where inside.contains(id) && frame.width > 0 { consider(frame, toggleBackdrops[id]) }
                        for (id, item) in items where inside.contains(id) {
                            consider(item.rect, item.outer ?? item.background)
                        }
                        for (id, runs) in textRuns where inside.contains(id) { for run in runs { consider(run.rect, run.background) } }
                        entry.background = best.colour
                    }
                    let key = String(format: "%@|%@|%.1f|%.1f|%.1f|%.1f", entry.role, entry.text ?? "", entry.rect.minX, entry.rect.minY, entry.rect.width, entry.rect.height)
                    let group = groupIDs[key] ?? UUID()
                    groupIDs[key] = group
                    groups[group] = inside.sorted { $0.uuidString < $1.uuidString }
                    entry.toggle = group
                }
            }
            return entry
        }
        let remaining = styled.filter { item in !ownBoxes.contains { $0 == item } }
        // Whether an element is visible is decided by toggling the view that draws it and diffing the real screen (`probe`).
        var all = (remaining + backed).filter { $0.text != nil || $0.size == nil }
        let viewport = CGRect(origin: .zero, size: screen.size)
        all = all.filter { $0.rect.intersects(viewport) && $0.rect.width > 1 && $0.rect.height > 1 }
        all.sort { ($0.rect.minY, $0.rect.minX, $0.text ?? "", $0.role) < ($1.rect.minY, $1.rect.minX, $1.text ?? "", $1.role) }
        let candidates = all
        var occluded = 0
        if let visible {
            // An element nothing can toggle is left out of the export (never counted visible from its geometry).
            all = all.filter { item in
                let shown = item.toggle.map { visible.contains(ProbeKey(id: $0, slot: item.slot)) } ?? false
                if !shown { occluded += 1 }
                return shown
            }
        }
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
            "occluded": occluded,
            "elements": elements,
        ]
        return (try? JSONSerialization.data(withJSONObject: document, options: [.sortedKeys]), candidates, occluded)
    }

    // MARK: visibility probe

    /// A frame of the real window as RGBA bytes at screen scale.
    private struct Shot {
        var bytes: [UInt8]
        let width: Int
        let height: Int
        let scale: CGFloat
    }

    private func capture(_ window: UIWindow) -> Shot? {
        let scale = window.screen.scale
        let width = Int((window.bounds.width * scale).rounded()), height = Int((window.bounds.height * scale).rounded())
        guard width > 0, height > 0 else { return nil }
        var bytes = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = bytes.withUnsafeMutableBytes { raw -> Bool in
            guard let context = CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                                          space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            context.translateBy(x: 0, y: CGFloat(height))
            context.scaleBy(x: scale, y: -scale)
            UIGraphicsPushContext(context)
            defer { UIGraphicsPopContext() }
            return window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        return drawn ? Shot(bytes: bytes, width: width, height: height, scale: scale) : nil
    }

    /// Largest per-channel difference of two RGBA pixels (anti-aliasing and dithering noise stays far below hiding a real layer).
    private static func channelDelta(_ a: UInt32, _ b: UInt32) -> Int {
        var largest = 0
        for shift in stride(from: 0, to: 24, by: 8) { largest = max(largest, abs(Int((a >> UInt32(shift)) & 0xff) - Int((b >> UInt32(shift)) & 0xff))) }
        return largest
    }

    /// Number of pixels inside `rect` that differ between `hidden` and `base` and between `hidden` and `after`, where
    /// `base` and `after` agree (so animation and moving video never count; the player is paused when it is captured).
    private func changedCount(_ rect: CGRect, hidden: Shot, base: Shot, after: Shot) -> Int {
        let s = hidden.scale
        let x0 = max(0, Int((rect.minX * s).rounded(.down))), x1 = min(hidden.width, Int((rect.maxX * s).rounded(.up)))
        let y0 = max(0, Int((rect.minY * s).rounded(.down))), y1 = min(hidden.height, Int((rect.maxY * s).rounded(.up)))
        guard x1 > x0, y1 > y0 else { return 0 }
        var strong = 0, faint = 0
        hidden.bytes.withUnsafeBytes { ph in base.bytes.withUnsafeBytes { pb in after.bytes.withUnsafeBytes { pa in
            let wh = ph.bindMemory(to: UInt32.self), wb = pb.bindMemory(to: UInt32.self), wa = pa.bindMemory(to: UInt32.self)
            for y in y0..<y1 {
                let row = y * hidden.width
                for x in x0..<x1 where wb[row + x] == wa[row + x] && wh[row + x] != wb[row + x] {
                    faint += 1
                    if Self.channelDelta(wh[row + x], wb[row + x]) >= 12 { strong += 1 }
                }
            }
        } } }
        // Clear changes (12 levels) in 6 pixels, or a faint layer (a low-strength backdrop, a dot behind frosted glass) that
        // shifts a quarter of its own pixels by any amount. A handful of 1-level pixels is render noise, not a layer.
        if strong >= 6 { return strong }
        return faint >= 6 && faint * 4 >= (x1 - x0) * (y1 - y0) ? faint : 0
    }

    /// Toggle-and-diff on the real screen: each element's view is hidden through the parity hook, the window is rendered
    /// again, and the element counts as visible only when pixels change inside its own frame. Elements are hidden in
    /// batches of mutually disjoint frames. Each batch runs twice (hide, settle, capture, show, settle, capture) and an
    /// element is visible only when both rounds change pixels against the frame before and the frame after.
    /// Returns the finished document, or nil when the probe could not run.
    private func probe() async -> Data? {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else { return nil }
        let candidates = snapshot().candidates.filter { $0.toggle != nil }
        ParityLaunch.record("layoutProbing", true)
        ParityHide.shared.apply([])
        defer { ParityHide.shared.apply([]); ParityLaunch.record("layoutProbing", false) }
        var visible = Set<ProbeKey>()
        var log: [[String: Any]] = []
        let settle: UInt64 = 250_000_000
        if !candidates.isEmpty {
            try? await Task.sleep(nanoseconds: settle)
            guard var base = capture(window) else { return nil }
            var byID: [UUID: [Item]] = [:], idOrder: [UUID] = []
            for item in candidates { if let id = item.toggle { if byID[id] == nil { idOrder.append(id) }; byID[id, default: []].append(item) } }
            func union(_ items: [Item]) -> CGRect { items.dropFirst().reduce(items[0].rect) { $0.union($1.rect) }.insetBy(dx: -2, dy: -2) }
            var batches: [(ids: [UUID], union: [CGRect])] = []
            for id in idOrder {
                let area = union(byID[id]!)
                if let index = batches.firstIndex(where: { batch in !batch.union.contains { $0.intersects(area) } }) {
                    batches[index].ids.append(id); batches[index].union.append(area)
                } else { batches.append(([id], [area])) }
            }
            for batch in batches {
                var counts: [ProbeKey: [Int]] = [:]
                var batchLog: [[Int]] = []
                for round in 0..<2 {
                    guard !Task.isCancelled else { return nil }
                    ParityHide.shared.apply(Set(batch.ids.flatMap { groups[$0] ?? [$0] }))
                    try? await Task.sleep(nanoseconds: settle)
                    guard let hidden = capture(window) else { return nil }
                    ParityHide.shared.apply([])
                    try? await Task.sleep(nanoseconds: settle)
                    guard let after = capture(window) else { return nil }
                    // Diagnostics for the probe log: pixels of the whole window that the hide changed, and that moved by themselves.
                    var hideDelta = 0, selfMoved = 0
                    hidden.bytes.withUnsafeBytes { ph in base.bytes.withUnsafeBytes { pb in after.bytes.withUnsafeBytes { pa in
                        let wh = ph.bindMemory(to: UInt32.self), wb = pb.bindMemory(to: UInt32.self), wa = pa.bindMemory(to: UInt32.self)
                        for i in 0..<min(wh.count, wb.count, wa.count) { if wh[i] != wb[i] { hideDelta += 1 }; if wb[i] != wa[i] { selfMoved += 1 } }
                    } } }
                    batchLog.append([hideDelta, selfMoved])
                    for id in batch.ids { for item in byID[id]! {
                        let key = ProbeKey(id: id, slot: item.slot)
                        var row = counts[key] ?? [0, 0]
                        row[round] = max(row[round], changedCount(item.rect, hidden: hidden, base: base, after: after))
                        counts[key] = row
                    } }
                    base = after
                }
                for id in batch.ids { for item in byID[id]! {
                    let c = counts[ProbeKey(id: id, slot: item.slot)] ?? []
                    if c.count == 2, c.allSatisfy({ $0 >= 6 }) { visible.insert(ProbeKey(id: id, slot: item.slot)) }
                    log.append(["role": item.role, "text": item.text ?? "", "x": Int(item.rect.minX), "y": Int(item.rect.minY), "w": Int(item.rect.width), "h": Int(item.rect.height), "counts": c, "hide": batchLog.map { $0[0] }, "moved": batchLog.map { $0[1] }])
                } }
            }
            ParityHide.shared.apply([])
            // Elements nothing could hide are dropped from the export; list them (counts -1) so a missing toggle is visible.
            for item in snapshot().candidates where item.toggle == nil {
                log.append(["role": item.role, "text": item.text ?? "", "x": Int(item.rect.minX), "y": Int(item.rect.minY), "w": Int(item.rect.width), "h": Int(item.rect.height), "counts": [-1, -1]])
            }
            ParityLaunch.record("layoutProbeCounts", log)
            // A probe in which nothing changed means the hook did not work, not that nothing is visible.
            if visible.isEmpty { return nil }
        }
        guard !Task.isCancelled else { return nil }
        return snapshot(visible: visible).data
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
    var factor: Double
}

struct ParityPaint: Equatable {
    var opacity = 1.0
    var clips: [CGRect] = []
    var fades: [ParityFade] = []
    var scales: [ParityScale] = []

    /// Product of the ancestors' scale factors. A frame read in the global space already includes the transform; only
    /// quantities in a view's own space (line offsets, font sizes, radii) follow this factor.
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
        if scale != 1 { paint.scales.append(ParityScale(factor: scale)) }
        if frame.width > 0 {
            if clip { paint.clips.append(frame) }
            if let fade {
                let stops = fade(frame.size).map { SIMD2(Double($0.location), Double($0.color.resolve(in: environment).opacity)) }
                paint.fades.append(ParityFade(rect: frame, horizontal: horizontal, stops: stops))
            }
        }
        let tagged = scale == 1
        return content
            .environment(\.parityPaint, paint)
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { frame = proxy.frame(in: .global) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in frame = value }
            })
            // The accessibility controls inside read their opacity, clip and mask from this container.
            .modifier(ParityPaintTag(enabled: tagged, paint: paint))
    }
}

private struct ParityPaintTag: ViewModifier {
    let enabled: Bool
    let paint: ParityPaint
    @State private var id = UUID()

    func body(content: Content) -> some View {
        if enabled {
            content
                .opacity(ParityHide.shared.ids.contains(id) ? 0 : 1)
                .background(GeometryReader { proxy in
                    Color.clear
                        .onAppear { ParityLayoutRegistry.shared.setToggle(id, proxy.frame(in: .global)) }
                        .onChange(of: proxy.frame(in: .global)) { _, value in ParityLayoutRegistry.shared.setToggle(id, value) }
                })
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(ParityLayoutRegistry.paintIdentifierPrefix + id.uuidString)
                .onAppear { ParityLayoutRegistry.shared.setPaint(id, paint) }
                .onChange(of: paint) { _, value in ParityLayoutRegistry.shared.setPaint(id, value) }
                .onDisappear { ParityLayoutRegistry.shared.setPaint(id, nil); ParityLayoutRegistry.shared.setToggle(id, nil) }
        } else {
            content
        }
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
    /// Measured over the whole window, safe areas included (the web body covers the viewport).
    var bleed = false
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
            .opacity(ParityHide.shared.ids.contains(id) ? 0 : 1)
            .environment(\.parityBackdrop, box.map { environment.parityBackdrop.adding($0, environment) } ?? environment.parityBackdrop)
            .background(
                GeometryReader { proxy in
                    Color.clear
                        .onAppear { frame = proxy.frame(in: .global); report(frame) }
                        .onChange(of: proxy.frame(in: .global)) { _, new in frame = new; report(new) }
                }
                .ignoresSafeArea(edges: bleed ? .all : [])
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
        let drawn = frame // the global frame already includes ancestors' transforms
        guard enabled, frame.width > 0 else { ParityLayoutRegistry.shared.remove(id); return }
        // Offscreen content is not on screen; whether anything on screen is drawn is decided by the visibility probe.
        guard drawn.intersects(CGRect(origin: .zero, size: UIScreen.main.bounds.size)) else { ParityLayoutRegistry.shared.remove(id); return }
        let opacity = paint.effective(drawn) ?? paint.opacity
        ParityLayoutRegistry.shared.set(id, .init(text: text, role: role, size: size.map { $0 * CGFloat(paint.scale) }, weight: weight, color: hex, rect: drawn, tracking: tracking, background: (box.map { environment.parityBackdrop.adding($0, environment) } ?? environment.parityBackdrop).rgb(at: CGPoint(x: drawn.midX, y: drawn.midY), environment).hex, outer: environment.parityBackdrop.rgb(at: CGPoint(x: drawn.midX, y: drawn.midY), environment).hex, radius: radius * CGFloat(paint.scale), opacity: opacity, painted: box != nil, inCover: environment.parityInCover))
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
        // Characters the line draws must be contiguous (whitespace aside); a line that is not is not read back at all.
        let drawn = Set(line.indices).sorted()
        // A ligature ("fi") is one glyph carrying one index, so a single skipped letter is part of the glyph just drawn.
        guard zip(drawn, drawn.dropFirst()).allSatisfy({ $1 - $0 == 1 || characters[($0 + 1)..<$1].allSatisfy(\.isWhitespace) || ($1 - $0 == 2 && characters[$0 + 1].isLetter) }) else { return "" }
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
            .opacity(ParityHide.shared.ids.contains(id) ? 0 : 1)
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
        let factor = CGFloat(paint.scale)
        let runs = lines.enumerated().compactMap { index, line -> ParityLayoutRegistry.Item? in
            // The line rectangle is in the text view's own space and the frame origin is global (already transformed), so
            // the offset inside the view follows the ancestors' scale.
            let rect = CGRect(x: frame.minX + line.rect.minX * factor, y: frame.minY + line.rect.minY * factor, width: line.rect.width * factor, height: line.rect.height * factor)
            let background = environment.parityBackdrop.rgb(at: CGPoint(x: rect.midX, y: rect.midY), environment).hex
            guard rect.intersects(CGRect(origin: .zero, size: UIScreen.main.bounds.size)) else { return nil }
            let opacity = paint.effective(rect) ?? paint.opacity
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

/// Makes a control hideable by the visibility probe: its view fades to nothing while the probe renders without it.
private struct ParityToggleModifier: ViewModifier {
    @State private var id = UUID()
    @Environment(\.self) private var environment

    private func backdrop(_ frame: CGRect) -> String {
        environment.parityBackdrop.rgb(at: CGPoint(x: frame.midX, y: frame.midY), environment).hex
    }

    func body(content: Content) -> some View {
        content
            .opacity(ParityHide.shared.ids.contains(id) ? 0 : 1)
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { ParityLayoutRegistry.shared.setToggle(id, proxy.frame(in: .global), backdrop: backdrop(proxy.frame(in: .global))) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in ParityLayoutRegistry.shared.setToggle(id, value, backdrop: backdrop(value)) }
                    .onChange(of: environment.parityBackdrop) { _, _ in ParityLayoutRegistry.shared.setToggle(id, proxy.frame(in: .global), backdrop: backdrop(proxy.frame(in: .global))) }
            })
            .onDisappear { ParityLayoutRegistry.shared.setToggle(id, nil) }
    }
}

/// A covering layer (a drawer): its measured frame hides what lies under it, and its own content is exempt.
private struct ParityCoverLayer: ViewModifier {
    @State private var id = UUID()

    func body(content: Content) -> some View {
        content
            .environment(\.parityInCover, true)
            // The layer paints its opaque surface into the safe areas, so its footprint is measured there too.
            .background(GeometryReader { proxy in
                Color.clear
                    .onAppear { ParityLayoutRegistry.shared.setCover(id, proxy.frame(in: .global)) }
                    .onChange(of: proxy.frame(in: .global)) { _, value in ParityLayoutRegistry.shared.setCover(id, value) }
            }.ignoresSafeArea())
            .onDisappear { ParityLayoutRegistry.shared.setCover(id, nil) }
    }
}

/// Content drawn above every covering layer (the floating navigation): not hidden by a drawer under it.
private struct ParityTopLayer: ViewModifier {
    func body(content: Content) -> some View { content.environment(\.parityInCover, true) }
}

#endif

extension View {
    /// `buttonStyle`, also making the control hideable for the visibility probe (debug builds only).
    func parityButtonStyle<S: PrimitiveButtonStyle>(_ style: S) -> some View {
        #if DEBUG
        buttonStyle(style).modifier(ParityToggleModifier())
        #else
        buttonStyle(style)
        #endif
    }

    func parityButtonStyle<S: ButtonStyle>(_ style: S) -> some View {
        #if DEBUG
        buttonStyle(style).modifier(ParityToggleModifier())
        #else
        buttonStyle(style)
        #endif
    }

    /// Makes this view hideable by the visibility probe, for a control or image no styled box or button style reports.
    func parityToggle() -> some View {
        #if DEBUG
        modifier(ParityToggleModifier())
        #else
        self
        #endif
    }

    /// Marks content drawn above the covering layers.
    func parityTopLayer() -> some View {
        #if DEBUG
        modifier(ParityTopLayer())
        #else
        self
        #endif
    }

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
    func parityLayout(text: String? = nil, role: String = "text", size: CGFloat? = nil, weight: Int? = nil, color: Color? = nil, tracking: CGFloat = 0, box: Color? = nil, radius: CGFloat = 0, enabled: Bool = true, bleed: Bool = false) -> some View {
        #if DEBUG
        modifier(ParityLayoutModifier(text: text, role: role, size: size, weight: weight, color: color, tracking: tracking, box: box, radius: radius, enabled: enabled, bleed: bleed))
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
    func parityBox(_ role: String, name: String? = nil, background: Color? = nil, radius: CGFloat = 0, enabled: Bool = true, bleed: Bool = false) -> some View {
        parityLayout(text: name, role: role, box: background, radius: radius, enabled: enabled, bleed: bleed)
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

    /// Marks a radial gradient painted over this view's frame (the same colours, centre and end radius as the drawn `RadialGradient`).
    func parityRadial(_ colors: [Color], center: UnitPoint, endRadius: CGFloat, in local: CGRect? = nil) -> some View {
        #if DEBUG
        let count = colors.count
        let stops = colors.enumerated().map { Gradient.Stop(color: $1, location: count > 1 ? CGFloat($0) / CGFloat(count - 1) : 0) }
        return modifier(ParityGradientModifier(gradient: Gradient(stops: stops), start: center, end: center, radius: endRadius, local: local))
        #else
        return self
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
