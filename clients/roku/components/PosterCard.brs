sub init()
    PlayarrFontifyTree(m.top)
    ThemeSetRole(m.top.findNode("posterBg"), "surfaceSoft")
    for each id in ["cornerTL", "cornerTR", "cornerBL", "cornerBR"]
        ThemeSetRole(m.top.findNode(id), "surface")
    end for
    ThemeSetRole(m.top.findNode("focusRing"), "cardGlow")
    ThemeSetRole(m.top.findNode("focusGlow"), "cardGlow")
    ThemeInitComponent()
    m.focusRingInset = 0
    m.cardContentInsetX = 0
    m.cardContentInsetY = 0
    m.focusRing = m.top.findNode("focusRing")
    m.focusGlow = m.top.findNode("focusGlow")
    m.poster = m.top.findNode("poster")
    m.title = m.top.findNode("title")
    m.overlayNumber = m.top.findNode("overlayNumber")
    m.captionPrefix = m.top.findNode("captionPrefix")
    m.overlayNumber.font = PlayarrMakeFont(600, 19)
    m.captionPrefix.font = PlayarrMakeFont(700, 9)
    m.kind = m.top.findNode("kind")
    m.titleFont0 = m.title.font
    m.kindFont0 = m.kind.font
    m.unwatchedBadge = m.top.findNode("unwatchedBadge")
    m.progressTrack = m.top.findNode("progressTrack")
    m.progressFill = m.top.findNode("progressFill")
    m.cardRoot = m.top.findNode("cardRoot")
    m.artGroup = m.top.findNode("artGroup")
    m.focusAnim = m.top.findNode("focusAnim")
    m.focusShadow = m.top.findNode("focusShadow")
    m.restShadow = m.top.findNode("restShadow")
    m.cardScaleValue = 1.0
    m.cardListMode = false
    m.cardTitleX = 0
    m.padTop = 0
    m.titleY = 133
    m.liftInterp = m.top.findNode("liftInterp")
    m.retryTimer = m.top.findNode("retryTimer")
    m.retryTimer.ObserveField("fire", "onPosterRetry")
    m.poster.ObserveField("loadStatus", "onPosterLoadStatus")
    m.posterUri = ""
    m.posterRetries = 0
    m.scaleInterp = m.top.findNode("scaleInterp")
    m.artLiftInterp = m.top.findNode("artLiftInterp")
    m.global.observeField("cardFocusOff", "onFocusChanged")
end sub

sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
    circle = content.shape <> invalid and content.shape = "circle"
    m.title.text = content.title
    ' cardScale/showKind: MarkupGrid/RowList only ever bind the itemContent
    ' field on each item instance, there is no path for a screen to set an
    ' arbitrary custom interface field (cardScale/showKind) on every item
    ' component directly, so both travel on the content node itself instead,
    ' the same pattern activeRailFactor below already established.
    cardScale = 1
    if content.cardScale <> invalid then cardScale = content.cardScale
    m.cardScaleValue = cardScale
    artW = 0.0
    artH = 0.0
    listMode = false
    if content.artW <> invalid then artW = content.artW
    if content.artH <> invalid then artH = content.artH
    if content.listMode = true then listMode = true
    m.padTop = 0
    if content.padTop <> invalid then m.padTop = content.padTop
    m.focusRingOutsideArt = false
    if content.focusRingOutsideArt <> invalid
        if content.focusRingOutsideArt = true then m.focusRingOutsideArt = true
    end if
    m.homeCardFocusStyle = false
    if content.homeCardFocusStyle <> invalid
        if content.homeCardFocusStyle = true then m.homeCardFocusStyle = true
    end if
    m.focusRingInset = 0
    m.cardContentInsetX = 0
    m.cardContentInsetY = 0
    if m.focusRingOutsideArt
        m.focusRingInset = 3
        m.cardContentInsetX = 8
        m.cardContentInsetY = 15
    end if
    m.cardRoot.translation = [m.cardContentInsetX, m.padTop + m.cardContentInsetY]
    layoutCard(cardScale, artW, artH, listMode)
    ' A recycled grid card keeps its laid-out title position (layoutCard returns early for an unchanged scale).
    m.titleY = m.cardTitleY
    if circle then m.titleY = 118
    showKind = true
    if content.showKind <> invalid then showKind = content.showKind
    m.kind.visible = showKind
    if showKind
        kindText = CapitalizeFirst(content.kind)
        if content.year <> invalid and content.year <> "" then kindText = kindText + " · " + content.year
        if content.subtitleOverride <> invalid and content.subtitleOverride <> "" then kindText = content.subtitleOverride
        m.kind.text = kindText
    end if
    ' No per-item watched/unwatched state is threaded through from the
    ' catalog fetch yet (MainScene.brs's buildRailContent/buildGridContent
    ' don't carry it), so this always shows the badge. Confirmed live
    ' against the real app that "Unwatched" was in fact the aria-label on
    ' every single card observed, so defaulting to visible is the closer
    ' match of the two options available without deeper API work, not a
    ' guess: a documented simplification, not a bug.
    hasNumber = content.overlayNumber <> invalid and content.overlayNumber <> ""
    m.overlayNumber.visible = hasNumber
    if hasNumber then m.overlayNumber.text = content.overlayNumber
    hasPrefix = content.captionPrefix <> invalid and content.captionPrefix <> ""
    m.captionPrefix.visible = hasPrefix
    if hasPrefix
        m.captionPrefix.text = content.captionPrefix
        m.title.translation = [m.captionPrefix.boundingRect().width + 8, m.titleY]
    else
        m.title.translation = [m.cardTitleX, m.titleY]
    end if
    clampCardTitle(content.title, hasPrefix)
    watchState = ""
    if content.watchState <> invalid then watchState = content.watchState
    m.unwatchedBadge.visible = watchState = "unseen"
    m.progressTrack.visible = watchState = "part"
    if watchState = "part"
        pct = 0
        if content.progressPct <> invalid then pct = content.progressPct
        fill = 220 * pct / 100
        if fill < 3 then fill = 3
        m.progressFill.width = fill
    end if
    agent = CreateObject("roHttpAgent")
    agent.SetCertificatesFile("common:/certs/ca-bundle.crt")
    agent.InitClientCertificates()
    ' Prefer global auth headers set by MainScene (survives MarkupGrid/RowList
    ' itemContent binding). Per-item artHeaders is a fallback only.
    g = GetGlobalAA()
    if g.playarrArtHeaders <> invalid
        agent.SetHeaders(g.playarrArtHeaders)
    else if content.artHeaders <> invalid
        agent.SetHeaders(content.artHeaders)
    end if
    m.poster.SetHttpAgent(agent)
    ' Library art is 4K: ask for a bitmap decoded at 2x the card (4K textures overflow the GPU budget and some fail to load).
    m.top.findNode("circleMask").visible = circle
    for each id in ["posterBg", "poster", "cornerTL", "cornerTR", "cornerBL", "cornerBR"]
        m.top.findNode(id).visible = not circle
    end for
    if circle
        ' Cast circle: the headshot only, centred in its 177 px slot, name and character centred under it.
        m.restShadow.visible = false
        m.focusShadow.visible = false
        m.artGroup.scaleRotateCenter = [88.5, 52]
        m.title.horizAlign = "center"
        m.title.width = 472
        m.kind.horizAlign = "center"
        m.kind.width = 656
        m.kind.translation = [0, 137]
        m.circlePoster = m.top.findNode("circlePoster")
        m.circlePoster.SetHttpAgent(agent)
        m.circlePoster.loadWidth = 208
        m.circlePoster.loadHeight = 208
        m.circlePoster.uri = content.hdPosterUrl
    else
        m.restShadow.visible = true
        m.focusShadow.visible = true
        m.title.horizAlign = "left"
        m.kind.horizAlign = "left"
        if not m.cardListMode
            m.title.width = 587
            m.kind.width = 815
        end if
        ' The server serves 780 px (backdrop) or 540 px (poster) wide art; decode it at the card's own size so the stick resamples once.
        m.poster.loadWidth = Int(m.poster.width + 0.5)
        if artW = 0 and Instr(1, content.hdPosterUrl, "w=540") > 0
            m.poster.loadHeight = Int(330 * cardScale + 0.5)
        else
            m.poster.loadHeight = Int(m.poster.height + 0.5)
        end if
        m.posterUri = content.hdPosterUrl
        m.posterRetries = 0
        m.retryTimer.control = "stop"
        m.poster.uri = content.hdPosterUrl
        emitPosterArtStatus("pending")
        if content.hdPosterUrl = ""
            emitPosterArtStatus("empty")
        else
            samplePosterArtStatus()
        end if
    end if
    ' A field literally named rowFocusPercent turned out to be reserved --
    ' RowList silently overwrites it on its own after content binds,
    ' confirmed live via debug-console tracing (a sibling rail's item would
    ' flip back to 1 moments after being built with 0, with no
    ' onContentChanged in between). Renamed to activeRailFactor, a name Roku
    ' has no special handling for, so MainScene's per-rail-active-or-not value
    ' (baked onto each item's content node at buildRailContent() time) is the
    ' only thing that ever writes it. Screens that never set it
    ' (MarkupGrid-based grids) get content.activeRailFactor = invalid, which
    ' must behave as a 1 (no-op multiplier), not the field's own 0 default.
    if content.activeRailFactor <> invalid
        m.top.activeRailFactor = content.activeRailFactor
    else
        m.top.activeRailFactor = 1
    end if
