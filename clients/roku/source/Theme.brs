' Theme.brs
'
' Shared design-token constants ported from the tv-web ("Playarr") React app
' so the Roku channel can visually match it wherever SceneGraph allows.
'
' Sources read to produce these values:
'   - clients/tv-web/packages/design-tokens/src/index.ts (spacing, type scale, radius, focusMotion)
'   - clients/tv-web/web/src/styles/global.css, `:root[data-theme="dark"]` block (colors)
'   - clients/tv-web/web/src/styles/global.css, `.tv-*` stage rules (screenX/screenY/headerHeight,
'     which reuse the same clamp() formulas as `--screen-x`/`--screen-y`/`--header-height`)
'
' Roku's canvas is fixed at 1920x1080 (manifest ui_resolutions=fhd), so every
' vw/vh/clamp() fluid CSS value below has been evaluated at a 1920x1080
' viewport and baked down to a fixed pixel int. The formula used for each is
' left in a comment next to the value so it can be re-derived if the web
' tokens change.
'
' Both palettes of global.css are ported: `:root` (light) and `:root[data-theme="dark"]`. Roku has no OS
' appearance API, so the preference (System, Light, Dark) is stored in the registry (PairingPrefs.brs) and "System"
' resolves to dark. ThemeTokens(mode) returns the palette; ThemeApplyTree recolours the authored (dark) literals.

function ThemeTokens(mode as String) as Object
    if mode = "light"
        return {
            ' :root --bg, --surface, --surface-strong, --surface-soft, --ink, --ink-soft, --ink-muted
            bg: &hF5F3F2FF
            surface: &hFBFAF9FF
            surfaceStrong: &hFFFFFFFF
            surfaceSoft: &hDFDCDDFF
            ink: &h382621FF
            inkSoft: &h443A40FF
            inkMuted: &h4D4248FF
            heroSoft: &h4F3F3BFF
            cardFocusInk: &h000000FF
            ' --accent, --accent-soft, --on-accent
            accent: &h4D4248FF
            accentSoft: &hC5B8BDFF
            onAccent: &hFFFFFFFF
            ' --danger, --success
            danger: &h722F34FF
            success: &h224C3AFF
            ' --line rgba(56,38,33,.14), --line-strong rgba(56,38,33,.28)
            line: &h38262124
            lineStrong: &h38262147
            ' Brand red (.tv-provider kicker, unwatched dot, player accent): the same in both themes.
            brand: &hCF3157FF
            ' --brand-strong: the focused detail Play pill, the same in both themes.
            brandStrong: &hA52745FF
            clientAndroid: &h3DDC84FF
            clientWebOS: &hA50034FF
            clientTizen: &h1428A0FF
            clientRoku: &h662D91FF
            clientChromecast: &hFF4444FF
            clientXbox: &h107C10FF
            clientFireTV: &hFF9900FF
            ' --brand-ink: text in the brand hue (kickers, eyebrows), WCAG AAA.
            brandInk: &h821E36FF
            ' --card-glow-color: the focus ring and glow of a media card (brand-strong in light, brand-ink in dark).
            cardGlow: &hA52745FF
            profileShadow: &h1F0E14FF
            ' Focus ring: ink in light, literal white in dark (owner ruling).
            focusRing: &h382621FF
            ' Right-hand content panel of the page shell (--surface blended with --surface-soft).
            panel: &hEFEEEEFF
            ' Right-hand drawer fill (web Drawer panel over the page).
            drawerPanel: &hF3F3F4FF
            ' Opaque base under the drawer wash (the web panel blends translucent white over the page; the wash bitmap carries the tint).
            drawerBase: &hFEFEFEFF
            agendaHead: &hFBFAF9FF
            badgeDefault: &hEFEDEDFF
            badgeAvailable: &hE2EFE8FF
            badgeUpcoming: &hF5DEE2FF
            badgeMissing: &hE8DEDDFF
            homeRailFrost: &hF0EEEFff
            ' Status chip tint (.calendar-badge): rgba(91,127,209,.24), the same in both themes.
            statusTint: &h5B7FD13D
            ' Player chrome is the same over video in both themes: white ink on a dark scrim (global.css .player-*).
            playerInk: &hFFFFFFFF
            playerMuted: &hFFFFFF8A
            playerPanel: &h120E11E6
            playerTint: &hFFFFFF0E
            playerButton: &hFFFFFF24
            playerSelected: &hCF315738
            playerPill: &h0C0A0B94
            playerTrack: &hFFFFFF33
            playerBuffered: &hFFFFFF57
            playerSeparator: &hA5969EFF
            playerScrim: &h000000EB
        }
    end if
    return {
        bg: &h151315FF
        surface: &h1B181BFF
        surfaceStrong: &h211D21FF
        surfaceSoft: &h312A30FF
        ink: &hF4F0F1FF
        inkSoft: &hCDC1C6FF
        inkMuted: &hC2B5BBFF
        heroSoft: &hDAD6D7FF
        cardFocusInk: &hFFFFFFFF
        accent: &hDFDCDDFF
        accentSoft: &h675961FF
        onAccent: &h211D21FF
        danger: &hF1A4A8FF
        success: &h8AC5A5FF
        ' --line rgba(223,220,221,.11), --line-strong rgba(223,220,221,.23)
        line: &hDFDCDD1C
        lineStrong: &hDFDCDD3B
        brand: &hCF3157FF
        clientAndroid: &h3DDC84FF
        clientWebOS: &hA50034FF
        clientTizen: &h1428A0FF
        clientRoku: &h662D91FF
        clientChromecast: &hFF4444FF
        clientXbox: &h107C10FF
        clientFireTV: &hFF9900FF
        brandStrong: &hA52745FF
        brandInk: &hEAA6B6FF
        cardGlow: &hEAA6B6FF
        profileShadow: &h1F0E14FF
        focusRing: &hFFFFFFFF
        panel: &h282227FF
        drawerPanel: &h221D22FF
        drawerBase: &h221D22FF
        agendaHead: &h151315FF
        badgeDefault: &h2C2A2CFF
        badgeAvailable: &h2A342EFF
        badgeUpcoming: &h341B23FF
        badgeMissing: &h392C2FFF
        homeRailFrost: &h282327FF
        statusTint: &h5B7FD13D
        ' Player chrome is the same over video in both themes: white ink on a dark scrim (global.css .player-*).
        playerInk: &hFFFFFFFF
        playerMuted: &hFFFFFF8A
        playerPanel: &h120E11E6
        playerTint: &hFFFFFF0E
        playerButton: &hFFFFFF24
        playerSelected: &hCF315738
        playerPill: &h0C0A0B94
        playerTrack: &hFFFFFF33
        playerBuffered: &hFFFFFF57
        playerSeparator: &hA5969EFF
        playerScrim: &h000000EB
    }
