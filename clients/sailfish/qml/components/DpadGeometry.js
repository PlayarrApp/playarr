.pragma library

var navigationSequence = 0
var pendingNavigationSequence = 0
var navigationKeyReleased = false
var navigationSettled = false

function beginNavigationKey() {
    navigationSequence += 1
    pendingNavigationSequence = navigationSequence
    navigationKeyReleased = false
    navigationSettled = false
    return navigationSequence
}

function pendingKeySequence() {
    return pendingNavigationSequence
}

function consumeKeyCompletion(sequence) {
    if (!sequence || sequence !== pendingNavigationSequence || !navigationKeyReleased || !navigationSettled) return false
    pendingNavigationSequence = 0
    navigationKeyReleased = false
    navigationSettled = false
    return true
}

function markNavigationKeyReleased(sequence) {
    if (!sequence || sequence !== pendingNavigationSequence || navigationKeyReleased) return false
    navigationKeyReleased = true
    return true
}

function markNavigationSettled(sequence) {
    if (!sequence || sequence !== pendingNavigationSequence) return false
    navigationSettled = true
    return true
}

function edgePoint(contentX, contentY, width, height, dx, dy) {
    return {
        x: contentX + (dx ? (dx > 0 ? width - 1 : 1) : width / 2),
        y: contentY + (dy ? (dy > 0 ? height - 1 : 1) : height / 2)
    }
}

function shouldScrollGrid(index, count, columns, edgeIndex, dy) {
    if (edgeIndex < 0) return false
    var row = Math.floor(index / columns)
    var edgeRow = Math.floor(edgeIndex / columns)
    var target = index + dy * columns
    return target >= 0 && target < count && (dy > 0 ? row >= edgeRow : row <= edgeRow)
}

function gridNeighbourIndex(index, count, columns, dx, dy) {
    if (index < 0 || index >= count || columns < 1 || count === 0) return -1
    var column = index % columns
    if (dx < 0) return column > 0 ? index - 1 : -1
    if (dx > 0) return column < columns - 1 && index + 1 < count ? index + 1 : -1
    if (dy < 0) return index - columns >= 0 ? index - columns : -1
    if (dy > 0) {
        var candidate = index + columns
        if (candidate < count) return candidate
        return count - 1 > index ? count - 1 : -1
    }
    return -1
}

function shouldScrollGridIntoView(index, count, columns, dy, currentItemY, cellHeight, itemHeight, viewportHeight) {
    var target = index + dy * columns
    if (target < 0 || target >= count || columns <= 0 || cellHeight <= 0 || itemHeight <= 0 || viewportHeight <= 0) return false
    var targetTop = currentItemY + dy * cellHeight
    return dy > 0 ? targetTop + itemHeight > viewportHeight : dy < 0 ? targetTop < 0 : false
}

function clampedScrollOffset(offset, delta, contentExtent, viewportExtent, origin, leadingMargin, trailingMargin) {
    var min = Number(origin || 0) - Number(leadingMargin || 0)
    var max = Math.max(min, Number(origin || 0) + contentExtent - viewportExtent + Number(trailingMargin || 0))
    return Math.max(min, Math.min(max, offset + delta))
}

function isHomeInitialContentTarget(item) {
    return !!item && !!item.work && item.parityRail === 0 && item.parityIndex === 0
}