end sub

' Real SceneGraph Animation/FieldInterpolator nodes, not an instant property
' set -- tv-web's own focus transition (.tv-title-card / .tv-title-card-art)
' eases transform over 240-260ms, and Roku genuinely supports the same kind
' of tweened transition via Animation, this was just never wired up before.
' Mirrors tv-web exactly: the whole card lifts (translateY(-7px), no colour
' change -- there is no border/outline anywhere in the real CSS), while only
' the art zooms in a touch further (scale(1.025)).
sub onFocusChanged()
    effective = m.top.focusPercent * m.top.activeRailFactor
    ' A drawer over the page owns focus: the cards behind it draw no focus (web keeps the ring on the drawer's control).
    if m.global.cardFocusOff = true then effective = 0
    shadowOpacity = effective
    if shadowOpacity > 1 then shadowOpacity = 1
    if shadowOpacity < 0 then shadowOpacity = 0
    m.focusShadow.opacity = shadowOpacity
    m.restShadow.opacity = 1 - shadowOpacity
    ' Web --card-glow: a brand ring and soft glow on the focused media card (not the round cast headshots).
    ringOn = shadowOpacity > 0.5 and not m.top.findNode("circleMask").visible
    m.focusRing.visible = ringOn
    m.focusGlow.opacity = 0
    if ringOn then m.focusGlow.opacity = shadowOpacity
    liftY = -cardFocusLift() * effective
    artScale = 1 + (effective * cardFocusScale())
    m.liftInterp.key = [0, 1]
    m.liftInterp.keyValue = [m.cardRoot.translation, [m.cardContentInsetX, m.padTop + m.cardContentInsetY + liftY]]
    ' Web grid cards: the art rises a further 5 px beyond the card (measured: ring box 5 px higher than the card lift alone gives).
    artExtra = 0
    if not m.homeCardFocusStyle and m.cardScaleValue > 1 then artExtra = -5 * effective
    m.artLiftInterp.key = [0, 1]
    m.artLiftInterp.keyValue = [m.artGroup.translation, [0, artExtra]]
    m.scaleInterp.key = [0, 1]
    m.scaleInterp.keyValue = [m.artGroup.scale, [artScale, artScale]]
    m.focusAnim.control = "stop"
    m.focusAnim.control = "start"
end sub

