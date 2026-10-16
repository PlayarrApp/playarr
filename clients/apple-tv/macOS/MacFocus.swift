import AppKit
import SwiftUI

// Keyboard, mouse and hover for the TV layout on the Mac. tvOS has a spatial focus engine and a remote; macOS has
// neither, so this file supplies both: every Button in the module (shadowed below) is a focus target that hover
// focuses, and the arrow keys move focus geometrically between targets, the web TV's spatial rules.
//
// Keys: arrows move, Return selects, Shift+Return or a right click is the long press (actions), Escape or Delete is
// Back, Space is Play/Pause.

/// The coordinate space of the 1920x1080 stage, inside the window scale.
let macStageSpace = "playarr.macStage"

enum MacMoveDirection: Equatable { case up, down, left, right }

#if DEBUG
struct MacFocusMoveObservation {
    let registeredTargetCandidateCount: Int
    let chosenFrame: CGRect?
}

struct MacFocusKeyDiagnosticSample {
    enum ResponderCategory: String { case text, other }

    let direction: MacMoveDirection
    let responder: ResponderCategory
    let textEditingExcluded: Bool
    let beforeFocusedPresent: Bool
    let beforeFallbackFocusedPresent: Bool
    let beforeFallbackEqualsBefore: Bool
    let afterFocusedPresent: Bool
    let afterEqualsBefore: Bool
    let fallbackRan: Bool
    let registeredTargetCandidateCount: Int
    let chosenFrame: CGRect?
    let focusedBindingPresent: Bool
    let focusedBindingCount: Int

    func line(sequence: Int) -> String {
        let directionName: String
        switch direction {
        case .left: directionName = "left"
        case .right: directionName = "right"
        case .up: directionName = "up"
        case .down: directionName = "down"
        }
        let frame = chosenFrame.map {
            String(format: "%.1f,%.1f,%.1f,%.1f", Double($0.minX), Double($0.minY), Double($0.width), Double($0.height))
        } ?? "none"
        return "PlayarrMacFocusKey seq=\(sequence) direction=\(directionName) responder=\(responder.rawValue) " +
            "text_edit_excluded=\(textEditingExcluded) before_focused=\(beforeFocusedPresent) " +
            "before_fallback_focused_present=\(beforeFallbackFocusedPresent) " +
            "before_fallback_equals_before=\(beforeFallbackEqualsBefore) " +
            "after_focused=\(afterFocusedPresent) after_equals_before=\(afterEqualsBefore) fallback_ran=\(fallbackRan) " +
            "registered_target_candidates=\(registeredTargetCandidateCount) chosen_frame=\(frame) " +
            "focused_binding=\(focusedBindingPresent) focused_binding_count=\(focusedBindingCount)"
    }
}
#endif

@MainActor
final class MacFocusEngine {
    static let shared = MacFocusEngine()

    struct Target {
        var frame: CGRect
        var layer: Int
        var focus: () -> Void
        var parityID: String? = nil
        var parityRail: Int? = nil
        var parityIndex: Int? = nil
        var homeRailFocus = false
        var activate: (() -> Void)?
        /// The long press (a media card's actions).
        var secondary: (() -> Void)?
        /// Where focus starts when its layer opens (a drawer's close button), before the first page content.
        var preferred = false
        /// Named focus tag (`macFocusName`) of this target, and the one Down goes to from it (web: Down from Calendar's Today lands
        /// on Filters, not on the nearer Calendar link).
        var focusName: String? = nil
        var downTo: String? = nil
        /// The SwiftUI focus binding itself, for parity diagnostics independent of the state file tag.
        var isFocused: () -> Bool = { false }
    }

    private(set) var targets: [UUID: Target] = [:]
    private(set) var focusedID: UUID?
    private(set) var hoveredID: UUID?
    /// The last focused target per layer, so closing a cover returns focus where it was (tvOS does the same).
    private var lastFocused: [Int: UUID] = [:]
    private var lastFocusedHomeCard: TargetIdentity?
    struct TargetIdentity: Equatable {
        let parityID: String
        let rail: Int
        let index: Int
    }

    private var targetRegistrationObservers: [(UUID, (TargetIdentity?) -> Void)] = []
    /// Right from the nav can arrive before a lazy stage target registers; carry that entry intent through settle.
    private var pendingStageFocus = false
    private var pendingHomeCardRestore: TargetIdentity?