end function

' Colour of a token (role) with an alpha byte, for the active theme (m.global.themeMode).
function ThemeColor(role as String, alpha = -1 as Integer) as Integer
    mode = "dark"
    if m.global <> invalid and m.global.themeMode <> invalid then mode = m.global.themeMode
    colour = ThemeTokens(mode)[role]
    if alpha >= 0 then colour = ThemeWithAlpha(colour, alpha)
    return colour
end function

function ThemeWithAlpha(rgba as Integer, alpha as Integer) as Integer
    ' &hRRGGBBAA: keep the colour bytes, replace the alpha byte.
    return (rgba and &hFFFFFF00) or alpha
end function

' Authored (dark) literal -> token. The XML and the few literals in BrightScript were written for the dark theme;
' ThemeApplyTree resolves each one through this table, so a node follows the active theme.
function ThemeRoleForLiteral(rgb as String) as String
    roles = {
        "151315": "bg"
        "0B0A0B": "bg"
        "1B181B": "surface"
        "211D21": "surfaceStrong"
        "262126": "surfaceStrong"
        "312A30": "surfaceSoft"
        "2A262C": "surfaceSoft"
        "3A343C": "surfaceSoft"
        "F4F0F1": "ink"
        "DCE5F0": "ink"
        "C5B8BD": "inkSoft"
        "A9B7C9": "inkSoft"
        "887A82": "inkMuted"
        "5C6B80": "inkMuted"
        "EE9297": "danger"
        "7FC09D": "success"
        "CF3157": "brand"
    }
    role = roles[rgb]
    if role = invalid then return ""
    return role
