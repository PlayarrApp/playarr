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

function PlayarrFontPath(weight as Integer, mono = false as Boolean) as String
    if mono
        if weight >= 600 then return "pkg:/fonts/JetBrainsMono-700.ttf"
        return "pkg:/fonts/JetBrainsMono-400.ttf"
    end if
    return "pkg:/fonts/NunitoSans-" + PlayarrInstanceWeight(weight).ToStr() + ".ttf"
end function

' A Font node takes an integer size: a fractional web size rounds to the nearest pixel (within the scorer's 0.5 px).
function PlayarrMakeFont(weight as Integer, size as Float, mono = false as Boolean) as Object
    key = "playarrFont_" + weight.ToStr() + "_" + Str(size) + "_" + mono.ToStr()
    g = GetGlobalAA()
    if g[key] <> invalid then return g[key]
    font = CreateObject("roSGNode", "Font")
    font.uri = PlayarrFontPath(weight, mono)
    font.size = Int(size + 0.5)
    g[key] = font
    if g.fontMeta = invalid then g.fontMeta = {}
    g.fontMeta[font.uri + "|" + Str(font.size)] = { px: size, weight: weight }
    return font
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
            clockTime: { size: 17.28, weight: 760, tracking: -0.526, boxH: 25.92 }
            clockDate: { size: 11.14, weight: 640, tracking: 0.435, boxH: 12.25 }
            profileLabel: { size: 8.83, weight: 680, tracking: 0.31, role: "inkMuted" }
            userVersion: { size: 8, weight: 700, tracking: 1.358, role: "ink", boxH: 8 }
            "TvStage.stageMetaLabel": { size: 12.86, weight: 600, tracking: 0, role: "heroSoft" }
            "ProfileAvatar.name": { size: 17.28, weight: 680, tracking: 0 }
            "ProfileAvatar.status": { size: 9.41, weight: 690, tracking: 0.413, role: "inkMuted" }
            profilesThemeLabel: { size: 11.52, weight: 720, tracking: 0 }
            profilesLangLabel: { size: 11.52, weight: 720, tracking: 0 }
            searchEmptyHint: { size: 13.82, weight: 400, tracking: 0, role: "inkMuted", lineHeight: 22.4 }
            searchEmptyLabel: { size: 16.9, weight: 650, tracking: -0.349, role: "ink" }
            searchFieldLabel: { size: 15.4, weight: 400, tracking: 0, role: "inkMuted" }
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
        if typed.boxH <> invalid then web.rectH = typed.boxH
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

' The web sets an episode code ("S 01 · E 01") tighter than the plain advances: tracking in px for text that starts like one.
function EpisodeCodeTracking(text as String, tracking as Float) as Float
    if Left(text, 2) = "S " and Instr(1, text, "·") > 0 then return tracking
    return 0
end function