    func update(_ id: UUID, _ target: Target) {
        let previous = targets[id]
        let isNew = previous == nil
        targets[id] = target
        if isNew || previous?.parityID != target.parityID || previous?.parityRail != target.parityRail
            || previous?.parityIndex != target.parityIndex || previous?.layer != target.layer {
            if let identity = Self.identity(of: target) {
                for observer in targetRegistrationObservers.map(\.1) { observer(identity) }
            }
        }
        if isNew { scheduleSettle() }
        if isNew, target.layer > 0, pendingHomeCardRestore != nil { pendingHomeCardRestore = nil }
        // A preferred target that appears (a drawer's close button) takes focus once its layer has settled, even where
        // the system already focused another button.
        if isNew, target.preferred {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
                guard let self, let t = self.targets[id], t.layer == self.topLayer, self.focusedID != id else { return }
                self.autoFocusedID = id
                t.focus()
            }
        }
    }

    func remove(_ id: UUID) {
        guard targets[id] != nil else { return }
        targets[id] = nil
        for observer in targetRegistrationObservers.map(\.1) { observer(nil) }
        if hoveredID == id { hoveredID = nil }
        if focusedID == id {
            focusedID = nil
            pendingStageFocus = false
            scheduleSettle()
        }
    }

    func didFocus(_ id: UUID, _ focused: Bool) {
        if focused {
            if let pendingHomeCardRestore, targets[id].flatMap({ Self.identity(of: $0) }) != pendingHomeCardRestore {
                self.pendingHomeCardRestore = nil
            }
            pendingStageFocus = false
            focusedID = id
            if let target = targets[id] {
                lastFocused[target.layer] = id
                if target.homeRailFocus { lastFocusedHomeCard = Self.identity(of: target) }
            }
        } else if focusedID == id {
            focusedID = nil
        }
    }

    func didFocus(parityID: String, rail: Int, index: Int, focused: Bool) {
        if focused, topLayer != 0 { return }
        guard let id = targets.first(where: {
            $0.value.parityID == parityID && $0.value.parityRail == rail && $0.value.parityIndex == index
                && (!focused || $0.value.layer == 0)
        })?.key else { return }
        if !focused, focusedID != id { return }
        didFocus(id, focused)
    }

    func requestHomeCardRestore(parityID: String, rail: Int, index: Int) {
        let identity = TargetIdentity(parityID: parityID, rail: rail, index: index)
        guard lastFocusedHomeCard == identity else { return }
        pendingHomeCardRestore = identity
        if topLayer == 0 { attemptPendingHomeCardRestore() }
    }

    func cancelHomeCardRestore() { pendingHomeCardRestore = nil }

    private func attemptPendingHomeCardRestore() {
        guard let identity = pendingHomeCardRestore, topLayer == 0,
              let (id, target) = targets.first(where: {
                  $0.value.parityID == identity.parityID && $0.value.parityRail == identity.rail
                      && $0.value.parityIndex == identity.index && $0.value.layer == 0
              }) else { return }
        pendingHomeCardRestore = nil
        autoFocusedID = id
        target.focus()
    }

    /// Moves focus to the top layer's first page content (a grid entered from Back lands on its first card, not on
    /// whatever sits under a resting pointer).
    func focusFirstContent() {
        let layer = topLayer
        guard let (id, target) = first(in: targets.filter { $0.value.layer == layer }) else { return }
        autoFocusedID = id
        target.focus()
    }

    /// The work whose detail is open; its grid card takes focus back when the detail pops.
    var returnWorkID: UUID?
    /// Set when the detail has popped; a grid that shows again while the detail is still open must not take it.
    var returnReady = false

    func didHover(_ id: UUID, _ inside: Bool) {
        if inside {
            if let pendingHomeCardRestore, targets[id].flatMap({ Self.identity(of: $0) }) != pendingHomeCardRestore {
                self.pendingHomeCardRestore = nil
            }
            pendingStageFocus = false
            hoveredID = id
        } else if hoveredID == id {
            hoveredID = nil
        }
    }

    var topLayer: Int { targets.values.map(\.layer).max() ?? 0 }

    func pushTargetRegistrationObserver(_ id: UUID, _ action: @escaping (TargetIdentity?) -> Void) {
        targetRegistrationObservers.removeAll { $0.0 == id }
        targetRegistrationObservers.append((id, action))
    }

    func popTargetRegistrationObserver(_ id: UUID) {
        targetRegistrationObservers.removeAll { $0.0 == id }
    }

    @discardableResult
    func focusTarget(parityID: String, rail: Int, index: Int, inActiveLayer layer: Int, claim: () -> Bool) -> Bool {
        guard topLayer == layer,
              let (id, target) = targets.first(where: {
                  $0.value.parityID == parityID && $0.value.parityRail == rail
                      && $0.value.parityIndex == index && $0.value.layer == layer
              }) else {
            return false
        }
        guard claim() else { return false }
        autoFocusedID = id
        target.focus()
        return true
    }

    private static func identity(of target: Target) -> TargetIdentity? {
        guard let parityID = target.parityID, let rail = target.parityRail, let index = target.parityIndex else { return nil }
        return TargetIdentity(parityID: parityID, rail: rail, index: index)
    }

    /// Return: the focused target's action, or a click on it when it has none (a navigation link).
    func activateFocused(in window: NSWindow?) -> Bool {
        guard let id = focusedID, let target = targets[id] else { return false }
        if let action = target.activate { action() } else { Self.click(target.frame, in: window) }
        return true
    }

    /// Posts a click at the centre of a stage rect (MacTVStage scales 1920x1080 to the window, top-left anchored).
    static func click(_ frame: CGRect, in window: NSWindow?) {
        guard let window, let view = window.contentView else { return }
        let scale = min(view.bounds.width / 1920, view.bounds.height / 1080)
        let point = NSPoint(x: frame.midX * scale, y: view.bounds.height - frame.midY * scale)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            if let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [],
                                              timestamp: ProcessInfo.processInfo.systemUptime,
                                              windowNumber: window.windowNumber, context: nil,
                                              eventNumber: 0, clickCount: 1, pressure: 1) {
                NSApp.postEvent(event, atStart: false)
            }
        }
    }

    /// Right click (the hovered target) or Shift+Return (the focused one): the long press, if the target has one.
    func secondary(hovered: Bool) -> Bool {
        guard let id = hovered ? hoveredID : focusedID, let action = targets[id]?.secondary else { return false }
        action()
        return true
    }

    /// The top layer's smallest target under a stage point (debug automation).
    func target(at point: CGPoint) -> Target? {
        let layer = topLayer
        return targets.values.filter { $0.layer == layer && $0.frame.contains(point) }
            .min(by: { $0.frame.width * $0.frame.height < $1.frame.width * $1.frame.height })
    }

    #if DEBUG
    private var lastMoveObservation = MacFocusMoveObservation(registeredTargetCandidateCount: 0, chosenFrame: nil)
    #endif

    /// Moves focus to the nearest target in `direction` in the top layer. With nothing focused it focuses the
    /// layer's first target.
    func move(_ direction: MacMoveDirection) {
        pendingHomeCardRestore = nil
        let layer = topLayer
        let candidates = targets.filter { $0.value.layer == layer }
        autoFocusedID = nil
        if direction != .right { pendingStageFocus = false }
        let originID = focusedID.flatMap { candidates[$0] == nil ? nil : $0 }
            ?? lastFocused[layer].flatMap { candidates[$0] == nil ? nil : $0 }
        guard let fromID = originID, let from = candidates[fromID] else {
            guard let target = first(in: candidates)?.1 else {
                #if DEBUG
                lastMoveObservation = MacFocusMoveObservation(registeredTargetCandidateCount: 0, chosenFrame: nil)
                #endif
                return
            }
            target.focus()
            #if DEBUG
            lastMoveObservation = MacFocusMoveObservation(registeredTargetCandidateCount: 0, chosenFrame: target.frame)
            #endif
            return
        }
        var geometricTargets = candidates.filter { $0.key != fromID }
        if from.homeRailFocus && (direction == .left || direction == .right) {
            geometricTargets = geometricTargets.filter { _, target in
                if target.homeRailFocus {
                    return target.parityRail == from.parityRail
                }
                // The web leaves a Home rail only when Left is pressed from its leading card.
                return direction == .left && from.parityIndex == 0
                    && target.frame.midX < Self.contentArea.minX
            }
        }
        if direction == .down, let name = from.downTo, let target = candidates.values.first(where: { $0.focusName == name }) {
            target.focus()
            return
        }
        let geometricCandidates = geometricTargets.map { ($0.key, $0.value.frame) }
        let next = Self.nearest(from: from.frame, direction: direction, in: geometricCandidates)
        if let next, let target = candidates[next] {
            target.focus()
            #if DEBUG
            lastMoveObservation = MacFocusMoveObservation(registeredTargetCandidateCount: geometricCandidates.count, chosenFrame: target.frame)
            #endif
        } else if direction == .right, from.frame.midX < Self.contentArea.minX {
            pendingStageFocus = true
        }
        #if DEBUG
        if next == nil {
            lastMoveObservation = MacFocusMoveObservation(registeredTargetCandidateCount: geometricCandidates.count, chosenFrame: nil)
        }
        #endif
    }

    #if DEBUG
    func moveWithDiagnostics(_ direction: MacMoveDirection) -> MacFocusMoveObservation {
        move(direction)
        return lastMoveObservation
    }
    #endif

    /// The geometric neighbour: the closest row (or column) ahead, then the closest centre across it, so a move
    /// between rails lands on the card visually above or below, never on a matching index.
    nonisolated static func nearest(from: CGRect, direction: MacMoveDirection, in others: [(UUID, CGRect)]) -> UUID? {
        let slack: CGFloat = 1
        func gap(_ r: CGRect) -> CGFloat? {
            switch direction {
            case .right: return r.midX > from.midX && r.minX >= from.maxX - r.width / 2 ? max(0, r.minX - from.maxX) : nil
            case .left: return r.midX < from.midX && r.maxX <= from.minX + r.width / 2 ? max(0, from.minX - r.maxX) : nil
            case .down: return r.midY > from.midY && r.minY >= from.maxY - r.height / 2 ? max(0, r.minY - from.maxY) : nil
            case .up: return r.midY < from.midY && r.maxY <= from.minY + r.height / 2 ? max(0, from.minY - r.maxY) : nil
            }
        }
        func across(_ r: CGRect) -> CGFloat {
            switch direction {
            case .left, .right: return abs(r.midY - from.midY)
            case .up, .down: return abs(r.midX - from.midX)
            }
        }
        func overlaps(_ r: CGRect) -> Bool {
            switch direction {
            case .left, .right: return r.maxY > from.minY + slack && r.minY < from.maxY - slack
            case .up, .down: return r.maxX > from.minX + slack && r.minX < from.maxX - slack
            }
        }
        let ahead = others.compactMap { item -> (UUID, CGRect, CGFloat)? in
            guard let g = gap(item.1) else { return nil }
            return (item.0, item.1, g)
        }
        guard !ahead.isEmpty else { return nil }
        switch direction {
        case .left, .right:
            // Same row first (overlapping the beam), nearest; otherwise the closest by gap and offset.
            let beam = ahead.filter { overlaps($0.1) }
            if let best = beam.min(by: { ($0.2, across($0.1)) < ($1.2, across($1.1)) }) { return best.0 }
            return ahead.min(by: { $0.2 + 2 * across($0.1) < $1.2 + 2 * across($1.1) })?.0
        case .up, .down:
            // The nearest row ahead, then the card whose horizontal centre is closest.
            // Up and Down stay in their column: the nav clamps at its ends, and the page never jumps into the nav (web).
            let pool = ahead.filter { ($0.1.midX < 140) == (from.midX < 140) }
            guard let row = pool.map(\.2).min() else { return nil }
            let rowTolerance: CGFloat = 24
            return pool.filter { $0.2 <= row + rowTolerance }.min(by: { across($0.1) < across($1.1) })?.0
        }
    }

    /// The page content of the 1920x1080 TV layout: right of the nav, below the header, left of the action column.
    nonisolated static let contentArea = CGRect(x: 140, y: 130, width: 1700, height: 950)

    nonisolated static func isContent(_ frame: CGRect) -> Bool { contentArea.contains(CGPoint(x: frame.midX, y: frame.midY)) }

    /// Where focus starts in a layer: the last focused target there, else the first page content (web TV starts on
    /// the content, not the header or the nav), else the top-left target.
    private func first(in candidates: [UUID: Target], restore: Bool = false) -> (UUID, Target)? {
        if restore, let layer = candidates.first?.value.layer, let id = lastFocused[layer], let t = candidates[id] {
            return (id, t)
        }
        if !restore, let p = candidates.first(where: { $0.value.preferred }) { return (p.key, p.value) }
        let order: ((UUID, Target), (UUID, Target)) -> Bool = {
            ($0.1.frame.minY, $0.1.frame.minX) < ($1.1.frame.minY, $1.1.frame.minX)
        }
        let all = candidates.map { ($0.key, $0.value) }
        return all.filter { Self.isContent($0.1.frame) }.min(by: order) ?? all.min(by: order)
    }

    /// Focus the settle step chose; content that loads later may still take it until the user moves.
    private var autoFocusedID: UUID?
    private var settledLayer = 0

    private var settleScheduled = false
    /// After targets come and go (a cover opens or closes, a page loads), keep focus inside the top layer, as the
    /// tvOS engine does. Code that sets focus itself (initial focus on a series page) wins: this only fills a gap.
    private func scheduleSettle() {
        guard !settleScheduled else { return }
        settleScheduled = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self else { return }
            self.settleScheduled = false
            let layer = self.topLayer
            // A cover or drawer closed: return to where focus was beneath it.
            let restore = layer < self.settledLayer
            self.settledLayer = layer
            let candidates = self.targets.filter { $0.value.layer == layer }
            if self.pendingStageFocus {
                let content = candidates.filter { Self.isContent($0.value.frame) }
                guard let (id, target) = self.first(in: content) else { return }
                self.pendingStageFocus = false
                self.autoFocusedID = id
                target.focus()
                return
            }
            if layer == 0, let identity = self.pendingHomeCardRestore,
               let (id, target) = candidates.first(where: {
                   $0.value.parityID == identity.parityID && $0.value.parityRail == identity.rail
                       && $0.value.parityIndex == identity.index
               }) {
                self.pendingHomeCardRestore = nil
                self.autoFocusedID = id
                target.focus()
                return
            }
            if let id = self.focusedID, let current = candidates[id] {
                // Keep focus unless the settle step put it on a header tile and page content has since appeared.
                guard id == self.autoFocusedID, !Self.isContent(current.frame),
                      candidates.values.contains(where: { Self.isContent($0.frame) }) else { return }
            }
            guard let (id, target) = self.first(in: candidates, restore: restore) else { return }
            self.autoFocusedID = id
            target.focus()
        }
    }
}

