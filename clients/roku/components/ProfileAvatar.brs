sub init()
    PlayarrFontifyTree(m.top, "ProfileAvatar")
    ThemeInitComponent()
    m.circleGroup = m.top.findNode("circleGroup")
    m.focusShadow = m.top.findNode("focusShadow")
    m.focusRing = m.top.findNode("focusRing")
    m.avatarImage = m.top.findNode("avatarImage")
    m.customMask = m.top.findNode("customMask")
    m.customImage = m.top.findNode("customImage")
    m.initial = m.top.findNode("initial")
    m.name = m.top.findNode("name")
    m.status = m.top.findNode("status")
    m.itemGroup = m.top.findNode("itemGroup")
    ThemeSetRole(m.focusRing, "cardGlow")
    m.focusRing.blendColor = ThemeColor("cardGlow")
    ThemeSetRole(m.focusShadow, "profileShadow")
    m.focusShadow.blendColor = ThemeColor("profileShadow")
    m.global.observeField("themeMode", "onProfileThemeChanged")
end sub

' itemContent fields set by buildProfileAvatarContent() in MainScene.brs:
'   title / presetId / customUri / initial / statusText
' customUri is the account's custom photo (a local file the scene wrote); when set it replaces the preset art.
sub onContentChanged()
    content = m.top.itemContent
    if content = invalid then return
    customUri = content.customUri
    if customUri <> invalid and customUri <> ""
        m.customImage.uri = customUri
        m.customMask.visible = true
        m.avatarImage.uri = ""
    else if content.presetId = "add"
        m.customMask.visible = false
        m.avatarImage.uri = profileAddAvatarUri()
    else
        m.customMask.visible = false
        m.avatarImage.uri = "pkg:/images/avatar-" + content.presetId + ".png"
    end if
    ' Preset + add art already include mascot / plus — no letter overlay.
    m.initial.text = ""
    m.initial.visible = false
    m.name.text = content.title
    m.status.text = content.statusText
    updateProfileNameColor()
end sub

function profileAddAvatarUri() as String
    if m.global.themeMode = "light" then return "pkg:/images/avatar-add-light.png"
    return "pkg:/images/avatar-add.png"
end function

sub onProfileThemeChanged()
    content = m.top.itemContent
    if content <> invalid and content.presetId = "add" and m.avatarImage <> invalid
        m.avatarImage.uri = profileAddAvatarUri()
    end if
end sub

' Web: focused avatar scales from its centre and lifts slightly. Scale the
' circle group only (labels stay put) with pivot at the circle centre so
' neighbours stay on one horizontal baseline.
sub onFocusChanged()
    effective = m.top.focusPercent * m.top.activeRailFactor
    m.focusRing.opacity = effective
    m.focusShadow.opacity = effective * 0.28
    updateProfileNameColor()
    if m.circleGroup = invalid then return
    ' Web: the button grows 1.045 and lifts 8 px, its circle a further 1.035.
    k = 1 + 0.045 * effective
    m.itemGroup.scale = [k, k]
    m.itemGroup.translation = [0, -8 * effective]
    c = 1 + 0.035 * effective
    m.circleGroup.scale = [c, c]
end sub

sub updateProfileNameColor()
    if m.name = invalid then return
    effective = m.top.focusPercent * m.top.activeRailFactor
    if effective > 0 then m.name.color = ThemeColor("ink") else m.name.color = ThemeColor("inkSoft")
end sub

