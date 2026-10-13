function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press or key <> "right" or not m.top.alphabetHandoffEnabled then return false

    columns = m.top.numColumns
    itemIndex = m.top.itemFocused
    if columns < 1 then return false
    if itemIndex = invalid then return false
    if itemIndex < 0 then return false
    content = m.top.content
    if content = invalid then return false
    itemCount = content.GetChildCount()
    if itemCount < 1 or itemIndex >= itemCount then return false
    edgeMatch = (itemIndex mod columns = columns - 1) or (itemIndex = itemCount - 1)
    emitBrowseGridHandoffDiagnostic("right", itemIndex, columns, edgeMatch)
    if not edgeMatch then return false

    ' Let MainScene focus the existing active alphabet entry. The grid selection stays on the grid,
    ' so Back from the alphabet restores focus to the same card.
    m.top.alphabetHandoffRequest = m.top.alphabetHandoffRequest + 1
    return true
end function

sub emitBrowseGridHandoffDiagnostic(action as String, itemIndex as Integer, columns as Integer, edgeMatch as Boolean)
    if m.global.parityArtEnabled <> true then return
    if action <> "right" or itemIndex < 0 or itemIndex > 1000 or columns < 1 or columns > 100 then return
    edgeText = "0"
    if edgeMatch then edgeText = "1"
    print "PARITY|browseGridHandoff|" + action + "|" + itemIndex.ToStr() + "|" + columns.ToStr() + "|" + edgeText
end sub
