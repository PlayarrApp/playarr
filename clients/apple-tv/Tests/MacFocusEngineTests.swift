#if os(macOS)
import AppKit
import CoreGraphics
import Foundation
import SwiftUI
import XCTest
@testable import PlayarrTV

/// The Mac's arrow-key focus: geometric moves, the web TV rules.
final class MacFocusEngineTests: XCTestCase {
#if DEBUG
    func testFocusKeyDiagnosticContainsOnlySafeDecisionFields() {
        let sample = MacFocusKeyDiagnosticSample(
            direction: .down,
            responder: .other,
            textEditingExcluded: false,
            beforeFocusedPresent: true,
            beforeFallbackFocusedPresent: false,
            beforeFallbackEqualsBefore: false,
            afterFocusedPresent: true,
            afterEqualsBefore: true,
            fallbackRan: true,
            registeredTargetCandidateCount: 4,
            chosenFrame: CGRect(x: 10, y: 20, width: 30, height: 40),
            focusedBindingPresent: true,
            focusedBindingCount: 1
        )
        XCTAssertEqual(
            sample.line(sequence: 7),
            "PlayarrMacFocusKey seq=7 direction=down responder=other text_edit_excluded=false before_focused=true " +
                "before_fallback_focused_present=false before_fallback_equals_before=false " +
                "after_focused=true after_equals_before=true fallback_ran=true " +
                "registered_target_candidates=4 chosen_frame=10.0,20.0,30.0,40.0 focused_binding=true focused_binding_count=1"
        )
    }
#endif

    private func card(_ x: CGFloat, _ y: CGFloat, w: CGFloat = 200, h: CGFloat = 300) -> CGRect {
        CGRect(x: x, y: y, width: w, height: h)
    }

    @MainActor
    func testHomeFocusClaimMatchesTheFrozenRailAndCardForDuplicateWorkIDs() {
        let engine = MacFocusEngine()
        let railOneID = UUID()
        let railZeroID = UUID()
        let overlayID = UUID()
        var railOneFocusCount = 0
        var railZeroFocusCount = 0
        var claims = 0
        var claimPending = true
        let observerID = UUID()

        func attemptClaim() {
            _ = engine.focusTarget(
                parityID: "sample-work-id", rail: 0, index: 0, inActiveLayer: 0,
                claim: {
                    claims += 1
                    guard claimPending else { return false }
                    claimPending = false
                    return true
                }
            )
        }

        engine.pushTargetRegistrationObserver(observerID) { identity in
            guard identity == nil || identity == MacFocusEngine.TargetIdentity(
                parityID: "sample-work-id", rail: 0, index: 0
            ) else { return }
            attemptClaim()
        }
        defer {
            engine.popTargetRegistrationObserver(observerID)
            engine.remove(railOneID)
            engine.remove(railZeroID)
            engine.remove(overlayID)
        }

        attemptClaim()
        XCTAssertTrue(claimPending, "the request waits without consuming a claim before registration")

        engine.update(railOneID, .init(
            frame: card(500, 200), layer: 0, focus: { railOneFocusCount += 1 },
            parityID: "sample-work-id", parityRail: 1, parityIndex: 0
        ))
        engine.update(overlayID, .init(frame: card(20, 100), layer: 1, focus: {}))
        engine.update(railZeroID, .init(
            frame: card(300, 200), layer: 0, focus: { railZeroFocusCount += 1 },
            parityID: "sample-work-id", parityRail: 0, parityIndex: 0
        ))

        XCTAssertTrue(claimPending, "a matching card cannot claim while another focus layer is active")
        XCTAssertEqual(claims, 0)
        engine.remove(overlayID) // Registration notification retries the exact pending candidate.

        XCTAssertFalse(claimPending, "the exact registered Home card consumes the pending claim")
        XCTAssertEqual(claims, 1)
        XCTAssertEqual(railZeroFocusCount, 1)
        XCTAssertEqual(railOneFocusCount, 0, "a duplicate work ID in another rail must not receive focus")
    }