end function

function ThemeHex2(value as Integer) as String
    return Right("0" + StrI(value and 255, 16), 2)
end function

' Split an authored colour into "RRGGBB" and its alpha byte.
function ThemeSplitLiteral(rgba as Integer) as Object
    r = (rgba >> 24) and 255
    g = (rgba >> 16) and 255
    b = (rgba >> 8) and 255
    a = rgba and 255
    return { rgb: UCase(ThemeHex2(r) + ThemeHex2(g) + ThemeHex2(b)), alpha: a }
end function

' Remember which token a node's colour field stands for (once, from its authored dark literal).
sub ThemeBindRole(node as Object, field as String, whiteIsInk = false as Boolean)
    if not node.hasField("themeRole")
        node.addFields({ themeRole: "" })
    end if
    if node.themeRole <> "" then return
    parts = ThemeSplitLiteral(node[field])
    role = ThemeRoleForLiteral(parts.rgb)
    if role = "" and whiteIsInk and parts.rgb = "FFFFFF" then role = "ink"
    if role = "" then
        node.themeRole = "-"
    else
        node.themeRole = role + ":" + parts.alpha.ToStr()
    end if
end sub

' Explicitly bind a node field to a token (images tinted through blendColor, runtime-built nodes).
sub ThemeSetRole(node as Object, role as String, alpha = -1 as Integer)
    if not node.hasField("themeRole") then node.addFields({ themeRole: "" })
    node.themeRole = role + ":" + alpha.ToStr()
end sub

sub ThemeApplyNode(node as Object, tokens as Object)
    if not node.hasField("themeRole") then return
    spec = node.themeRole
    if spec = "" or spec = "-" then return
    sep = Instr(1, spec, ":")
    role = Left(spec, sep - 1)
    alpha = Val(Mid(spec, sep + 1), 10)
    colour = tokens[role]
    if alpha >= 0 then colour = ThemeWithAlpha(colour, alpha)
    kind = node.subtype()
    if kind = "Poster"
        node.blendColor = colour
        if Instr(1, node.id, "@") > 0 then A11yStamp(node, true)
    else
        node.color = colour
    end if
end sub

' Recolour a subtree for `mode`. Labels and Rectangles are bound on first sight; Posters only when ThemeSetRole bound them.
sub ThemeApplyTree(root as Object, mode as String)
    tokens = ThemeTokens(mode)
    ThemeApplyWalk(root, tokens)
end sub

sub ThemeApplyWalk(node as Object, tokens as Object)
    kind = node.subtype()
    if kind = "Label" or kind = "WebLabel"
        ThemeBindRole(node, "color", true)
        ThemeApplyNode(node, tokens)
    else if kind = "Rectangle"
        ThemeBindRole(node, "color")
        ThemeApplyNode(node, tokens)
    else if kind = "Poster"
        ThemeApplyNode(node, tokens)
    end if
    n = node.getChildCount()
    for i = 0 to n - 1
        child = node.getChild(i)
        if child <> invalid then ThemeApplyWalk(child, tokens)
    end for
end sub

' Components that are instantiated by the scene or by a list (PosterCard, TvStage, ProfileAvatar) follow the scene's theme.
sub ThemeInitComponent()
    ThemeApplyTree(m.top, m.global.themeMode)
    m.global.observeField("themeMode", "onGlobalThemeChanged")
end sub

sub onGlobalThemeChanged()
    ThemeApplyTree(m.top, m.global.themeMode)
end sub