// MARK: Focus targets

private struct MacFocusLayerKey: EnvironmentKey { static let defaultValue = 0 }

struct MacSecondary { let action: () -> Void }
private struct MacSecondaryKey: EnvironmentKey { static let defaultValue: MacSecondary? = nil }
private struct MacPreferredKey: EnvironmentKey { static let defaultValue = false }
private struct MacFocusNameKey: EnvironmentKey { static let defaultValue: String? = nil }
private struct MacDownToKey: EnvironmentKey { static let defaultValue: String? = nil }
struct MacFocusBindingBridge {
    let focusChanged: (Bool) -> Void
    let restore: () -> Void
    /// The owner asks this target to take focus (Back into a grid lands on its first card).
    var wantsFocus = false
}
private struct MacFocusBindingBridgeKey: EnvironmentKey { static let defaultValue: MacFocusBindingBridge? = nil }
/// Debug parity: what a focus target names itself in parity-state.json (the Mac's focus is not a SwiftUI focus the tiles can read).
struct MacParityTag {
    let title: String
    let id: String
    let rail: Int?
    let index: Int?
    let gridPosition: TVParityGridPosition?
}
private struct MacParityTagKey: EnvironmentKey { static let defaultValue: MacParityTag? = nil }

extension EnvironmentValues {
    var macFocusLayer: Int {
        get { self[MacFocusLayerKey.self] }
        set { self[MacFocusLayerKey.self] = newValue }
    }

