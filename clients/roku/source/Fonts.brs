' Fonts.brs
'
' Web typeface for SceneGraph labels. The web client draws every label in Nunito Sans (weights 300 to 800) and a few
' figures in JetBrains Mono. Roku cannot take a variable font, so pkg:/fonts holds static instances cut from
' docs/parity/fonts (fontTools varLib.instancer at wght=300/400/500/600/700/800 for Nunito Sans, 400/700 for
' JetBrains Mono). They are attached from BrightScript through the documented Font node (uri + size). A Font child
' declared in the component XML renders no text on the device; this route does (verified on a Streaming Stick 4K).
'
' Labels in the XML keep their historic `scale` (size N drawn as scale N/32 of the system font). PlayarrFontifyTree turns
' that into a real font of size N with the geometry the scale produced (scale about scaleRotateCenter), so the glyphs are
' rasterised at their final size instead of being stretched.

function PlayarrInstanceWeight(weight as Integer) as Integer
    ' The bundled instances are 300 to 900 in steps of 100: the nearest one is within 50 of any web weight.
    w = Int((weight + 50) / 100) * 100
    if w < 300 then w = 300
    if w > 900 then w = 900
    return w
end function

' The font file's descent band for a pixel size: Roku sizes a Label as ceil(ascent) + ceil(descent) + 1, so each band carries the
' descent that makes the Label as tall as the web's line box (scripts/make_font_data.py).
function PlayarrBandFor(size as Integer) as String
    if size <= 12 then return "a"
    if size <= 23 then return "b"
    if size <= 39 then return "c"
    return "d"
end function

' The (weight -> bands) cut at the web's own weights; keep equal to EXACT in scripts/make_font_data.py. The 100-step instances exist in every band.
function PlayarrExactBands() as Object
    return { "300": "d", "400": "ab", "480": "c", "500": "d", "560": "bcd", "570": "b", "580": "c", "590": "c", "600": "b", "610": "ab", "640": "ab", "650": "b", "680": "ab", "690": "a", "700": "ab", "720": "abc", "750": "b", "760": "ab", "820": "a", "860": "a", "900": "ab" }
end function

' The weight the Label really draws for a web weight at a pixel size: the instance cut at the web's own weight when the package has one
' (fonts/NunitoSans-<weight>-<band>.ttf, scripts/make_font_data.py EXACT), otherwise the nearest hundred.
function PlayarrDrawnWeight(weight as Integer, size as Integer) as Integer
    g = GetGlobalAA()
    key = "playarrDrawn_" + weight.ToStr() + "_" + PlayarrBandFor(size)
    if g[key] <> invalid then return g[key]
    drawn = PlayarrInstanceWeight(weight)
    bands = PlayarrExactBands()[weight.ToStr()]
    if bands <> invalid and Instr(1, bands, PlayarrBandFor(size)) > 0 then drawn = weight
    if drawn <> weight and weight mod 100 = 0 then drawn = weight
    g[key] = drawn
    return drawn
end function

function PlayarrFontPath(weight as Integer, mono = false as Boolean, size = 0 as Integer) as String
    if mono
        if weight >= 600 then return "pkg:/fonts/JetBrainsMono-700.ttf"
        return "pkg:/fonts/JetBrainsMono-400.ttf"
    end if
    return "pkg:/fonts/NunitoSans-" + PlayarrDrawnWeight(weight, size).ToStr() + "-" + PlayarrBandFor(size) + ".ttf"
end function

' A Font node takes an integer size: the font is cut at the nearest whole pixel and a Label scales it to the web's fractional size
' (PlayarrScaleFor), so the glyphs are the web's size to the hundredth.
function PlayarrMakeFont(weight as Integer, size as Float, mono = false as Boolean) as Object
    key = "playarrFont_" + weight.ToStr() + "_" + Str(size) + "_" + mono.ToStr()
    g = GetGlobalAA()
    if g[key] <> invalid then return g[key]
    font = CreateObject("roSGNode", "Font")
    font.size = Int(size + 0.5)
    font.uri = PlayarrFontPath(weight, mono, font.size)
    g[key] = font
    if g.fontMeta = invalid then g.fontMeta = {}
    g.fontMeta[font.uri + "|" + Str(font.size)] = { px: size, weight: weight }
    return font
end function

' Scale of a Label drawn with PlayarrMakeFont(weight, size): web size / the whole-pixel size of its Font node.
function PlayarrScaleFor(size as Float) as Float
    n = Int(size + 0.5)
    if n < 1 then return 1.0
    return size / n
end function

' Advance data of one instance (fonts/NunitoSans-<weight>.json: advances and pair kerning in units of 1000 per em).
function PlayarrFontData(weight as Integer) as Object
    g = GetGlobalAA()
    w = Int((weight + 5) / 10) * 10
    if w < 300 then w = 300
    if w > 900 then w = 900
    key = "playarrFontData_" + w.ToStr()
    if g[key] = invalid
        data = ParseJson(ReadAsciiFile("pkg:/fonts/NunitoSans-" + w.ToStr() + ".json"))
        if data = invalid then data = { adv: {}, kern: {} }
        g[key] = data
    end if
    return g[key]