' "movie"/"series"/"site"/"artist" (lowercase, straight from the API) ->
' "Movie"/"Series"/"Site"/"Artist" (from: .tv-home-card's <small> kind text).
function CapitalizeFirst(value as Dynamic) as String
    if value = invalid or value = "" then return ""
    return UCase(Left(value, 1)) + Right(value, Len(value) - 1)
end function

' Media-card focus values, pinned from the web (docs/design/page-layout.md section 5, reference commit de371253): Home
' lifts 6 px and zooms art 1.025; library grids lift 5 px and zoom art 1.015. Home cards use a larger source-art scale,
' so identify their focus style explicitly instead of inferring it from cardScale. The shadow bitmaps carry the web shadows.
function cardFocusLift() as Float
    if m.homeCardFocusStyle then return 6
    if m.cardScaleValue > 1 then return 7
    return 6
end function

function cardFocusScale() as Float
    if m.homeCardFocusStyle then return 0.025
    ' Web grid card: the card scales 1.015 and its art a further 1.025 (1.015 x 1.025 = 1.0402); measured ring 344 px wide on the live Movies ref.
    if m.cardScaleValue > 1 then return 0.0402
    return 0.025
end function

' The relay drops or times out some artwork requests under load: a failed poster is requested again (up to 8 times, 2 s apart,
' with a cache-busting query so the failure is not reused).
sub onPosterLoadStatus()
    samplePosterArtStatus()
    if m.poster.loadStatus = "failed" and m.posterUri <> "" and m.posterRetries < 8
        m.retryTimer.control = "start"
    end if
end sub

sub samplePosterArtStatus()
    if m.poster.loadStatus = "ready" then emitPosterArtStatus("ready")
    if m.poster.loadStatus = "failed"
        if m.posterUri <> "" and m.posterRetries < 8
            emitPosterArtStatus("pending")
        else
            emitPosterArtStatus("failed")
        end if
    end if
end sub

sub emitPosterArtStatus(status as String)
    content = m.top.itemContent
    if content = invalid or content.parityArtRequired <> true then return
    generation = content.parityArtGeneration
    scope = content.parityArtScope
    slot = content.parityArtSlot
    version = content.parityArtVersion
    if generation = invalid or generation < 1 or version = invalid or version < 0 then return
    if (scope <> "home" and scope <> "movies" and scope <> "series") or slot = invalid or slot = "" then return
    if status <> "pending" and status <> "ready" and status <> "failed" and status <> "empty" then return
    print "PARITY|art|status|" + generation.ToStr() + "|" + scope + "|" + slot + "|" + status + "|" + version.ToStr()
end sub

sub onPosterRetry()
    m.posterRetries = m.posterRetries + 1
    sep = "?"
    if Instr(1, m.posterUri, "?") > 0 then sep = "&"
    m.poster.uri = m.posterUri + sep + "retry=" + m.posterRetries.ToStr()
    emitPosterArtStatus("pending")
end sub