    var macFocusName: String? {
        get { self[MacFocusNameKey.self] }
        set { self[MacFocusNameKey.self] = newValue }
    }

    var macDownTo: String? {
        get { self[MacDownToKey.self] }
        set { self[MacDownToKey.self] = newValue }
    }

    var macPreferredFocus: Bool {
        get { self[MacPreferredKey.self] }
        set { self[MacPreferredKey.self] = newValue }
    }

    var macFocusBindingBridge: MacFocusBindingBridge? {
        get { self[MacFocusBindingBridgeKey.self] }
        set { self[MacFocusBindingBridgeKey.self] = newValue }
    }

    var macParityTag: MacParityTag? {
        get { self[MacParityTagKey.self] }
        set { self[MacParityTagKey.self] = newValue }
    }

    var macSecondaryAction: MacSecondary? {
        get { self[MacSecondaryKey.self] }
        set { self[MacSecondaryKey.self] = newValue }
    }
}

extension View {
    /// A layer above the page (cover, drawer): while it has targets, focus stays inside it.
    func macFocusLayer() -> some View { modifier(MacFocusLayerBump()) }

    /// Makes a view a keyboard and hover focus target; `activate` runs on Return.
    func macFocusTarget(activate: (() -> Void)? = nil) -> some View { modifier(MacFocusTarget(activate: activate)) }

