sub init()
    for each id in ["rampKeyLeft", "rampKeyBottom", "rampKeyTop", "rampWashLeft"]
        ramp = m.top.findNode(id)
        ThemeSetRole(ramp, "surface")
        ramp.blendColor = ThemeColor("surface")
    end for
    m.frostLight = m.top.findNode("frostLight")
    m.frostDark = m.top.findNode("frostDark")
    ThemeSetRole(m.frostLight, "homeRailFrost")
    ThemeSetRole(m.frostDark, "homeRailFrost")
    ' The frost is the web .tv-rail-surface background (a container painting a gradient): stamp it as a container box, as the card art backing does.
    m.frostLight.id = "a11y|container|0|"
    m.frostDark.id = "a11y|container|0|"
    m.global.observeField("themeMode", "onStageScrimTheme")
end sub

sub onStageScrimTheme()
    ThemeApplyTree(m.top, m.global.themeMode)
    onFrostChange()
end sub

sub onFrostChange()
    m.frostLight.blendColor = ThemeColor("homeRailFrost")
    m.frostDark.blendColor = ThemeColor("homeRailFrost")
    m.top.findNode("frostLayer").visible = m.top.frost
    m.frostLight.visible = m.global.themeMode = "light"
    m.frostDark.visible = m.global.themeMode <> "light"
end sub
