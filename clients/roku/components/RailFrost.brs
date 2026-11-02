sub init()
    m.frostLight = m.top.findNode("frostLight")
    m.frostDark = m.top.findNode("frostDark")
    ThemeSetRole(m.frostLight, "homeRailFrost")
    ThemeSetRole(m.frostDark, "homeRailFrost")
    ' The frost is the web .tv-rail-surface background (a container painting a gradient): stamp it as a container box, as the card art backing does.
    m.frostLight.id = "a11y|container|0|"
    m.frostDark.id = "a11y|container|0|"
    m.global.observeField("themeMode", "onRailFrostTheme")
    onRailFrostTheme()
end sub

sub onRailFrostTheme()
    light = m.global.themeMode = "light"
    frostLight = m.frostLight
    frostDark = m.frostDark
    frostLight.blendColor = ThemeColor("homeRailFrost")
    frostDark.blendColor = ThemeColor("homeRailFrost")
    frostLight.visible = light
    frostDark.visible = not light
end sub