    /// The button inside takes focus first when its layer opens (the tvOS drawer focuses its close button).
    func macPreferredFocus(_ preferred: Bool = true) -> some View { environment(\.macPreferredFocus, preferred) }

    /// The long-press action (actions drawer) of the button inside: right click while hovered, or Shift+Return.
    func macSecondaryAction(_ action: @escaping () -> Void) -> some View {
        environment(\.macSecondaryAction, MacSecondary(action: action))
    }
}

private struct MacFocusLayerBump: ViewModifier {
    @Environment(\.macFocusLayer) private var layer
    func body(content: Content) -> some View { content.environment(\.macFocusLayer, layer + 1) }
}

struct MacFocusTarget: ViewModifier {
    var activate: (() -> Void)?
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.macFocusLayer) private var layer
    @Environment(\.macSecondaryAction) private var secondary
    @Environment(\.macPreferredFocus) private var preferred
    @Environment(\.macFocusName) private var focusName
    @Environment(\.macDownTo) private var downTo
    @Environment(\.macParityTag) private var parityTag
    @Environment(\.macFocusBindingBridge) private var focusBridge
    @FocusState private var focused: Bool
    @State private var id = UUID()
    @State private var appearedAt = Date()

    func body(content: Content) -> some View {
        targetContent(content, bridge: focusBridge)
    }

    @ViewBuilder
    private func targetContent(_ content: Content, bridge: MacFocusBindingBridge?) -> some View {
        if let bridge {
            content
                .focusable(isEnabled, interactions: .edit)
                .focused($focused)
                .focusEffectDisabled()
                .onHover { inside in
                    MacFocusEngine.shared.didHover(id, inside)
                    // A card that appears under a resting pointer (Back to a grid) must not steal focus from the settle step.
                    if inside, isEnabled, Date().timeIntervalSince(appearedAt) > 0.5 { focused = true }
                }
                .onAppear { if bridge.wantsFocus, isEnabled { focused = true } } // a lazily realised card asked before it existed
                .onChange(of: bridge.wantsFocus) { _, wants in
                    if wants, isEnabled, MacFocusEngine.shared.topLayer == layer { focused = true }
                }
                .onChange(of: focused) { _, now in
                    if now, MacFocusEngine.shared.topLayer != layer { return }
                    #if DEBUG
                    if now { NSLog("PlayarrMacTrace focus set tag=%@ layer=%d", parityTag?.title ?? "none", layer) }
                    #endif
                    MacFocusEngine.shared.didFocus(id, now)
                    #if DEBUG
                    if let tag = parityTag, tag.rail == nil {
                        TVParityState.setFocus(tag.title, now, id: tag.id, rail: tag.rail, index: tag.index,
                                               gridPosition: tag.gridPosition)
                    }
                    #endif
                    if MacFocusEngine.shared.topLayer == layer { bridge.focusChanged(now) }
                }
                .background { geometry(bridge: bridge) }
                .onDisappear { MacFocusEngine.shared.remove(id) }
        } else {
            content
                // `.edit`, not `.activate`: activation focus needs the system "keyboard navigation" setting on.
                .focusable(isEnabled, interactions: .edit)
                .focused($focused)
                .focusEffectDisabled()
                .onHover { inside in
                    MacFocusEngine.shared.didHover(id, inside)
                    // A card that appears under a resting pointer (Back to a grid) must not steal focus from the settle step.
                    if inside, isEnabled, Date().timeIntervalSince(appearedAt) > 0.5 { focused = true }
                }
                .onChange(of: focused) { _, now in
                    MacFocusEngine.shared.didFocus(id, now)
                    #if DEBUG
                    if let t = parityTag {
                        TVParityState.setFocus(t.title, now, id: t.id, rail: t.rail, index: t.index,
                                              gridPosition: t.gridPosition)
                    }
                    #endif
                }
                .background { geometry(bridge: nil) }
                .onDisappear { MacFocusEngine.shared.remove(id) }
        }
    }

    @ViewBuilder
    private func geometry(bridge: MacFocusBindingBridge?) -> some View {
        GeometryReader { proxy in
            let frame = proxy.frame(in: .named(macStageSpace))
            Color.clear
                .onAppear { register(frame, bridge: bridge) }
                .onChange(of: frame) { _, new in register(new, bridge: bridge) }
                .onChange(of: isEnabled) { _, _ in register(frame, bridge: bridge) }
                .onChange(of: layer) { _, _ in register(frame, bridge: bridge) }
        }
    }

    private func register(_ frame: CGRect, bridge: MacFocusBindingBridge?) {
        guard isEnabled, frame.width > 0, frame.height > 0 else {
            MacFocusEngine.shared.remove(id)
            return
        }
        let binding = $focused
        let focusAction: () -> Void = { binding.wrappedValue = true }
        let focusQuery: () -> Bool = { binding.wrappedValue }
        MacFocusEngine.shared.update(id, .init(frame: frame, layer: layer, focus: focusAction,
                                               parityID: parityTag?.id, parityRail: parityTag?.rail, parityIndex: parityTag?.index,
                                               homeRailFocus: bridge != nil && parityTag?.rail != nil,
                                               activate: activate, secondary: secondary?.action, preferred: preferred,
                                               focusName: focusName, downTo: downTo,
                                               isFocused: focusQuery))
    }
}