    @MainActor
    func testHomeFocusBindingBridgeTracksExactRailAndRespectsOverlayLayerOnRestore() async throws {
        let engine = MacFocusEngine()
        let railZeroID = UUID()
        let railOneID = UUID()
        let overlayID = UUID()
        let focusRailZero = HomeRailCardFocus(rail: "r0", workID: UUID())
        let focusRailOne = HomeRailCardFocus(rail: "r1", workID: focusRailZero.workID)
        var selected: HomeRailCardFocus? = focusRailOne
        var childFocused = [focusRailZero: false, focusRailOne: true]
        let bridge = MacFocusBindingBridge(
            focusChanged: { isFocused in
                childFocused[focusRailOne] = isFocused
                if isFocused { selected = focusRailOne }
                else if selected == focusRailOne { selected = nil }
            },
            restore: {
                engine.requestHomeCardRestore(
                    parityID: focusRailOne.workID.uuidString, rail: 1, index: 0
                )
            }
        )
        let railZeroTarget = MacFocusEngine.Target(
            frame: card(300, 200), layer: 0, focus: {
                childFocused[focusRailZero] = true
                selected = focusRailZero
            },
            parityID: focusRailZero.workID.uuidString, parityRail: 0, parityIndex: 0,
            homeRailFocus: true,
            isFocused: { childFocused[focusRailZero] == true }
        )
        let railOneTarget = MacFocusEngine.Target(
            frame: card(550, 200), layer: 0, focus: {
                childFocused[focusRailOne] = true
                bridge.focusChanged(true)
            },
            parityID: focusRailOne.workID.uuidString, parityRail: 1, parityIndex: 0,
            homeRailFocus: true,
            isFocused: { childFocused[focusRailOne] == true }
        )
        engine.update(railZeroID, railZeroTarget)
        engine.update(railOneID, railOneTarget)
        engine.didFocus(parityID: focusRailOne.workID.uuidString, rail: 1, index: 0, focused: true)
        XCTAssertEqual(engine.focusedID, railOneID)

        engine.update(overlayID, .init(frame: card(20, 100), layer: 1, focus: {}))
        engine.didFocus(overlayID, true)
        bridge.restore()
        XCTAssertEqual(selected, focusRailOne, "restore cannot change the opener while an overlay is active")
        XCTAssertEqual(engine.focusedID, overlayID)
        engine.didFocus(parityID: focusRailOne.workID.uuidString, rail: 1, index: 0, focused: true)
        XCTAssertEqual(engine.focusedID, overlayID, "Home state cannot overwrite focus while an overlay is active")
        engine.requestHomeCardRestore(
            parityID: focusRailZero.workID.uuidString, rail: 0, index: 0
        ) // A same-work sibling also observes the drawer closing, but did not open it.

        engine.remove(overlayID)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(selected, focusRailOne, "the opener wins over a same-work sibling callback")
        engine.didFocus(parityID: focusRailOne.workID.uuidString, rail: 1, index: 0, focused: true)
        bridge.restore()
        XCTAssertEqual(selected, focusRailOne, "restore requests the exact rail identity for a duplicate work ID")
        engine.didFocus(parityID: focusRailOne.workID.uuidString, rail: 1, index: 0, focused: true)
        XCTAssertEqual(engine.focusedID, railOneID)
        XCTAssertTrue(engine.targets[railOneID]?.isFocused() == true)
        XCTAssertFalse(engine.targets[railZeroID]?.isFocused() == true)

        engine.remove(railZeroID)
        engine.remove(railOneID)
    }