function Theme() as object
    return {
        colors: ThemeTokens("dark")

        spacing: {
            ' from: design-tokens spacing scale (packages/design-tokens/src/index.ts)
            none: 0
            xs: 4
            sm: 8
            md: 16
            lg: 24
            xl: 32
            xxl: 48
            xxxl: 64
        }

        ' Typeface: the web draws everything in Nunito Sans. Roku cannot load a variable font, so static instances
        ' (wght 300/400/500/600/700/800, cut from docs/parity/fonts/NunitoSans-wght-web.ttf with fontTools
        ' varLib.instancer) and JetBrains Mono 400/700 live in pkg:/fonts. source/Fonts.brs attaches them from
        ' BrightScript through the documented Font node (`uri` + `size`), which renders text correctly on the device
        ' (OS 15.3.4, Streaming Stick 4K). A `<Font role="font"/>` child declared in the component XML does not (the
        ' label stays blank), so never declare one. Labels authored with a `scale` (size N = scale N/32) are converted by
        ' PlayarrFontifyTree at component init; labels created in code call PlayarrMakeFont(weight, size) directly.
        ' Roku has no letter-spacing, so the web's negative tracking on the hero title cannot be reproduced exactly.
        type: {
            ' from: typeScale.micro { fontSize: 11, lineHeight: 16, fontWeight: 400 }
            ' size 11 -> scale 0.34
            micro: { font: "font:MediumSystemFont", size: 11, lineHeight: 16 }
            ' from: typeScale.caption { fontSize: 12, lineHeight: 17, fontWeight: 400 }
            ' size 12 -> scale 0.38
            caption: { font: "font:MediumSystemFont", size: 12, lineHeight: 17 }
            ' from: typeScale.body { fontSize: 14, lineHeight: 20, fontWeight: 400 }
            ' size 14 -> scale 0.44
            body: { font: "font:MediumSystemFont", size: 14, lineHeight: 20 }
            ' from: typeScale.bodyEmphasis { fontSize: 14, lineHeight: 20, fontWeight: 700 }
            ' size 14 -> scale 0.44
            bodyEmphasis: { font: "font:MediumBoldSystemFont", size: 14, lineHeight: 20 }
            ' from: typeScale.subtitle { fontSize: 18, lineHeight: 26, fontWeight: 300 }
            ' (300 has no lighter-than-Medium Roku font, so it maps to Medium)
            ' size 18 -> scale 0.56
            subtitle: { font: "font:MediumSystemFont", size: 18, lineHeight: 26 }
            ' from: typeScale.title { fontSize: 24, lineHeight: 34, fontWeight: 700 }
            ' size 24 -> scale 0.75
            title: { font: "font:MediumBoldSystemFont", size: 24, lineHeight: 34 }
            ' from: typeScale.display { fontSize: 50, lineHeight: 71, fontWeight: 300 }
            ' (300 has no lighter-than-Medium Roku font, so it maps to Medium)
            ' size 50 -> scale 1.56
            display: { font: "font:MediumSystemFont", size: 50, lineHeight: 71 }
        }

        radius: {
            ' from: design-tokens radius.card = 3
            card: 3
            ' from: design-tokens radius.button = 4
            button: 4
            ' from: design-tokens radius.input = 4
            input: 4
            ' from: design-tokens radius.badge = 2
            badge: 2
            ' from: design-tokens radius.pill = 9999
            pill: 9999
            ' from: design-tokens radius.modal = 6
            modal: 6
        }

        ' from: global.css :root --screen-x: clamp(28px, 4.5vw, 92px)
        ' evaluated at 1920px width: 4.5vw = 86.4px -> clamp(28, 86.4, 92) = 86.4 -> 86px
        screenX: 86

        ' from: global.css :root --screen-y: clamp(24px, calc(3.5 * 1vh), 54px)
        ' evaluated at 1080px height: 3.5vh = 37.8px -> clamp(24, 37.8, 54) = 37.8 -> 38px
        screenY: 38

        ' from: global.css :root --header-height: clamp(78px, calc(8.5 * 1vh), 112px)
        ' evaluated at 1080px height: 8.5vh = 91.8px -> clamp(78, 91.8, 112) = 91.8 -> 92px
        headerHeight: 92

        ' from: design-tokens focusMotion { restScale: 1, focusScale: 1.08,
        ' transitionMs: 150, transitionEasing: "cubic-bezier(0.4, 0, 0.2, 1)" }
        '
        ' SceneGraph Animation/Vector2DFieldInterpolator nodes drive easing via a
        ' child `EaseFunction` node whose `type` field is restricted to a fixed set
        ' of built-in Robert Penner-style keywords (linear, inQuad/outQuad/inOutQuad,
        ' inCubic/outCubic/inOutCubic, inQuart/outQuart/inOutQuart, ... inBounce
        ' family) -- there is no way to author an arbitrary cubic-bezier() curve.
        ' The CSS curve cubic-bezier(0.4, 0, 0.2, 1) is the "Material standard"
        ' ease -- slow start, fast middle, gentle finish -- which "inOutCubic" is
        ' the closest built-in match for. If a future SDK check shows
        ' "inOutCubic" isn't accepted on this Roku OS floor, fall back to "linear"
        ' rather than failing silently.
        focusMotion: {
            restScale: 1
            focusScale: 1.08
            transitionMs: 150
            ' ideal (not renderable as-is on Roku): cubic-bezier(0.4, 0, 0.2, 1)
            easing: "inOutCubic"
        }
    }