// MARK: Button

/// Every `Button` in the shared sources resolves to this one on the Mac (a module type shadows SwiftUI's), so each
/// is a keyboard and hover focus target without touching the tvOS code. It draws SwiftUI's button unchanged.
struct Button<Label: View>: View {
    private let role: ButtonRole?
    private let action: () -> Void
    private let label: Label

    init(action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.role = nil
        self.action = action
        self.label = label()
    }

    init(role: ButtonRole?, action: @escaping () -> Void, @ViewBuilder label: () -> Label) {
        self.role = role
        self.action = action
        self.label = label()
    }

    var body: some View {
        SwiftUI.Button(role: role, action: action) { label }
            .macFocusTarget(activate: action)
    }
}

extension Button where Label == Text {
    init(_ titleKey: LocalizedStringKey, action: @escaping () -> Void) {
        self.init(action: action) { Text(titleKey) }
    }

    @_disfavoredOverload
    init<S: StringProtocol>(_ title: S, action: @escaping () -> Void) {
        self.init(action: action) { Text(title) }
    }

    init(_ titleKey: LocalizedStringKey, role: ButtonRole?, action: @escaping () -> Void) {
        self.init(role: role, action: action) { Text(titleKey) }
    }
}

/// The shared sources' closure `NavigationLink`s, likewise focus targets. Return clicks them (no public way to push).
struct NavigationLink<Label: View, Destination: View>: View {
    private let destination: Destination
    private let label: Label

