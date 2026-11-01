' TrackedText.brs: see TrackedText.xml.

sub init()
    m.measure = m.top.findNode("measure")
    m.pool = []
    m.used = 0
end sub

sub onSpecChange()
    spec = m.top.spec
    if spec = invalid or spec.text = invalid then return
    text = spec.text
    if spec.upper = true then text = UCase(text)
    size = spec.size
    weight = spec.weight
    tracking = 0.0
    if spec.tracking <> invalid then tracking = spec.tracking
    font = PlayarrMakeFont(weight, size)
    m.measure.font = font
    m.size = size
    m.weight = weight
    wrapWidth = 0.0
    if spec.width <> invalid then wrapWidth = spec.width
    maxLines = 1
    if spec.maxLines <> invalid then maxLines = spec.maxLines
    lineHeight = size * 1.3
    if spec.lineHeight <> invalid then lineHeight = spec.lineHeight

    lines = [text]
    if wrapWidth > 0 then lines = wrapLines(text, wrapWidth, tracking, maxLines, spec.balance = true)

    ' Free every pooled glyph, then lay the lines out.
    for each glyph in m.pool
        glyph.visible = false
    end for
    m.used = 0
    ' Untracked text is set a whole line per Label; a clamped last line ends in an ellipsis at a word boundary, like
    ' -webkit-line-clamp.
    wholeLines = false
    if tracking = 0 and m.overflow = true and lines.Count() > 0
        last = lines[lines.Count() - 1]
        while Len(last) > 0 and lineWidth(last + "…", 0) > wrapWidth
            cut = 0
            for k = Len(last) to 1 step -1
                if Mid(last, k, 1) = " "
                    cut = k
                    exit for
                end if
            end for
            if cut = 0 then exit while
            last = Left(last, cut - 1)
        end while
        lines[lines.Count() - 1] = last + "…"
    end if
    for lineIndex = 0 to lines.Count() - 1
        line = lines[lineIndex]
        lineOffset = 0.0
        if wrapWidth > 0 and spec.horizAlign = "center"
            lineOffset = (wrapWidth - lineWidth(line, tracking)) / 2
        else if wrapWidth > 0 and spec.horizAlign = "right"
            lineOffset = wrapWidth - lineWidth(line, tracking)
        end if
        ' Untracked text is one Label per word, tracked text one per character, each at the web's own position.
        i = 1
        total = Len(line)
        while i <= total
            ch = Mid(line, i, 1)
            if ch = " "
                i = i + 1
            else
                j = i
                if tracking = 0
                    while j < total and Mid(line, j + 1, 1) <> " "
                        j = j + 1
                    end while
                end if
                word = Mid(line, i, j - i + 1)
                ' Roku rounds every advance, so a word's Label ends short of or past the web's word. The last character is a Label of its
                ' own at its web position (suffix ~t, joined to the word before it), so the run ends where the web's does.
                parts = [{ text: word, x: advanceOf(Left(line, j)) - advanceOf(word) + tracking * (i - 1), tail: false }]
                if tracking = 0 and spec.symbol <> true and Len(word) > 1
                    last = Right(word, 1)
                    parts = [{ text: Left(word, Len(word) - 1), x: parts[0].x, tail: false }, { text: last, x: advanceOf(Left(line, j)) - advanceOf(last), tail: true }]
                end if
                for each pp in parts
                    pp.last = false
                end for
                parts[parts.Count() - 1].last = true
                for each part in parts
                piece = part.text
                x = part.x
                glyph = nextGlyph()
                glyph.font = font
                glyph.width = 0
                glyph.height = 0
                ' A single line is as tall as the web's text box (rounded ascent plus descent). The Label is scaled to the web's fractional
                ' size, so its own height is that box divided by the scale; the glyphs stay top-aligned where they were.
                if spec.symbol <> true then glyph.height = PlayarrContentHeight(size) / PlayarrScaleFor(size)
                ' The Font node is a whole pixel size: scale the Label to the web's fractional size about its top-left corner.
                glyph.scaleRotateCenter = [0, 0]
                glyph.scale = [PlayarrScaleFor(size), PlayarrScaleFor(size)]
                if spec.symbol = true
                    glyph.font = PlayarrSymbolFont(piece, size, weight)
                end if
                ' The font actually drawn (the bundled instance's weight, the integer pixel size the Font node takes), readable through ECP query/app-ui (node names are printed; fonts are not).
                drawnWeight = PlayarrDrawnWeight(weight, Int(size + 0.5))
                if spec.symbol = true then drawnWeight = PlayarrSymbolWeight(piece, weight)
                glyph.id = "f" + Str(drawnWeight).Trim() + "s" + Str(Int(size + 0.5)).Trim()
                ' Untracked text is set a word per Label, tracked text a character per Label: the export joins words with a space and characters directly.
                if part.tail then
                    glyph.id = glyph.id + "~t"
                else if tracking = 0 then
                    glyph.id = glyph.id + "~w"
                else
                    glyph.id = glyph.id + "~c"
                end if
                role = "text"
                if spec.aria <> invalid and spec.aria <> "" then role = spec.aria
                if role <> "text" then glyph.id = glyph.id + "|" + role
                glyph.text = piece
                ' The Label keeps the box Roku lays out for its glyph run (width and height of the font as the firmware reports them).
                if spec.color <> invalid
                    glyph.color = spec.color
                    ' An explicit colour belongs to the owner (a WebLabel re-themes itself): keep the scene's theme pass off this glyph.
                    if not glyph.hasField("themeRole") then glyph.addFields({ themeRole: "" })
                    glyph.themeRole = "-"
                else
                    glyph.color = ThemeColor(spec.role)
                    ThemeSetRole(glyph, spec.role)
                end if
                glyph.translation = [lineOffset + x, lineIndex * lineHeight]
                ' The last Label of a line ends where the web's run ends: the box the firmware lays out for it (its real bounding rect, at the
                ' web's fractional scale) is set so that its right edge is the web's advance end of the line.
                if j = total and spec.symbol <> true and part.last = true
                    boxWidth = glyph.boundingRect().width * PlayarrScaleFor(size)
                    glyph.translation = [lineOffset + x + advanceOf(piece) - boxWidth, lineIndex * lineHeight]
                end if
                glyph.visible = true
                end for
                i = j + 1
            end if
        end while
    end for
    widest = 0.0
    for each line in lines
        w = lineWidth(line, tracking)
        if w > widest then widest = w
    end for
    m.top.textWidth = widest
    m.top.lineCount = lines.Count()
