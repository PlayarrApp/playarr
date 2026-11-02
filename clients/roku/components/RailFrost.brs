sub init()
    ThemeSetRole(m.top.findNode("frostLight"), "homeRailFrost")
    ThemeSetRole(m.top.findNode("frostDark"), "homeRailFrost")
    m.global.observeField("themeMode", "onRailFrostTheme")
    onRailFrostTheme()
end sub

sub onRailFrostTheme()
    light = m.global.themeMode = "light"
    frostLight = m.top.findNode("frostLight")
    frostDark = m.top.findNode("frostDark")
    frostLight.blendColor = ThemeColor("homeRailFrost")
    frostDark.blendColor = ThemeColor("homeRailFrost")
    frostLight.visible = light
    frostDark.visible = not light
end sub