end function

' Semantics ride on node ids as `a11y|role|radius[@rrggbbaa[~baked]]|name` (ECP query/app-ui prints ids). The optional @rrggbbaa is the colour the
' app tints the node's bitmap with, alpha included, so the export composites the colour the app declared instead of reading JPEG pixels
' back. ~baked is the alpha (0 to 255) the bitmap itself carries (the dock panels are white masks at 143), multiplied in.
sub A11yStamp(node as Object, force = false as Boolean, baked = -1 as Integer)
    id = node.id
    if Left(id, 5) <> "a11y|" then return
    if not force and Instr(1, id, "@") = 0 then return
    parts = id.Split("|")
    if parts.Count() < 4 then return
    seg = parts[2]
    if baked < 0 and Instr(1, seg, "~") > 0 then baked = Val(seg.Split("~")[1], 10)
    radius = seg.Split("@")[0]
    ' The corner radius is the mask the bitmap really is (round-r<R>.9.png), whatever radius the caller asked for.
    if node.hasField("uri") and node.uri <> invalid
        u = node.uri
        k = Instr(1, u, "-r")
        if k > 0 and Right(u, 6) = ".9.png"
            radius = Mid(u, k + 2, Len(u) - k - 7)
        end if
    end if
    ' RRGGBBAA as bytes: a colour with the top bit set is a negative Integer, so split it into bytes before formatting.
    c& = node.blendColor
    if c& < 0 then c& = c& + 4294967296&
    alpha = c& mod 256
    if baked >= 0 then alpha = Int(alpha * baked / 255 + 0.5)
    hex = ""
    for shift = 3 to 1 step -1
        divisor& = 256&
        for k = 2 to shift
            divisor& = divisor& * 256&
        end for
        b = Int(c& / divisor&) mod 256
        hex = hex + Right("0" + StrI(b, 16), 2)
    end for
    hex = hex + Right("0" + StrI(alpha, 16), 2)
    suffix = ""
    if baked >= 0 then suffix = "~" + baked.ToStr()
    name = parts[3]
    for i = 4 to parts.Count() - 1
        name = name + "|" + parts[i]
    end for
    node.id = "a11y|" + parts[1] + "|" + radius + "@" + hex + suffix + "|" + name
end sub

' ---- Web card geometry at the Roku stage (1920 x 1080, zoom 1) ----
' Source: clients/tv-web/web/src/styles/page-layout.css (:root card tokens) and global.css (.tv-home-rail).
' Nothing here is fitted: each value is the CSS formula evaluated with --vw = 1920 / 100.

' CSS clamp(lo, v, hi).
function WebClamp(lo as Float, v as Float, hi as Float) as Float
    if v < lo then return lo
    if v > hi then return hi
    return v
end function

' Blink lays boxes out in LayoutUnit, 1/64 px, rounded down (layout/layout_unit.h), so a laid-out width or gap is the CSS
' value floored to 1/64 px. Radii are computed style values and stay unsnapped.
function WebLayoutUnit(v as Float) as Float
    return Int(v * 64.0) / 64.0
end function

' --vw on the 1920 px stage (tvStageScale.ts: viewport width / zoom / 100, zoom 1 at 1080 px high).
function WebVw() as Float
    return 1920.0 / 100.0
end function

' --card-radius: clamp(8px, calc(0.65 * var(--vw)), 13px) = 12.48.
function WebCardRadius() as Float
    return WebClamp(8.0, 0.65 * WebVw(), 13.0)
end function

' .tv-home-rail gap: clamp(14px, calc(1.3 * var(--vw)), 26px) = 24.953125 (LayoutUnit).
function WebRailGap() as Float
    return WebLayoutUnit(WebClamp(14.0, 1.3 * WebVw(), 26.0))