    @MainActor
    func testCrossRailFocusSetsChildBindingAndHomeSelectionMirror() {
        let engine = MacFocusEngine()
        let firstID = UUID()
        let lowerID = UUID()
        let firstFocus = HomeRailCardFocus(rail: "r0", workID: UUID())
        let lowerFocus = HomeRailCardFocus(rail: "r1", workID: UUID())
        var selected: HomeRailCardFocus? = firstFocus
        var childFocused = [firstFocus: true, lowerFocus: false]
        let bridge = MacFocusBindingBridge(focusChanged: { focused in
            childFocused[lowerFocus] = focused
            if focused { selected = lowerFocus }
            else if selected == lowerFocus { selected = nil }
        }, restore: {})

        engine.update(firstID, .init(
            frame: card(300, 100), layer: 0, focus: { childFocused[firstFocus] = true },
            parityID: firstFocus.workID.uuidString, parityRail: 0, parityIndex: 0,
            homeRailFocus: true, isFocused: { childFocused[firstFocus] == true }
        ))
        engine.update(lowerID, .init(
            frame: card(300, 450), layer: 0, focus: {
                childFocused[firstFocus] = false
                engine.didFocus(firstID, false)
                childFocused[lowerFocus] = true
                engine.didFocus(lowerID, true)
                bridge.focusChanged(true)
            },
            parityID: lowerFocus.workID.uuidString, parityRail: 1, parityIndex: 0,
            homeRailFocus: true, isFocused: { childFocused[lowerFocus] == true }
        ))
        engine.didFocus(firstID, true)

        engine.move(.down)

        XCTAssertTrue(childFocused[lowerFocus] == true, "the actual child focus binding follows the geometric target")
        XCTAssertEqual(selected, lowerFocus, "the Home mirror follows the child focus callback")
        XCTAssertEqual(engine.focusedID, lowerID, "engine focus is updated by the observed child focus callback")
        XCTAssertTrue(engine.targets[lowerID]?.isFocused() == true)
        XCTAssertFalse(engine.targets[firstID]?.isFocused() == true)
        engine.remove(firstID)
        engine.remove(lowerID)
    }

    @MainActor
    func testPendingHomeCardRestoreIsCancelledByNewOverlayOrOtherFocus() async throws {
        let engine = MacFocusEngine()
        let homeID = UUID()
        let navID = UUID()
        let firstOverlayID = UUID()
        let nextOverlayID = UUID()
        var homeFocusCount = 0
        var navFocusCount = 0
        engine.update(homeID, .init(
            frame: card(300, 200), layer: 0, focus: { homeFocusCount += 1 },
            parityID: "home-card", parityRail: 0, parityIndex: 0, homeRailFocus: true
        ))
        engine.update(navID, .init(frame: card(20, 100), layer: 0, focus: { navFocusCount += 1 }))
        try await Task.sleep(for: .milliseconds(200)) // Let the initial layer settle before modeling drawer entry.
        engine.didFocus(homeID, true)
        engine.didFocus(navID, true)
        homeFocusCount = 0
        navFocusCount = 0
        engine.update(firstOverlayID, .init(frame: card(20, 100), layer: 1, focus: {}))
        engine.didFocus(firstOverlayID, true)
        try await Task.sleep(for: .milliseconds(200)) // Record layer 1 before closing or opening another layer.
        engine.requestHomeCardRestore(parityID: "home-card", rail: 0, index: 0)
        engine.update(nextOverlayID, .init(frame: card(40, 100), layer: 2, focus: {}))
        engine.didFocus(nextOverlayID, true)
        try await Task.sleep(for: .milliseconds(200))
        engine.remove(nextOverlayID)
        engine.remove(firstOverlayID)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(homeFocusCount, 0, "opening another overlay cancels the pending one-shot return")
        XCTAssertEqual(navFocusCount, 1, "normal layer restoration still prefers the last focused nav item")

        homeFocusCount = 0
        navFocusCount = 0
        engine.update(firstOverlayID, .init(frame: card(20, 100), layer: 1, focus: {}))
        engine.didFocus(firstOverlayID, true)
        try await Task.sleep(for: .milliseconds(200))
        engine.requestHomeCardRestore(parityID: "home-card", rail: 0, index: 0)
        engine.update(nextOverlayID, .init(frame: card(40, 100), layer: 1, focus: {}))
        engine.didFocus(nextOverlayID, true) // User changes focus within the drawer.
        try await Task.sleep(for: .milliseconds(200))
        engine.remove(nextOverlayID)
        engine.remove(firstOverlayID)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(homeFocusCount, 0, "user focus movement cancels the pending one-shot return")
        XCTAssertEqual(navFocusCount, 1, "ordinary layer restoration still returns to the previously focused nav item")
        engine.remove(homeID)
        engine.remove(navID)
    }