    init(@ViewBuilder destination: () -> Destination, @ViewBuilder label: () -> Label) {
        self.destination = destination()
        self.label = label()
    }

    var body: some View {
        SwiftUI.NavigationLink { destination } label: { label }
            .macFocusTarget()
    }
}

// MARK: Keyboard and mouse

@MainActor
final class MacKeyboard {
    static let shared = MacKeyboard()
    private var monitor: Any?
    private var playPause: [(UUID, () -> Void)] = []
    #if DEBUG
    private var focusDiagnosticSequence = 0
    #endif
    private var backHandlers: [(UUID, () -> Bool)] = []

    func pushBackHandler(_ id: UUID, _ action: @escaping () -> Bool) {
        backHandlers.removeAll { $0.0 == id }
        backHandlers.append((id, action))
    }

    func popBackHandler(_ id: UUID) { backHandlers.removeAll { $0.0 == id } }

    func pushPlayPause(_ id: UUID, _ action: @escaping () -> Void) {
        playPause.removeAll { $0.0 == id }
        playPause.append((id, action))
    }

    func popPlayPause(_ id: UUID) { playPause.removeAll { $0.0 == id } }

    private func moveDirection(for keyCode: UInt16) -> MacMoveDirection? {
        switch keyCode {
        case 123: return .left
        case 124: return .right
        case 125: return .down
        case 126: return .up
        default: return nil
        }
    }

    #if DEBUG
    private func logFocusKey(_ sequence: Int, direction: MacMoveDirection, responder: MacFocusKeyDiagnosticSample.ResponderCategory,
                             textEditingExcluded: Bool, before: UUID?, beforeFallback: UUID?, after: UUID?, fallbackRan: Bool,
                             move: MacFocusMoveObservation) {
        let engine = MacFocusEngine.shared
        let bindingCount = engine.targets.values.filter { $0.isFocused() }.count
        let bindingPresent = engine.focusedID.flatMap { engine.targets[$0]?.isFocused() } ?? false
        let sample = MacFocusKeyDiagnosticSample(
            direction: direction,
            responder: responder,
            textEditingExcluded: textEditingExcluded,
            beforeFocusedPresent: before != nil,
            beforeFallbackFocusedPresent: beforeFallback != nil,
            beforeFallbackEqualsBefore: beforeFallback == before,
            afterFocusedPresent: after != nil,
            afterEqualsBefore: after == before,
            fallbackRan: fallbackRan,
            registeredTargetCandidateCount: move.registeredTargetCandidateCount,
            chosenFrame: move.chosenFrame,
            focusedBindingPresent: bindingPresent,
            focusedBindingCount: bindingCount
        )
        NSLog("%@", sample.line(sequence: sequence) as NSString)
    }

