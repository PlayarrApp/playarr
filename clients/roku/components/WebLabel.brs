' WebLabel.brs: see WebLabel.xml.

sub init()
    m.run = m.top.findNode("run")
end sub

sub onFont()
    meta = PlayarrFontMetaOf(m.top.font)
    if meta <> invalid
        m.top.setFields({ size: meta.px, weight: meta.weight })
    end if
end sub

sub refresh()
    t = m.top
    if t.size <= 0 or t.text = invalid then return
    text = t.text
    tracking = t.tracking
    spec = { text: text, size: t.size, weight: t.weight, tracking: tracking, role: "ink", maxLines: 1, aria: t.aria, symbol: t.symbol }
    ' 0 (fully transparent black) means "not set": -1 is opaque white and must stay a colour the owner can choose.
    if t.color <> 0 then spec.color = t.color
    lineHeight = t.lineHeight
    if lineHeight <= 0 then lineHeight = t.size * 1.364 + t.lineSpacing
    spec.lineHeight = lineHeight
    if t.wrap
        spec.maxLines = t.maxLines
        if spec.maxLines < 1 then spec.maxLines = 99
    end if
    if t.width > 0
        spec.width = t.width
        spec.horizAlign = t.horizAlign
    end if
    m.run.spec = spec
    t.textWidth = m.run.textWidth
    t.lineCount = m.run.lineCount
    y = 0.0
    if t.vertAlign = "center" and t.height > 0 then y = (t.height - m.run.lineCount * lineHeight) / 2
    m.run.translation = [0, y]
end sub