end function

' Width of `text` in px as the web sets it: web advances at the real (fractional) size, kerning, then `tracking` per character.
function PlayarrTextWidth(text as String, size as Float, weight as Integer, tracking = 0 as Float) as Float
    data = PlayarrFontData(weight)
    units = 0
    previous = ""
    for i = 1 to Len(text)
        ch = Asc(Mid(text, i, 1)).ToStr()
        a = data.adv[ch]
        if a = invalid then a = data.adv["110"]
        if a = invalid then a = 560
        units = units + a
        if previous <> ""
            k = data.kern[previous + "_" + ch]
            if k <> invalid then units = units + k
        end if
        previous = ch
    end for
    return units * size / 1000 + tracking * Len(text)
end function

' Weight for a label id (web weights, see global.css). Unknown ids use 400, and big display text 700.
function PlayarrWeightFor(id as String, size as Integer) as Integer
    if id = "stageTitleLabel" or id = "browsePreviewTitle" or id = "browseTitle" then return 600
    if id = "browseCountLabel" then return 700
    if id = "stageMetaLabel" or id = "stageOverviewLabel" then return 400
    if id = "browsePreviewMeta" or id = "browsePreviewOverview" then return 400
    if id = "browseFiltersButton" then return 700
    if id = "title" then return 600
    if Instr(1, id, "Kicker") > 0 then return 800
    if Instr(1, id, "Title") > 0 then return 700
    if Instr(1, id, "Heading") > 0 then return 700
    if Instr(1, id, "navLabel") = 1 then return 600
    if Instr(1, id, "clockTime") = 1 then return 700
    if Instr(1, id, "clockDate") = 1 then return 600
    if Instr(1, id, "profileLabel") = 1 then return 600
    if Instr(1, id, "ButtonLabel") > 0 then return 700
    if Instr(1, id, "Code") > 0 then return 700
    if size >= 40 then return 700
    return 400
end function

function PlayarrIsMonoLabel(id as String) as Boolean
    return id = "pairingCode"
end function

' The web type of labels declared in XML, by id: CSS px size, weight and letter-spacing (px) read from the web layout dump
' (docs/parity/LAYOUT.md). A label without an entry keeps the size its `scale` implies.
function PlayarrTypeFor(scope as String, id as String) as Dynamic
    g = GetGlobalAA()
    if g.typeTable = invalid
        g.typeTable = {
            clockTime: { size: 17.28, weight: 760, tracking: -0.526 }
            clockDate: { size: 11.14, weight: 640, tracking: 0.435 }
            profileLabel: { size: 8.83, weight: 680, tracking: 0.31, role: "inkMuted" }
            userVersion: { size: 8, weight: 700, tracking: 1.358, role: "ink" }
            "TvStage.stageMetaLabel": { size: 12.86, weight: 600, tracking: 0, role: "heroSoft" }
            "ProfileAvatar.name": { size: 17.28, weight: 680, tracking: 0 }
            "ProfileAvatar.status": { size: 9.41, weight: 690, tracking: 0.413, role: "inkMuted" }
            profilesThemeLabel: { size: 11.52, weight: 720, tracking: 0 }
            profilesLangLabel: { size: 11.52, weight: 720, tracking: 0 }
            searchEmptyHint: { size: 13.82, weight: 400, tracking: 0, role: "inkMuted", lineHeight: 22.4 }
            searchFieldLabel: { size: 17.66, weight: 400, tracking: 0, role: "inkMuted" }
            searchEmptyLabel: { size: 16.9, weight: 650, tracking: -0.349, role: "ink" }
            "PosterCard.title": { size: 11.9, weight: 610, tracking: -0.183 }
            "PosterCard.kind": { size: 8.83, weight: 400, tracking: 0 }
        }
    end if
    entry = g.typeTable[scope + "." + id]
    if entry = invalid then entry = g.typeTable[id]
    return entry
end function