    private func nextFocusDiagnosticSequence() -> Int {
        focusDiagnosticSequence += 1
        return focusDiagnosticSequence
    }

    private func logArrowEventEntry(_ sequence: Int, direction: MacMoveDirection, textResponder: Bool, windowKey: Bool) {
        let name: String
        switch direction {
        case .left: name = "left"
        case .right: name = "right"
        case .up: name = "up"
        case .down: name = "down"
        }
        NSLog("PlayarrMacFocusKeyEntry seq=%d direction=%@ text_responder=%@ window_key=%@",
              sequence, name as NSString, String(textResponder) as NSString, String(windowKey) as NSString)
    }
    #endif

    func install() {
        guard monitor == nil else { return }
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .rightMouseDown]) { event in
            MainActor.assumeIsolated { MacKeyboard.shared.handle(event) }
        }
    }

    private func handle(_ event: NSEvent) -> NSEvent? {
        if event.type == .rightMouseDown {
            return MacFocusEngine.shared.secondary(hovered: true) ? nil : event
        }
        let direction = moveDirection(for: event.keyCode)
        // Text fields keep their keys (search, server address, PIN).
        let textEditing = event.window?.firstResponder is NSText
        #if DEBUG
        let diagnosticSequence: Int? = direction.map { direction in
            let sequence = nextFocusDiagnosticSequence()
            logArrowEventEntry(sequence, direction: direction, textResponder: textEditing,
                               windowKey: event.window?.isKeyWindow == true)
            return sequence
        }
        #endif
        if textEditing {
            #if DEBUG
            if let direction, let sequence = diagnosticSequence {
                let engine = MacFocusEngine.shared
                let focused = engine.focusedID
                logFocusKey(sequence, direction: direction, responder: .text, textEditingExcluded: true,
                            before: focused, beforeFallback: focused, after: focused, fallbackRan: false,
                            move: MacFocusMoveObservation(registeredTargetCandidateCount: 0, chosenFrame: nil))
            }
            #endif
            return event
        }
        let mods = event.modifierFlags.intersection([.command, .option, .control, .shift])
        if mods.contains(.command) { return event }
        switch event.keyCode {
        case 123, 124, 125, 126:
            guard let direction else { return event }
            // The focused view's own onMoveCommand runs first (as on tvOS); the engine then moves focus unless
            // that handler already moved it.
            let engine = MacFocusEngine.shared
            let before = engine.focusedID
            #if DEBUG
            guard let sequence = diagnosticSequence else { return event }
            #endif
            DispatchQueue.main.async {
                let beforeFallback = engine.focusedID
                let fallbackRan = beforeFallback == before
                #if DEBUG
                let move = fallbackRan
                    ? engine.moveWithDiagnostics(direction)
                    : MacFocusMoveObservation(registeredTargetCandidateCount: 0, chosenFrame: nil)
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(120)) {
                    self.logFocusKey(sequence, direction: direction, responder: .other, textEditingExcluded: false,
                                     before: before, beforeFallback: beforeFallback, after: engine.focusedID,
                                     fallbackRan: fallbackRan, move: move)
                }
                #else
                if fallbackRan { engine.move(direction) }
                #endif
            }
            return event
        case 36, 76: // Return, keypad Enter
            if mods.contains(.shift) { return MacFocusEngine.shared.secondary(hovered: false) ? nil : event }
            return MacFocusEngine.shared.activateFocused(in: event.window) ? nil : event
        case 49: // Space
            if let action = playPause.last?.1 { action(); return nil }
            return event
        case 53, 51, 117: // Escape, Delete and forward delete: Back
            if backHandlers.last?.1() == true { return nil }
            if event.keyCode == 53 { return event }
            return NSEvent.keyEvent(with: .keyDown, location: event.locationInWindow, modifierFlags: [],
                                    timestamp: event.timestamp, windowNumber: event.windowNumber, context: nil,
                                    characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
                                    isARepeat: event.isARepeat, keyCode: 53) ?? event
        default:
            return event
        }
    }
}

extension Notification.Name {
    /// Posted when a detail pops back to its library grid.
    static let macGridReturnFocus = Notification.Name("PlayarrMacGridReturnFocus")
}