    @MainActor
    func testHomeHorizontalMovesStayInRailAndLeadingLeftCanReachNav() {
        let engine = MacFocusEngine()
        let leadingID = UUID()
        let secondID = UUID()
        let navID = UUID()
        let lowerRailID = UUID()
        var focusCounts: [UUID: Int] = [:]

        func target(_ id: UUID, _ frame: CGRect, rail: Int?, index: Int?, home: Bool) -> MacFocusEngine.Target {
            MacFocusEngine.Target(
                frame: frame, layer: 0, focus: { focusCounts[id, default: 0] += 1 },
                parityID: id.uuidString, parityRail: rail, parityIndex: index, homeRailFocus: home
            )
        }

        engine.update(leadingID, target(leadingID, card(180, 200), rail: 0, index: 0, home: true))
        engine.update(secondID, target(secondID, card(400, 200), rail: 0, index: 1, home: true))
        engine.update(navID, target(navID, card(20, 180, w: 60, h: 60), rail: nil, index: nil, home: false))
        engine.update(lowerRailID, target(lowerRailID, card(400, 520), rail: 1, index: 0, home: true))

        engine.didFocus(leadingID, true)
        engine.move(.right)
        XCTAssertEqual(focusCounts[secondID], 1, "Right follows the next card in the same Home rail")
        XCTAssertEqual(focusCounts[lowerRailID], nil, "horizontal movement cannot jump to another rail")

        engine.didFocus(secondID, true)
        engine.move(.left)
        XCTAssertEqual(focusCounts[leadingID], 1, "ordinary Left follows the previous card in the same Home rail")

        engine.didFocus(leadingID, true)
        engine.move(.left)
        XCTAssertEqual(focusCounts[navID], 1, "Left from the leading card keeps the measured nav handoff")

        engine.remove(leadingID)
        engine.remove(secondID)
        engine.remove(navID)
        engine.remove(lowerRailID)
    }

    @MainActor
    func testOneCardHomeRailRightClampsWhileDownCanCrossRails() {
        let engine = MacFocusEngine()
        let homeID = UUID()
        let lowerRailID = UUID()
        var lowerRailFocusCount = 0
        engine.update(homeID, .init(
            frame: card(300, 100), layer: 0, focus: {}, parityID: "home", parityRail: 0,
            parityIndex: 0, homeRailFocus: true
        ))
        engine.update(lowerRailID, .init(
            frame: card(520, 450), layer: 0, focus: { lowerRailFocusCount += 1 }, parityID: "lower",
            parityRail: 1, parityIndex: 0, homeRailFocus: true
        ))
        engine.didFocus(homeID, true)

        engine.move(.right)
        XCTAssertEqual(lowerRailFocusCount, 0, "Right clamps at the end of a one-card rail")
        engine.move(.down)
        XCTAssertEqual(lowerRailFocusCount, 1, "Down retains geometric movement across Home rails")

        engine.remove(homeID)
        engine.remove(lowerRailID)
    }