' Replace an XML Label (sized by `scale`) by a WebLabel of the same id and the geometry the scale produced (scale about
' scaleRotateCenter), so text is set at the web's own advances (see components/WebLabel.xml). `weight` < 0 picks from the id.
function PlayarrFontifyLabel(label as Object, scope = "" as String, weight = -1 as Integer) as Object
    s = label.scale
    sx = 1.0
    if s <> invalid then sx = s[0]
    if sx = 1 then return label
    size = 32 * sx
    if weight < 0 then weight = PlayarrWeightFor(label.id, Int(size + 0.5))
    c = label.scaleRotateCenter
    t = label.translation
    w = label.width
    x = t[0] + c[0] * (1 - sx)
    newW = w * sx
    ' A centred, single-line label scaled about its horizontal middle keeps its box: the text stays centred on the same
    ' point, and code that repositions such labels at run time keeps working.
    if label.horizAlign = "center" and not label.wrap and Abs(c[0] - w / 2) < 1
        x = t[0]
        newW = w
    end if
    web = CreateObject("roSGNode", "WebLabel")
    web.id = label.id
    web.translation = [x, t[1] + c[1] * (1 - sx)]
    tracking = 0.0
    typed = PlayarrTypeFor(scope, label.id)
    if typed <> invalid
        size = typed.size
        weight = typed.weight
        tracking = typed.tracking
        if typed.lineHeight <> invalid then web.lineHeight = typed.lineHeight
    end if
    web.setFields({ size: size, weight: weight, tracking: tracking, width: newW, height: label.height * sx, horizAlign: label.horizAlign, vertAlign: label.vertAlign, wrap: label.wrap, maxLines: label.maxLines, visible: label.visible, opacity: label.opacity })
    if label.lineSpacing <> 0 then web.lineSpacing = label.lineSpacing * sx
    web.color = label.color
    if typed <> invalid and typed.role <> invalid
        web.color = ThemeColor(typed.role)
        ThemeSetRole(web, typed.role)
    end if
    web.text = label.text
    parent = label.getParent()
    index = 0
    for i = 0 to parent.getChildCount() - 1
        if parent.getChild(i).isSameNode(label)
            index = i
            exit for
        end if
    end for
    parent.insertChild(web, index)
    parent.removeChild(label)
    return web
end function

sub PlayarrFontifyTree(node as Object, scope = "" as String)
    children = []
    for i = 0 to node.getChildCount() - 1
        children.Push(node.getChild(i))
    end for
    for each child in children
        if child = invalid then continue for
        if child.subtype() = "Label"
            PlayarrFontifyLabel(child, scope)
        else if child.subtype() <> "WebLabel" and child.subtype() <> "TrackedText"
            PlayarrFontifyTree(child, scope)
        end if
    end for
end sub

function PlayarrFontMetaOf(font as Object) as Dynamic
    g = GetGlobalAA()
    if font = invalid or g.fontMeta = invalid then return invalid
    return g.fontMeta[font.uri + "|" + Str(font.size)]
end function

' Symbol glyphs the web draws from its fallback fonts (Nunito Sans has none of them): arrows, play, check, the sort chevron and a
' fullwidth plus. fonts/Symbols.ttf is a subset of DejaVu Sans (Bitstream Vera licence) and fonts/SymbolsCjk.otf one glyph of
' Noto Sans CJK (SIL OFL). fonts/SymbolsBold.ttf is the same glyphs from DejaVu Sans Bold, used for weights of 600 and up.
function PlayarrSymbolFont(ch as String, size as Float, weight = 400 as Integer) as Object
    path = "pkg:/fonts/Symbols.ttf"
    if weight >= 600 then path = "pkg:/fonts/SymbolsBold.ttf"
    if ch = "＋" then path = "pkg:/fonts/SymbolsCjk.otf"
    key = "playarrSymbol_" + path + "_" + Str(size)
    g = GetGlobalAA()
    if g[key] <> invalid then return g[key]
    font = CreateObject("roSGNode", "Font")
    font.uri = path
    font.size = Int(size + 0.5)
    g[key] = font
    return font
end function

' Bottom edge (in the label's parent) of the glyph Labels a WebLabel laid out, as Roku reports their boxes.
function PlayarrTextBottom(web as Object) as Float
    runNode = web.findNode("run")
    if runNode = invalid then return web.translation[1] + web.boundingRect().height
    bottom = 0.0
    for i = 0 to runNode.getChildCount() - 1
        g = runNode.getChild(i)
        if g.visible and g.text <> ""
            gb = g.translation[1] + g.boundingRect().height
            if gb > bottom then bottom = gb
        end if
    end for
    return web.translation[1] + runNode.translation[1] + bottom
end function

' The weight a symbol Label really draws: the regular or the bold symbol face (the CJK plus has one weight).
function PlayarrSymbolWeight(ch as String, weight as Integer) as Integer
    if ch = "＋" then return 400
    if weight >= 600 then return 700
    return 400
end function

' CSS layout input only (where a text node is drawn): the height Blink gives a line of Nunito Sans. It is never assigned to a Label and the
' exporter does not use it; exported text boxes are the bounds the Roku lays out. Blink rounds the font's ascent (1.011 em) and descent (0.353 em, the hhea values
' of the variable font; the bundled instances keep the ascent and carry banded descents) to whole pixels and adds them.
function PlayarrContentHeight(size as Float) as Float
    return Int(1.011 * size + 0.5) + Int(0.353 * size + 0.5)
end function

' Top of the text box Blink gives a line of Nunito Sans: the line box top plus the half-leading, (line-height - content height) / 2
' floored to whole pixels (FontHeight::AddLeading), where the content height is PlayarrContentHeight. A text node that is
' positioned by its text box (a TrackedText, a WebLabel) is placed at this value instead of a hand-set offset.
function PlayarrTextTop(lineTop as Float, size as Float, lineHeight as Float) as Float
    return lineTop + Int((lineHeight - PlayarrContentHeight(size)) / 2)
end function