' Card geometry for the art size: the art, corner masks, watch overlays and text are laid out at their own web sizes (a 1.5 grid
' card has a 330 px art but still 12 px text and a 13 px dot), so nothing is scaled as a whole.
sub layoutCard(cardScale as Float, ovW = 0.0 as Float, ovH = 0.0 as Float, listMode = false as Boolean)
    artW = 220 * cardScale
    artH = 124 * cardScale
    if ovW > 0
        artW = ovW
        artH = ovH
    end if
    key = artW.ToStr() + ":" + artH.ToStr() + ":" + listMode.ToStr()
    if m.laidOutScale = key then return
    m.laidOutScale = key
    m.cardListMode = listMode
    m.top.findNode("posterBg").width = artW
    m.top.findNode("posterBg").height = artH
    m.poster.width = artW
    m.poster.height = artH
    m.artGroup.scaleRotateCenter = [artW / 2, artH / 2]
    m.top.findNode("cornerTL").translation = [0, 0]
    m.top.findNode("cornerTR").translation = [artW - 12, 0]
    m.top.findNode("cornerBL").translation = [0, artH - 12]
    m.top.findNode("cornerBR").translation = [artW - 12, artH - 12]
    m.unwatchedBadge.translation = [artW - 23.5, 9.5]
    m.progressTrack.translation = [0, artH - 3]
    m.progressTrack.width = artW
    ' Home RowList items reserve a 3 px inset around the art so this outer ring stays inside the item viewport.
    focusInset = 0
    if m.focusRingOutsideArt then focusInset = 3
    m.focusRing.translation = [-focusInset, -focusInset]
    m.focusRing.width = artW + (focusInset * 2)
    m.focusRing.height = artH + (focusInset * 2)
    if m.homeCardFocusStyle and ovW = 0
        ' card-glow.png has a 220x124 mask centred in a 400x304 canvas with
        ' 90px margins. Home artwork is laid out at the 1.4864 card scale, so
        ' scale the full glow bitmap and its margins together to keep that mask
        ' aligned to the artwork with the generated blur proportions intact.
        glowScale = cardScale
        m.focusGlow.translation = [-90 * glowScale, -90 * glowScale]
        m.focusGlow.width = 400 * glowScale
        m.focusGlow.height = 304 * glowScale
    else
        m.focusGlow.translation = [-90, -90]
        m.focusGlow.width = artW + 180
        m.focusGlow.height = artH + 180
    end if
    if m.homeCardFocusStyle and ovW = 0
        ' The shadow masks share the same 400x304 canvas and 90px margins as
        ' the Home glow. Scale the full canvas so its opaque shape remains
        ' aligned with the card art at Home's larger layout scale.
        shadowScale = cardScale
        m.restShadow.translation = [-90 * shadowScale, -90 * shadowScale]
        m.restShadow.width = 400 * shadowScale
        m.restShadow.height = 304 * shadowScale
        m.focusShadow.translation = [-90 * shadowScale, -90 * shadowScale]
        m.focusShadow.width = 400 * shadowScale
        m.focusShadow.height = 304 * shadowScale
    else
        m.restShadow.translation = [-90, -90]
        m.restShadow.width = artW + 180
        m.restShadow.height = artH + 180
        m.focusShadow.translation = [-90, -90]
        m.focusShadow.width = artW + 180
        m.focusShadow.height = artH + 180
    end if
    titleGap = 9.9
    if cardScale > 1 then titleGap = 11.5
    m.titleY = artH + titleGap
    m.cardTitleY = m.titleY
    m.cardTitleX = 0
    m.cardArtW = artW
    m.title.translation = [0, m.titleY]
    m.title.width = artW
    m.kind.translation = [0, artH + titleGap + 19.5]
    m.kind.width = artW
    if listMode
        ' Web list row: the art on the left, the title and the genre line centred beside it.
        m.title.font = PlayarrMakeFont(600, 15)
        m.kind.font = PlayarrMakeFont(400, 10)
        m.title.translation = [artW + 21, artH / 2 - 26]
        m.title.width = 520
        m.kind.translation = [artW + 21, artH / 2 + 6]
        m.kind.width = 520
        m.cardTitleY = artH / 2 - 26
        m.cardTitleX = artW + 21
    else
        m.title.font = m.titleFont0
        m.kind.font = m.kindFont0
    end if
    m.overlayNumber.translation = [artW - 72, artH - 40]
    m.captionPrefix.translation = [0, artH + 12]
end sub

' Web .tv-title-card-copy strong: one line, text-overflow ellipsis at the card's width.
sub clampCardTitle(text as String, hasPrefix as Boolean)
    if m.cardListMode = true or m.cardArtW = invalid or m.cardArtW <= 0 then return
    avail = m.cardArtW
    if hasPrefix then avail = avail - m.title.translation[0]
    ' boundingRect reports the fixed width, so measure with the width unset.
    fixedWidth = m.title.width
    m.title.width = 0
    m.title.text = text
    if m.title.boundingRect().width * m.title.scale[0] > avail
        n = Len(text)
        while n > 1
            n = n - 1
            m.title.text = Left(text, n) + "…"
            if m.title.boundingRect().width * m.title.scale[0] <= avail then exit while
        end while
    end if
    m.title.width = fixedWidth
end sub