    @MainActor
    func testExplicitArrowCancelsPendingHomeRestoreEvenWithoutCandidate() async throws {
        let engine = MacFocusEngine()
        let homeID = UUID()
        let navID = UUID()
        let overlayID = UUID()
        var homeFocusCount = 0
        var navFocusCount = 0
        engine.update(homeID, .init(
            frame: card(300, 200), layer: 0, focus: { homeFocusCount += 1 },
            parityID: "home", parityRail: 0, parityIndex: 0, homeRailFocus: true
        ))
        try await Task.sleep(for: .milliseconds(200)) // Let base-layer registration settle before opening a drawer.
        engine.didFocus(homeID, true)
        engine.update(navID, .init(frame: card(20, 100), layer: 0, focus: { navFocusCount += 1 }))
        try await Task.sleep(for: .milliseconds(200))
        engine.didFocus(homeID, true)
        engine.didFocus(navID, true)
        homeFocusCount = 0
        navFocusCount = 0
        engine.update(overlayID, .init(frame: card(300, 100), layer: 1, focus: {}))
        engine.didFocus(overlayID, true)
        try await Task.sleep(for: .milliseconds(200)) // Let the overlay become the settled layer before the arrow.
        engine.requestHomeCardRestore(parityID: "home", rail: 0, index: 0)

        engine.move(.right) // No right-hand target exists in the active overlay.
        engine.remove(overlayID)
        try await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(homeFocusCount, 0, "an explicit arrow cancels the pending Home return")
        XCTAssertEqual(navFocusCount, 1, "ordinary layer restoration still uses the prior nav focus")

        engine.remove(homeID)
        engine.remove(navID)
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

    func testLeftFromMeasuredHomeCardSelectsTheNearestWebNavIndex() throws {
        // Safe 1920x1080 web geometry: Home rail 0/card 0 after the driver focuses it.
        let focusedCard = CGRect(x: 881.59375, y: 457.75, width: 327.171875, height: 213.390625)
        let navColumnWidth = DesignTokens.Shell.navItemSize
            + DesignTokens.Shell.navGroupPadding * 2
            + DesignTokens.Shell.navEdge * 2
        let navCenterX = navColumnWidth / 2
        let navCandidates = try (0..<10).map { index -> (UUID, CGRect) in
            let centerY = try XCTUnwrap(
                TVFloatingNavLayout.tileCenterY(index: index, groupCounts: [2, 4, 4], height: 1080)
            )
            let frame = CGRect(
                x: navCenterX - DesignTokens.Shell.navItemSize / 2,
                y: centerY - DesignTokens.Shell.navItemSize / 2,
                width: DesignTokens.Shell.navItemSize,
                height: DesignTokens.Shell.navItemSize
            )
            return (UUID(), frame)
        }

        let nearest = MacFocusEngine.nearest(from: focusedCard, direction: .left, in: navCandidates)
        XCTAssertEqual(nearest, navCandidates[5].0) // verified web DOM-order index 5
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
        guard await wait({ window.isKeyWindow }) else { throw XCTSkip("no key window in this session") }
        let registered = await wait({ engine.targets.values.filter { $0.layer == engine.topLayer }.count == 2 })
        XCTAssertTrue(registered, "both buttons are focus targets in the top layer")
        let settled = await wait({ engine.focusedID != nil })
        XCTAssertTrue(settled, "the settle step focuses the layer's first target")
        let first = engine.focusedID
        engine.move(.right)
        let moved = await wait({ engine.focusedID != nil && engine.focusedID != first })
        XCTAssertTrue(moved, "Right moves focus")
        engine.move(.left)
        let back = await wait({ engine.focusedID == first })
        XCTAssertTrue(back, "Left comes back")
    }

    @MainActor
    func testRightFromNavigationSettlesIntoAHomeTargetThatRegistersLate() async {
        let engine = MacFocusEngine.shared
        let layer = 900
        let navID = UUID()
        let stageID = UUID()
        defer { engine.remove(navID); engine.remove(stageID) }

        engine.update(navID, .init(frame: CGRect(x: 20, y: 120, width: 60, height: 60), layer: layer, focus: {
            engine.didFocus(navID, true)
        }))
        engine.didFocus(navID, true)
        engine.move(.right)
        XCTAssertEqual(engine.focusedID, navID, "Right waits when the Home stage has not registered a focus target")
        try? await Task.sleep(for: .milliseconds(200))
        XCTAssertEqual(engine.focusedID, navID, "a settle pass without stage targets must retain the queued entry")

        engine.update(stageID, .init(frame: card(300, 200), layer: layer, focus: {
            engine.didFocus(stageID, true)
        }))
        for _ in 0..<20 where engine.focusedID != stageID {
            try? await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertEqual(engine.focusedID, stageID, "the pending nav-to-stage move settles on the first Home target")
    }

    @MainActor
    func testRightAfterNavigationSelectionUsesLastFocusedOriginWhenBindingIsNil() async {
        let engine = MacFocusEngine.shared
        let layer = 901
        let navID = UUID()
        let stageID = UUID()
        defer { engine.remove(navID); engine.remove(stageID) }

        engine.update(navID, .init(
            frame: CGRect(x: 20, y: 120, width: 60, height: 60),
            layer: layer,
            focus: { engine.didFocus(navID, true) },
            activate: { engine.didFocus(navID, false) }
        ))
        engine.didFocus(navID, true)
        XCTAssertTrue(engine.activateFocused(in: nil), "Select clears the transient focus binding")
        XCTAssertNil(engine.focusedID, "selection can clear the transient focus binding before the next key")

        engine.move(.right)
        try? await Task.sleep(for: .milliseconds(200))
        XCTAssertNil(engine.focusedID, "Right from the remembered nav origin waits for lazy Home content")

        engine.update(stageID, .init(frame: card(300, 200), layer: layer, focus: {
            engine.didFocus(stageID, true)
        }))
        for _ in 0..<20 where engine.focusedID != stageID {
            try? await Task.sleep(for: .milliseconds(50))
        }
        XCTAssertEqual(engine.focusedID, stageID, "the Right intent survives a nil focus binding until Home registers")
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