end function

' --card-w (page-layout.css): (--card-rail-vw * --vw - --card-pad-left - --card-pad-right - (--card-cols - 1) * --card-grid-gap) / --card-cols
' with --card-rail-vw 62, --card-cols 3, --card-grid-gap clamp(14px, 1.35 * --vw, 28px),
' --card-pad-left = --library-rail-left = clamp(28px, 2.8 * --vw, 54px) (no safe inset on the Roku stage),
' --card-pad-right = --library-rail-right = --directory-controls-edge (clamp(5px, 0.65 * --vw, 14px))
'   + max(--directory-controls-width (clamp(48px, 3.6 * --vw, 62px)), --directory-alphabet-width 56px)
'   + --directory-controls-gap (clamp(18px, 1.5 * --vw, 30px)). Result 327.17.
function WebCardGridGapCss() as Float
    return WebClamp(14.0, 1.35 * WebVw(), 28.0)
end function

' The laid-out grid gap (LayoutUnit floor of the CSS value).
function WebCardGridGap() as Float
    return WebLayoutUnit(WebCardGridGapCss())
end function

function WebCardWidth() as Float
    vw = WebVw()
    padLeft = WebClamp(28.0, 2.8 * vw, 54.0)
    controlsWidth = WebClamp(48.0, 3.6 * vw, 62.0)
    if controlsWidth < 56.0 then controlsWidth = 56.0
    padRight = WebClamp(5.0, 0.65 * vw, 14.0) + controlsWidth + WebClamp(18.0, 1.5 * vw, 30.0)
    cols = 3.0
    return WebLayoutUnit((62.0 * vw - padLeft - padRight - (cols - 1.0) * WebCardGridGapCss()) / cols)
end function

' Left edge of the first grid card minus the 8 px grid inset: the stage rail starts at (100 - --card-rail-vw 62) vw = 38 vw
' (page-layout.css) and the card column starts --card-pad-left (--library-rail-left, clamp(28px, 2.8 * --vw, 54px)) inside it.
function WebGridLeft() as Float
    return 38.0 * WebVw() + WebClamp(28.0, 2.8 * WebVw(), 54.0) - 8.0
end function

' ---- Browse grid pitch (page-layout.css .tv-title-grid-content) ----
' Column pitch: card + --card-grid-gap (laid-out values).
function WebGridPitchX() as Float
    return WebCardWidth() + WebCardGridGap()
end function

' Row pitch: the card (16:9 art, --card-copy-gap 0.72rem, then the title line: --card-title-size clamp(0.55rem, 0.62 * --vw, 0.78rem) at the
' inherited line-height 1.5) plus the grid row gap clamp(22px, 2.5 * --viewport-unit, 36px) (--viewport-unit is 1vh = 10.8 px).
function WebGridPitchY() as Float
    titleSize = WebClamp(8.8, 0.62 * WebVw(), 12.48)
    return WebCardWidth() * 9.0 / 16.0 + 0.72 * 16.0 + 1.5 * titleSize + WebClamp(22.0, 2.5 * 10.8, 36.0)
end function

' MarkupGrid advances its columns by a whole-pixel pitch (a 353.08 px itemSize lays out at 353), so column `col` lands short of its web
' x by col * (pitch - whole pitch). The card is moved inside its cell by that amount.
function WebGridColumnShift(col as Integer) as Float
    pitch = WebGridPitchX()
    return col * (pitch - Int(pitch))
end function

' The grid advances each row by the whole-pixel pitch (itemSize is laid out at Int(pitch): row 3 of a 240.41 pitch sits at 720, not 721), while the web
' places row `row` at round(row * pitch). The card moves down by the difference (the grid's own y is a whole pixel).
function WebGridRowShift(row as Integer) as Float
    y = row * WebGridPitchY()
    return Int(y + 0.5) - row * Int(WebGridPitchY())
end function

' Home rail cell: the card plus the 8 px focus-ring inset PosterCard keeps on each side (cardContentInsetX) = 343. Pitch stays web card + rail gap.
function WebRailCellWidth() as Float
    return Int(WebCardWidth() + 0.5) + 16.0
end function
