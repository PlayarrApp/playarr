import QtQuick 2.6
import QtQuick.Window 2.2
import "DpadGeometry.js" as DpadGeometry

// Directional movement uses Qt's actual focus item and geometry. The page key
// handlers see keys bubbled from controls; no focus is represented off-screen.
Item {
    id: root
    property Item page
    property bool moved: false
    property bool keyboardNavigationActive: false
    property Item pendingTarget: null
    property bool longActivated: false
    property int keySequence: 0
    property int nativeSeekSequence: 0
    property int nativeInputSequence: 0
    property int pendingBackKey: 0
    property Item pendingBackOwner: null
    property int completionSequence: 0
    property int nativeReleaseSequence: 0
    property int pendingScrollX: 0
    property int pendingScrollY: 0
    property var pendingGrid: null
    property int pendingGridIndex: -1
    property bool focusRequested: false

    function resetForContent() {
        moved = false
        focusRequested = false
        pendingTarget = null
        focusFirst(true)
    }

    function visibleTarget(item) {
        if (!item || !item.visible || !item.enabled || !item.width || !item.height) return false
        if (page.objectName === "player" && page.menuOpen && !insidePlayerSheet(item)) return false
        var rect = itemRectInPage(item)
        if (rect.x + rect.width <= 0 || rect.y + rect.height <= 0 || rect.x >= page.width || rect.y >= page.height) return false
        for (var p = item.parent; p && p !== page; p = p.parent) {
            if (!p.visible || !p.enabled) return false
            if (p.clip) {
                var clipRect = itemRectInPage(p)
                if (rect.x + rect.width <= clipRect.x || rect.y + rect.height <= clipRect.y || rect.x >= clipRect.x + clipRect.width || rect.y >= clipRect.y + clipRect.height) return false
            }
        }
        return item.navigationFocusable === true || item.objectName.indexOf("parity-nav-") === 0 || (item.activeFocus && item === actualFocus())   // not a Loader or scope that only holds focus for its content
    }
    function itemRectInPage(item) {
        var a = item.mapToItem(page, 0, 0)
        var b = item.mapToItem(page, item.width, 0)
        var c = item.mapToItem(page, 0, item.height)
        var d = item.mapToItem(page, item.width, item.height)
        var left = Math.min(a.x, b.x, c.x, d.x)
        var top = Math.min(a.y, b.y, c.y, d.y)
        var right = Math.max(a.x, b.x, c.x, d.x)
        var bottom = Math.max(a.y, b.y, c.y, d.y)
        return Qt.rect(left, top, right - left, bottom - top)
    }
    function insidePlayerSheet(item) {
        for (var p = item; p && p !== page; p = p.parent) if (p.objectName === "parity-player-sheet") return true
        return false
    }
    function candidates(parent, out) {
        for (var i = 0; i < parent.children.length; ++i) {
            var item = parent.children[i]
            if (visibleTarget(item)) out.push(item)
            candidates(item, out)
        }
    }
    function center(item) {
        var r = itemRectInPage(item)
        return Qt.point(r.x + r.width / 2, r.y + r.height / 2)
    }
    function nextTarget(current, dx, dy) {
        var all = []
        candidates(page, all)
        if (!all.length) return null
        var origin = current && current !== page ? center(current) : Qt.point(page.width / 2, page.height / 2)
        var best = null, bestScore = Number.MAX_VALUE
        for (var i = 0; i < all.length; ++i) {
            var item = all[i]
            if (item === current) continue
            var c = center(item), vx = c.x - origin.x, vy = c.y - origin.y
            var primary = dx ? vx * dx : vy * dy
            if (primary <= 1) continue
            var cross = dx ? Math.abs(vy) : Math.abs(vx)
            var score = primary + cross * 2.5
            if (score < bestScore) { best = item; bestScore = score }
        }
        return best
    }
    // Web D-pad: Up from the floating nav lands on the page's own Up-from-nav control (Search: the field), not the nearest header button.
    function navUpTarget(current) {
        if (!current || current.objectName.indexOf("parity-nav-") !== 0) return null
        var all = []
        candidates(page, all)
        for (var i = 0; i < all.length; ++i) if (all[i].navigationNavUp === true) return all[i]
        return null
    }
    function scrollFor(current, dx, dy) {
        if (!current) return false
        for (var p = current.parent; p && p !== page; p = p.parent) {
            if (dx && p.contentX !== undefined && p.contentWidth > p.width + 1) {
                var sx = Math.max(1, current.width + Number(p.spacing || 0))
                var nx = DpadGeometry.clampedScrollOffset(p.contentX, dx * sx, p.contentWidth, p.width,
                    p.originX, p.leftMargin, p.rightMargin)
                if (nx !== p.contentX) { p.contentX = nx; pendingScrollX = dx; pendingScrollY = 0; revealFocus.restart(); return true }
            }
            if (dy && p.contentY !== undefined && p.contentHeight > p.height + 1) {
                var sy = Math.max(1, Number(p.cellHeight || current.height))
                var ny = DpadGeometry.clampedScrollOffset(p.contentY, dy * sy, p.contentHeight, p.height,
                    p.originY, p.topMargin, p.bottomMargin)
                if (ny !== p.contentY) { p.contentY = ny; pendingScrollX = 0; pendingScrollY = dy; revealFocus.restart(); return true }
            }
        }
        return false
    }
    function actualFocus() {
        // Window.activeFocusItem is available on the Qt 5.6 target. The
        // Window.window attached property was added later and resolves null
        // on Sailfish even though it works in newer host Qt smoke tests.
        var item = page ? page.Window.activeFocusItem : null
        return item && item.activeFocus ? item : null
    }
    function ownsFocus(item) {
        for (var p = item; p; p = p.parent) if (p === page) return true
        return false
    }
    function scrollAtEdge(current, dx, dy) {
        if (!current || current.parityIndex === undefined || current.parityIndex < 0) return false
        for (var p = current.parent; p && p !== page; p = p.parent) {
            if (dx && p.orientation === ListView.Horizontal && p.indexAt) {
                var edgePoint = DpadGeometry.edgePoint(Number(p.contentX || 0), Number(p.contentY || 0), p.width, p.height, dx, 0)
                var edge = p.indexAt(edgePoint.x, edgePoint.y)
                var nextIndex = current.parityIndex + dx
                if (nextIndex >= 0 && nextIndex < p.count && ((dx > 0 && edge <= current.parityIndex) || (dx < 0 && edge >= current.parityIndex))) {
                    return scrollFor(current, dx, 0)
                }
            }
            if (dy && p.contentY !== undefined && p.contentHeight > p.height + 1 && p.cellHeight && p.columns) {
                var currentGridY = current.mapToItem(p, 0, 0).y
                if (DpadGeometry.shouldScrollGridIntoView(current.parityIndex, p.count, p.columns, dy,
                        currentGridY, p.cellHeight, current.height, p.height)) {
                    return scrollFor(current, 0, dy)
                }
            }
        }
        return false
    }
    function gridTargetAt(grid, index) {
        var delegate = grid && grid.itemAtIndex ? grid.itemAtIndex(index) : null
        if (!delegate) return null
        var stack = [delegate]
        while (stack.length) {
            var item = stack.pop()
            if (item.parityIndex === index && item.navigationFocusable === true) return item
            var children = item.children || []
            for (var i = 0; i < children.length; ++i) stack.push(children[i])
        }
        return null
    }
    function moveWithinGrid(current, dx, dy) {
        if (!current || current.parityIndex === undefined) return false
        for (var grid = current.parent; grid && grid !== page; grid = grid.parent) {
            if (grid.columns === undefined || grid.count === undefined || !grid.itemAtIndex || grid.contentY === undefined) continue
            var nextIndex = DpadGeometry.gridNeighbourIndex(current.parityIndex, grid.count, grid.columns, dx, dy)
            if (nextIndex < 0) return false
            var target = gridTargetAt(grid, nextIndex)
            if (target) {
                var targetY = target.mapToItem(grid, 0, 0).y
                var clipped = targetY < 0 || targetY + target.height > grid.height
                if (clipped && scrollFor(current, dx, dy)) {
                    pendingGrid = grid
                    pendingGridIndex = nextIndex
                    return true
                }
                target.forceActiveFocus()
                moved = true
                emitState()
                return true
            }
            if (scrollFor(current, dx, dy)) {
                pendingGrid = grid
                pendingGridIndex = nextIndex
                return true
            }
            return false
        }
        return false
    }
    function focusFirst(force) {
        if ((moved || focusRequested) && !force) return false
        var all = []
        candidates(page, all)
        if (!all.length) { focusRetry.restart(); return false }
        var initial = null
        for (var n = 0; n < all.length; ++n) {
            if (all[n].navigationInitialFocus === true) { initial = all[n]; break }
        }
        var initialMustWait = page.objectName === "profiles" || (page.objectName === "main" && page.section === "settings")
        if (initialMustWait && !initial) { focusRetry.restart(); return false }
        var first = all[0]
        if (initial) first = initial
        else if (page.objectName === "main" && page.section === "home") {
            first = null
            for (var h = 0; h < all.length; ++h) {
                // The profile control also occupies rail/index 0/0. Home's
                // initial target is the first actual work card, once its
                // asynchronous rail delegate has been created.
                if (DpadGeometry.isHomeInitialContentTarget(all[h])) { first = all[h]; break }
            }
            if (!first) { focusRetry.restart(); return false }
        } else {
            for (var c = 0; c < all.length; ++c) {
                if (all[c].parityIndex === 0) { first = all[c]; break }
            }
        }
        if (page.objectName === "player") {
            var wanted = page.menuOpen ? "parity-player-menu-first" : "parity-player-play"
            first = null
            for (var i = 0; i < all.length; ++i) if (all[i].objectName === wanted) { first = all[i]; break }
            // Player controls are created only after playback info arrives.
            // Do not commit focus to an unrelated control while that request is pending.
            if (!first) { focusRetry.restart(); return false }
        }
        first.forceActiveFocus()
        focusRequested = true
        emitState()
        return true
    }
    function emitState() {
        if (pageStack.currentPage !== page) return
        var focus = actualFocus()
        if (focus && !ownsFocus(focus)) return
        var route = page.objectName || ""
        if (route === "detail" && page.work) route = (page.work.kind === "series" ? "/series/" : "/movies/") + page.work.id
        else if (route === "actions" && page.work) route = page.work.kind === "series" ? "/series" : "/movies"
        else if (route === "main") route = page.section === "home" ? "/" : page.section === "calendar" ? "/calendar?view=" + Api.setting("cal.mode", "agenda") : "/" + (page.section || "")
        else if (route === "player") route = "/player/" + page.mediaFileId
        else if (route === "filters") route = "/movies?panel=filters"
        else if (route === "link" || route === "") route = "__unknown__"
        else route = "/" + route
        console.log("PARITY|screen|" + route)
        if (!focus) return
        var label = focus.parityLabel || (focus.work && (focus.work.deckTitle || focus.work.title)) || focus.text || focus.objectName || focus.accessibleName || focus.title || ""
        if (focus.objectName.indexOf("parity-nav-") === 0) label = focus.objectName.slice("parity-nav-".length)
        if (focus.objectName === "parity-player-play") label = page.engine.playbackState === 1 ? "pause" : "play"
        if (focus.objectName === "parity-player-seek") label = "seek"
        if (focus.glyph && focus.text) label = focus.glyph + focus.text
        if (!label) return
        var rail = focus.parityRail === undefined ? "" : focus.parityRail
        var index = focus.parityIndex === undefined ? "" : focus.parityIndex
        console.log("PARITY|focus|" + encodeURIComponent(String(label).toLowerCase()) + "|" + rail + "|" + index)
        var sequence = DpadGeometry.pendingKeySequence()
        if (DpadGeometry.markNavigationSettled(sequence)) scheduleCompleteKey(sequence)
    }
    function completeKey(sequence) {
        if (DpadGeometry.consumeKeyCompletion(sequence)) console.log("PARITY|keydone|" + sequence)
    }
    function scheduleCompleteKey(sequence) {
        if (!sequence) return
        completionSequence = sequence
        completionCheck.restart()
    }
    function beginKey() {
        keySequence = DpadGeometry.beginNavigationKey()
        console.log("PARITY|key|" + keySequence + "|press")
    }
    function activate(item) {
        if (!item) return
        if (typeof item.navigationActivate === "function") { item.navigationActivate(); return }
        if (item.opened) item.opened(item.work)
        else if (item.trigger) item.trigger()
    }
    function isSeekControl(item) {
        for (var p = item; p && p !== page; p = p.parent) if (p.objectName === "parity-player-seek") return true
        return false
    }
    // Slider keys are observed before the native Slider handles them. Keep
    // the same shared sequence if the event also bubbles to the page handler.
    function observeNativeKey(event, pressed) {
        var focus = actualFocus()
        if (!isSeekControl(focus)) return
        var key = event.key
        if (key !== Qt.Key_Left && key !== Qt.Key_Right && key !== Qt.Key_Up && key !== Qt.Key_Down) return
        if (pressed) {
            if (event.isAutoRepeat) return
            var pending = DpadGeometry.pendingKeySequence()
            if (!nativeSeekSequence || nativeSeekSequence !== pending) {
                beginKey()
                nativeSeekSequence = keySequence
            }
            nativeInputSequence = nativeSeekSequence
            return
        }
        var sequence = nativeSeekSequence || DpadGeometry.pendingKeySequence()
        if (DpadGeometry.markNavigationKeyReleased(sequence)) console.log("PARITY|key|" + sequence + "|release")
        if (sequence) {
            nativeInputSequence = sequence
            nativeReleaseSequence = sequence
            nativeReleaseSettle.restart()
        }
    }
    function handlePressed(event) {
        if (event.isAutoRepeat) { event.accepted = true; return }
        var focus = actualFocus()
        var key = event.key
        if (focus && focus.navigationTrap === true && (key === Qt.Key_Left || key === Qt.Key_Right || key === Qt.Key_Up || key === Qt.Key_Down)) {
            beginKey()
            if (typeof focus.navigationTrapMove === "function") focus.navigationTrapMove(key)
            nativeInputSequence = keySequence
            event.accepted = true
            return
        }
        var nativeSeekArrow = isSeekControl(focus) && (key === Qt.Key_Left || key === Qt.Key_Right || key === Qt.Key_Up || key === Qt.Key_Down)
        var pendingSequence = DpadGeometry.pendingKeySequence()
        if (nativeSeekArrow && nativeSeekSequence && nativeSeekSequence === pendingSequence) {
            keySequence = nativeSeekSequence
        } else {
            beginKey()
            if (nativeSeekArrow) nativeSeekSequence = keySequence
        }
        if (focus && focus.text !== undefined && focus.cursorPosition !== undefined) {
            if (key === Qt.Key_Left || key === Qt.Key_Right || ((key === Qt.Key_Up || key === Qt.Key_Down) && focus.lineCount > 1)
                || key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Space) {
                nativeInputSequence = keySequence
                return
            }
        }
        if (focus && (focus.currentIndex !== undefined || focus.value !== undefined) && (key === Qt.Key_Up || key === Qt.Key_Down || key === Qt.Key_Left || key === Qt.Key_Right)) {
            nativeInputSequence = keySequence
            return
        }
        var dx = key === Qt.Key_Left ? -1 : key === Qt.Key_Right ? 1 : 0
        var dy = key === Qt.Key_Up ? -1 : key === Qt.Key_Down ? 1 : 0
        if (dx || dy) {
            keyboardNavigationActive = true
            if (moveWithinGrid(focus, dx, dy)) { moved = true; event.accepted = true; return }
            if (scrollAtEdge(focus, dx, dy)) { moved = true; event.accepted = true; return }
            var target = dy < 0 ? navUpTarget(focus) : null
            if (!target) target = nextTarget(focus, dx, dy)
            if (!target && scrollFor(focus, dx, dy)) { moved = true; event.accepted = true; return }
            if (target) {
                target.forceActiveFocus()
                moved = true
                emitState()
                event.accepted = true
                return
            }
            DpadGeometry.markNavigationSettled(keySequence)
            scheduleCompleteKey(keySequence)
            return
        }
        if (key === Qt.Key_Return || key === Qt.Key_Enter || key === Qt.Key_Select || key === Qt.Key_Space) {
            if (event.isAutoRepeat) { event.accepted = true; return }
            pendingTarget = focus
            longActivated = false
            longPress.restart()
            event.accepted = true
        }
    }
    function handleReleased(event) {
        var focus = actualFocus()
        var nativeSeekArrow = isSeekControl(focus) && (event.key === Qt.Key_Left || event.key === Qt.Key_Right || event.key === Qt.Key_Up || event.key === Qt.Key_Down)
        var keySequenceForRelease = nativeSeekArrow && nativeSeekSequence ? nativeSeekSequence : DpadGeometry.pendingKeySequence()
        if (DpadGeometry.markNavigationKeyReleased(keySequenceForRelease)) console.log("PARITY|key|" + keySequenceForRelease + "|release")
        if (nativeInputSequence === keySequenceForRelease) {
            DpadGeometry.markNavigationSettled(keySequenceForRelease)
            nativeInputSequence = 0
            scheduleCompleteKey(keySequenceForRelease)
        }
        if (nativeSeekArrow && nativeReleaseSequence === keySequenceForRelease) nativeReleaseSettle.stop()
        if (pendingBackKey === event.key) {
            var backSequence = keySequenceForRelease
            pendingBackKey = 0
            if (pendingBackOwner) {
                var owner = pendingBackOwner
                pendingBackOwner = null
                owner.navigationBack()
            } else if (page.objectName === "player" && page.menuOpen) {
                page.menuOpen = false
                var all = []
                candidates(page, all)
                for (var i = 0; i < all.length; ++i) {
                    if (all[i].objectName === "parity-player-menu") { all[i].forceActiveFocus(); emitState(); break }
                }
            } else if (page.objectName === "player") page.close(false)
            else if (pageStack.depth > 1) pageStack.pop()
            if (pageStack.currentPage === page) {
                emitState()
                scheduleCompleteKey(backSequence)
            }
            event.accepted = true
            return
        }
        var sequence = keySequenceForRelease
        if (event.key !== Qt.Key_Return && event.key !== Qt.Key_Enter && event.key !== Qt.Key_Select && event.key !== Qt.Key_Space) {
            scheduleCompleteKey(sequence)
            return
        }
        longPress.stop()
        if (!longActivated) activate(pendingTarget)
        else if (pendingTarget && typeof pendingTarget.navigationLongPress === "function") pendingTarget.navigationLongPress()
        pendingTarget = null
        if (pageStack.currentPage === page) {
            emitState()
            scheduleCompleteKey(sequence)
        }
        event.accepted = true
    }
    function handleBack(event) {
        if (event.key !== Qt.Key_Escape && event.key !== Qt.Key_Back && event.key !== Qt.Key_Backspace) return false
        if (event.isAutoRepeat) { event.accepted = true; return true }
        var focus = actualFocus()
        if (event.key === Qt.Key_Backspace && focus && focus.text !== undefined && focus.cursorPosition !== undefined) return false
        var owner = null
        for (var p = focus; p && p !== page; p = p.parent) {
            if (typeof p.navigationBack === "function") { owner = p; break }
        }
        if (!owner && !(page.objectName === "player" || pageStack.depth > 1)) return false
        beginKey()
        pendingBackKey = event.key
        pendingBackOwner = owner
        event.accepted = true
        return true
    }
    Timer {
        id: longPress
        interval: 650
        repeat: false
        onTriggered: {
            if (root.pendingTarget && typeof root.pendingTarget.navigationLongPress === "function") {
                root.longActivated = true
            }
        }
    }
    Timer {
        id: completionCheck
        interval: 0
        repeat: false
        onTriggered: root.completeKey(root.completionSequence)
    }
    Timer {
        id: nativeReleaseSettle
        interval: 0
        repeat: false
        onTriggered: {
            var sequence = root.nativeReleaseSequence
            root.nativeReleaseSequence = 0
            if (DpadGeometry.markNavigationSettled(sequence)) root.scheduleCompleteKey(sequence)
        }
    }
    Timer {
        id: focusRetry
        interval: 80
        repeat: false
        onTriggered: root.focusFirst()
    }
    Timer {
        id: revealFocus
        interval: 0
        repeat: false
        onTriggered: {
            var target = root.pendingGrid && root.pendingGridIndex >= 0 ? root.gridTargetAt(root.pendingGrid, root.pendingGridIndex) : null
            var gridPending = root.pendingGrid && root.pendingGridIndex >= 0
            root.pendingGrid = null
            root.pendingGridIndex = -1
            if (!gridPending) target = root.nextTarget(root.actualFocus(), root.pendingScrollX, root.pendingScrollY)
            if (target) { target.forceActiveFocus(); root.emitState() }
            else {
                var sequence = DpadGeometry.pendingKeySequence()
                if (DpadGeometry.markNavigationSettled(sequence)) root.scheduleCompleteKey(sequence)
            }
            root.pendingScrollX = 0
            root.pendingScrollY = 0
        }
    }
    Connections {
        target: page
        onActiveFocusChanged: if (pageStack.currentPage === page) root.emitState()
    }
    Connections {
        target: page
        ignoreUnknownSignals: true
        onMenuOpenChanged: {
            if (pageStack.currentPage !== page) return
            root.focusRequested = false
            if (page.menuOpen) root.focusFirst(true)
            else if (page.objectName === "player") {
                var all = []
                root.candidates(page, all)
                for (var i = 0; i < all.length; ++i) {
                    if (all[i].objectName === "parity-player-menu") { all[i].forceActiveFocus(); root.emitState(); break }
                }
            }
        }
    }
    Connections {
        target: page ? page.Window : null
        onActiveFocusItemChanged: if (pageStack.currentPage === page) root.emitState()
    }
    Component.onCompleted: focusFirst()
}
