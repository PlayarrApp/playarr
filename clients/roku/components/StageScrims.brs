sub init()
    for each id in ["rampKeyLeft", "rampKeyBottom", "rampKeyTop", "rampWashLeft", "rampWashRight"]
        ramp = m.top.findNode(id)
        ThemeSetRole(ramp, "surface")
        ramp.blendColor = ThemeColor("surface")
    end for
    ThemeSetRole(m.top.findNode("frostLight"), "homeRailFrost")
    ThemeSetRole(m.top.findNode("frostDark"), "homeRailFrost")
    m.global.observeField("themeMode", "onStageScrimTheme")
end sub

sub onStageScrimTheme()
    ThemeApplyTree(m.top, m.global.themeMode)
    onFrostChange()
end sub

sub onFrostChange()
    m.top.findNode("frostLight").blendColor = ThemeColor("homeRailFrost")
    m.top.findNode("frostDark").blendColor = ThemeColor("homeRailFrost")
    m.top.findNode("frostLayer").visible = m.top.frost
    m.top.findNode("frostLight").visible = m.global.themeMode = "light"
    m.top.findNode("frostDark").visible = m.global.themeMode <> "light"
end sub