end sub

function nextGlyph() as Object
    if m.used >= m.pool.Count()
        glyph = CreateObject("roSGNode", "Label")
        glyph.vertAlign = "top"
        m.top.AppendChild(glyph)
        m.pool.Push(glyph)
    end if
    glyph = m.pool[m.used]
    m.used = m.used + 1
    return glyph
end function

' Width of `prefix` as the web sets it (web advances at the real size, kerning included; fonts/NunitoSans-<w>.json).
function advanceOf(prefix as String) as Float
    return PlayarrTextWidth(prefix, m.size, m.weight, 0)
end function

function lineWidth(line as String, tracking as Float) as Float
    return PlayarrTextWidth(line, m.size, m.weight, tracking)
end function

' Greedy word wrap into `width`; with `balance`, the narrowest width that keeps the same number of lines (CSS text-wrap: balance).
function wrapLines(text as String, width as Float, tracking as Float, maxLines as Integer, balance as Boolean) as Object
    lines = greedy(text, width, tracking)
    if balance and lines.Count() > 1
        low = 0.0
        for each line in lines
            w = lineWidth(line, tracking)
            if w > low then low = w
        end for
        count = lines.Count()
        ' Binary search the smallest box that still wraps to `count` lines.
        lo = 1.0
        hi = low
        best = lines
        for pass = 1 to 8
            mid = (lo + hi) / 2
            trial = greedy(text, mid, tracking)
            if trial.Count() <= count
                best = trial
                hi = mid
            else
                lo = mid
            end if
        end for
        lines = best
    end if
    m.overflow = lines.Count() > maxLines
    if lines.Count() > maxLines
        trimmed = []
        for i = 0 to maxLines - 1
            trimmed.Push(lines[i])
        end for
        lines = trimmed
    end if
    return lines
end function

function greedy(text as String, width as Float, tracking as Float) as Object
    words = []
    current = ""
    for i = 1 to Len(text)
        ch = Mid(text, i, 1)
        if ch = " "
            if current <> "" then words.Push(current)
            current = ""
        else
            current = current + ch
        end if
    end for
    if current <> "" then words.Push(current)
    lines = []
    line = ""
    for each word in words
        trial = word
        if line <> "" then trial = line + " " + word
        if line <> "" and lineWidth(trial, tracking) > width
            lines.Push(line)
            line = word
        else
            line = trial
        end if
    end for
    if line <> "" then lines.Push(line)
    if lines.Count() = 0 then lines.Push("")
    return lines
end function
