#if os(macOS)
import AppKit
import CoreGraphics
import Foundation
import SwiftUI
import XCTest
@testable import PlayarrTV

/// The Mac's arrow-key focus: geometric moves, the web TV rules.
final class MacFocusEngineTests: XCTestCase {
    private func card(_ x: CGFloat, _ y: CGFloat, w: CGFloat = 200, h: CGFloat = 300) -> CGRect {
        CGRect(x: x, y: y, width: w, height: h)
    }

    func testDownLandsOnTheCardVisuallyBelowNotTheSameIndex() {
        // The top rail is scrolled: the focused card sits at x 900. The lower rail starts at x 100.
        let focused = card(900, 100)
        let below = (0..<8).map { (UUID(), card(100 + CGFloat($0) * 220, 500)) }
        let pick = MacFocusEngine.nearest(from: focused, direction: .down, in: below)
        XCTAssertEqual(pick, below[4].0) // x 980, centre 1000 = the focused centre
    }

    func testDownPrefersTheNearestRowOverACloserCentreFurtherDown() {
        let focused = card(900, 100)
        let nextRow = (UUID(), card(600, 500))
        let rowAfter = (UUID(), card(900, 900))
        XCTAssertEqual(MacFocusEngine.nearest(from: focused, direction: .down, in: [nextRow, rowAfter]), nextRow.0)
    }

    func testRightStaysInTheRowAndTakesTheNearestCard() {
        let focused = card(100, 100)
        let next = (UUID(), card(320, 100))
        let later = (UUID(), card(540, 100))
        let otherRow = (UUID(), card(330, 500))
        XCTAssertEqual(MacFocusEngine.nearest(from: focused, direction: .right, in: [later, otherRow, next]), next.0)
    }

    func testLeftFromTheRailHeadReachesTheNav() {
        let focused = card(300, 400)
        let nav = (UUID(), CGRect(x: 20, y: 120, width: 60, height: 60))
        XCTAssertEqual(MacFocusEngine.nearest(from: focused, direction: .left, in: [nav]), nav.0)
    }

    func testNothingAheadKeepsFocus() {
        let focused = card(100, 100)
        XCTAssertNil(MacFocusEngine.nearest(from: focused, direction: .up, in: [(UUID(), card(400, 500))]))
    }

    /// A real window: hover-free keyboard focus lands on a target, and Right moves it to the next button.
    /// Needs an active session (CI); skipped where no window can become key (a locked Mac).
    @MainActor
    func testArrowMovesKeyboardFocusInAWindow() async throws {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 960, height: 540),
                              styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: MacTVStage {
            HStack(spacing: 200) {
                Button("First") {}
                Button("Second") {}
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .macFocusLayer()
        })
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        window.makeFirstResponder(window.contentView)
        defer { window.orderOut(nil) }
        let engine = MacFocusEngine.shared
        func wait(_ condition: () -> Bool) async -> Bool {
            for _ in 0..<40 {
                if condition() { return true }
                try? await Task.sleep(for: .milliseconds(100))
            }
            return condition()
        }
        enum DiagnosticStage: String {
            case afterSettle = "after-settle"
            case afterRight = "after-right"
            case afterLeft = "after-left"
        }
        func attachSafeDiagnostic(_ stage: DiagnosticStage) {
            let topTargets = engine.targets.filter { $0.value.layer == engine.topLayer }
                .sorted { $0.value.frame.minX < $1.value.frame.minX }
            let firstTarget = topTargets.first
            let secondTarget = topTargets.dropFirst().first
            let validFrameCount = topTargets.filter { _, target in
                let frame = target.frame
                return !frame.isNull && !frame.isInfinite
                    && frame.origin.x.isFinite && frame.origin.y.isFinite
                    && frame.width.isFinite && frame.height.isFinite
                    && frame.width > 0 && frame.height > 0
            }.count
            let nearestSelectsFirst: Bool
            if let firstTarget, let secondTarget,
               validFrameCount == topTargets.count {
                nearestSelectsFirst = MacFocusEngine.nearest(
                    from: secondTarget.value.frame,
                    direction: .left,
                    in: [(firstTarget.key, firstTarget.value.frame)]
                ) == firstTarget.key
            } else {
                nearestSelectsFirst = false
            }
            let focusedMatchesFirst = firstTarget.map { engine.focusedID == $0.key } ?? false
            let focusedMatchesSecond = secondTarget.map { engine.focusedID == $0.key } ?? false
            let firstBindingFocused = firstTarget?.value.isFocused() ?? false
            let secondBindingFocused = secondTarget?.value.isFocused() ?? false
            let diagnostic = [
                "stage=\(stage.rawValue)",
                "key_window=\(window.isKeyWindow)",
                "top_layer_count=\(topTargets.count)",
                "valid_frame_count=\(validFrameCount)",
                "nearest_left_selects_first=\(nearestSelectsFirst)",
                "focused_matches_first=\(focusedMatchesFirst)",
                "focused_matches_second=\(focusedMatchesSecond)",
                "first_target_is_focused=\(firstBindingFocused)",
                "second_target_is_focused=\(secondBindingFocused)",
            ].joined(separator: " ")
            NSLog("PLAYARR_MAC_FOCUS_DIAGNOSTIC %@", diagnostic as NSString)
            let attachment = XCTAttachment(string: diagnostic)
            attachment.name = "mac-focus-safe-diagnostic"
            attachment.lifetime = .keepAlways
            XCTContext.runActivity(named: "mac-focus-\(stage.rawValue)") { activity in
                activity.add(attachment: attachment)
            }
        }
        guard await wait({ window.isKeyWindow }) else { throw XCTSkip("no key window in this session") }
        let registered = await wait({ engine.targets.values.filter { $0.layer == engine.topLayer }.count == 2 })
        XCTAssertTrue(registered, "both buttons are focus targets in the top layer")
        let settled = await wait({ engine.focusedID != nil })
        XCTAssertTrue(settled, "the settle step focuses the layer's first target")
        attachSafeDiagnostic(.afterSettle)
        let first = engine.focusedID
        engine.move(.right)
        let moved = await wait({ engine.focusedID != nil && engine.focusedID != first })
        XCTAssertTrue(moved, "Right moves focus")
        attachSafeDiagnostic(.afterRight)
        engine.move(.left)
        let back = await wait({ engine.focusedID == first })
        XCTAssertTrue(back, "Left comes back")
        attachSafeDiagnostic(.afterLeft)
    }

    /// A layer's preferred target (a drawer's close button) takes focus when it appears, ahead of the other buttons.
    @MainActor
    func testPreferredTargetTakesFocusWhenItAppears() async {
        let engine = MacFocusEngine.shared
        var focused: [String] = []
        let layer = 99 // above anything a page registers, so it is the top layer
        let first = UUID(), preferred = UUID()
        engine.update(first, .init(frame: card(0, 0), layer: layer, focus: { focused.append("first") }))
        engine.update(preferred, .init(frame: card(400, 0), layer: layer, focus: { focused.append("preferred") }, preferred: true))
        defer { engine.remove(first); engine.remove(preferred) }
        for _ in 0..<30 where !focused.contains("preferred") { try? await Task.sleep(for: .milliseconds(100)) }
        XCTAssertTrue(focused.contains("preferred"), "the preferred target takes focus")
    }
}
#endif
