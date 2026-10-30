' PlayerChrome.brs
'
' Web player chrome on the Roku video plane: bottom scrim, seek bar with its thumb, the transport row (previous, play,
' next, time), the quality pill, the close button and the quality menu (matrix of tiers by Low, Medium and High).
' Numbers are the web DOM at 1920x1080 (scripts/parity/capture-web.mjs --dump-dom, screens player-controls and
' player-quality-menu). Roku has no Picture-in-Picture, cast or in-app volume, so those controls are not drawn
' (docs/parity/DEVICES.md). The focusable controls follow the web order: previous, play, next, audio, subtitles, queue, quality, info.

sub playerChromeInit()
    m.pcGroup = m.top.findNode("playerControls")
    m.pcMenuOpen = false
    m.pcMenuIndex = 0
    m.pcBuilt = false
    m.pcFocus = "play"
    m.pcKeyed = false
    m.pcPanel = ""
    m.pcSubChosen = invalid
    m.audioStreamIndex = invalid
    m.pcSubSel = ""
    m.pcAudioSel = ""
    m.pcSubtitleTracks = []
    m.pcPlaybackInfo = invalid
    m.pcRows = []
    m.pcLastEmit = ""
end sub

sub playerChromeBuild()
    if m.pcBuilt then return
    m.pcBuilt = true
    g = m.pcGroup
    ' The pre-web controls (hidden labels and the 4 px track) are replaced by the web geometry.
    m.top.findNode("playerBarBg").visible = false
    m.playerProgressTrack.translation = [70, 933]
    m.playerProgressTrack.width = 1780
    m.playerProgressTrack.height = 6
    m.playerBufferedFill.translation = [70, 933]
    m.playerBufferedFill.height = 6
    m.playerProgressFill.translation = [70, 933]
    m.playerProgressFill.height = 6
    m.playerProgressTrack.color = ThemeColor("playerTrack")
    m.playerBufferedFill.color = ThemeColor("playerBuffered")
    m.playerProgressFill.color = ThemeColor("brand")
    ThemeSetRole(m.playerProgressTrack, "playerTrack")
    ThemeSetRole(m.playerBufferedFill, "playerBuffered")
    ThemeSetRole(m.playerProgressFill, "brand")

    scrim = CreateObject("roSGNode", "Poster")
    scrim.uri = "pkg:/images/player-scrim.png"
    scrim.translation = [0, 561.6]
    scrim.width = 1920
    scrim.height = 518.4
    ThemeSetRole(scrim, "playerScrim")
    scrim.blendColor = ThemeColor("playerScrim")
    pgTag(scrim, "container", 0)
    g.insertChild(scrim, 0)
    ' Parity captures only: the Roku screenshot omits the video plane, so the static clip's 2 s frame stands in behind the controls.
    if m.global.parityArtEnabled = true
        frame = CreateObject("roSGNode", "Poster")
        frame.uri = "pkg:/images/parity-clip-2s.png"
        frame.width = 1920
        frame.height = 1080
        frame.id = "a11y|image|0|"
        g.insertChild(frame, 0)
    end if

    m.pcThumb = pgRound(g, 121.8, 928.5, 15, 15, 7, "brand")
    pgTag(m.pcThumb, "container", 7)
    m.pcPrev = pgIcon(g, 92, 980, 20, "player-prev.png", "playerInk")
    m.pcPlayBg = pcRound64(g, 147.6, 958, "playerButton")
    m.pcPlay = pgIcon(g, 169.6, 980, 20, "player-pause.png", "playerInk")
    m.pcNext = pgIcon(g, 247.2, 980, 20, "player-next.png", "playerInk")
    m.pcTimeNow = pgLabel(g, 302.8, 981.8, 0, 16, "0:00", 10.88, 400, "playerInk")
    m.pcTimeSep = pgLabel(g, 330.4, 981.8, 0, 16, "/", 10.88, 400, "playerSeparator")
    m.pcTimeEnd = pgLabel(g, 339.1, 981.8, 0, 16, "0:00", 10.88, 400, "playerInk")
    m.pcMuteIcon = pgIcon(g, 396.8, 980, 20, "player-volume.png", "playerInk")

    ' Quality pill (.player-quality-button): HD glyph and the current quality.
    ' Transparent at rest like web; the fill shows with focus (web hover and expanded).
    m.pcQualityBg = pgRound(g, 1456.8, 962, 160.5, 56, 28, "playerButton")
    m.pcQualityBg.visible = false
    m.pcQualityGlyph = pgLabel(g, 1479, 984.2, 0, 11, "HD", 7.68, 700, "playerInk")
    m.pcQualityText = pgLabel(g, 1508, 982.1, 0, 15, "Original", 10.56, 700, "playerInk")

    ' Subtitles, queue and info buttons (.player-btn.player-tool-button, 64 px circles; the web's audio slot sits before subtitles).
    m.pcAudioIcon = pgIcon(g, 1246, 980, 20, "player-audio.png", "playerInk")
    m.pcSubsIcon = pgIcon(g, 1323.6, 980, 20, "player-subtitles.png", "playerInk")
    m.pcQueueIcon = pgIcon(g, 1401.2, 980, 20, "player-playlist.png", "playerInk")
    m.pcInfoIcon = pgIcon(g, 1652.8, 980, 20, "player-health.png", "playerInk")

    ' Minimise and close (top right, .player-minimise and .player-close: 48 px high, 1 px border at 28% white). Roku cannot keep a
    ' mini player running behind the browse pages, so Minimise ends playback and returns to the title, as Back does.
    minPill = pcFullRound(g, 1678, 37.8, 124, 48, "playerPill", 209, false)
    minPill.id = "a11y|button|999|Minimise player"
    A11yStamp(minPill, true)
    pcFullRound(g, 1678, 37.8, 124, 48, "playerInk", 71, true)
    pgIcon(g, 1701.6, 51.8, 20, "player-minimise.png", "playerInk")
    pgLabel(g, 1730, 53.8, 66, 16, "Minimise", 11.2, 700, "playerInk")
    closePill = pcFullRound(g, 1814, 37.8, 48, 48, "playerPill", -1, false)
    closePill.id = "a11y|button|999|Close player"
    A11yStamp(closePill, true)
    pcFullRound(g, 1814, 37.8, 48, 48, "playerInk", 71, true)
    closeIcon = CreateObject("roSGNode", "Poster")
    closeIcon.uri = "pkg:/images/player-close-top.png"
    closeIcon.translation = [1831, 50.8]
    closeIcon.width = 14
    closeIcon.height = 22
    closeIcon.blendColor = ThemeColor("playerInk")
    ThemeSetRole(closeIcon, "playerInk")
    g.AppendChild(closeIcon)

    ' Control semantics (web order). The seek slider is the real 6 px track (the node the fill and thumb ride on), not a larger box.
    m.playerProgressTrack.id = "a11y|slider|0|Seek"
    m.pcPlayBg.id = "a11y|button|50|Play"
    A11yStamp(m.pcPlayBg, true)
    m.pcPrevMark = pgMark(g, "button", "Previous episode", 70, 958, 64, 64, 50)
    m.pcNextMark = pgMark(g, "button", "Next episode", 225.2, 958, 64, 64, 50)
    m.pcMuteMark = pgMark(g, "button", "Mute", 374.8, 958, 64, 64, 50)
    m.pcAudioMark = pgMark(g, "button", "", 1224, 958, 64, 64, 50)
    m.pcSubsMark = pgMark(g, "button", "Subtitles: Off", 1301.6, 958, 64, 64, 50)
    m.pcQueueMark = pgMark(g, "button", "Playlist: 1 item", 1379.2, 958, 64, 64, 50)
    m.pcQualityMark = pgMark(g, "button", "Quality: Original", 1456.8, 962, 160.5, 56, 999)
    pgMark(g, "button", "Info and playback health", 1630.8, 958, 64, 64, 50)

    m.pcMenu = CreateObject("roSGNode", "Group")
    m.pcMenu.visible = false
    g.AppendChild(m.pcMenu)
    m.pcFocusRing = pgRound(g, 0, 0, 64, 64, 32, "playerInk", -1, true)
    m.pcFocusRing.visible = false
    m.pcRing = CreateObject("roSGNode", "Poster")
    m.pcRing.uri = "pkg:/images/round-ring-r12.9.png"
    m.pcRing.visible = false
    ThemeSetRole(m.pcRing, "playerInk")
    m.pcRing.blendColor = ThemeColor("playerInk")
    g.AppendChild(m.pcRing)
end sub

' A fully rounded 48 px pill: pgRound drops to the 12 px corner under 49 px, which would square the top-right buttons off.
' A 64 px circle drawn with the 32 px corner mask (pgRound has no mask above 25 px).
function pcRound64(parent as Object, x as Float, y as Float, role as String) as Object
    poster = CreateObject("roSGNode", "Poster")
    poster.uri = "pkg:/images/round-r32.9.png"
    poster.translation = [x, y]
    poster.width = 64
    poster.height = 64
    poster.blendColor = ThemeColor(role)
    ThemeSetRole(poster, role)
    poster.id = "a11y|fill|32|"
    A11yStamp(poster, true)
    parent.AppendChild(poster)
    return poster
end function

' Mute toggles the Video node's own mute field (the stick's volume itself belongs to the remote and the TV).
sub playerToggleMute()
    m.pcMuted = not (m.pcMuted = true)
    if m.video.hasField("mute") then m.video.mute = m.pcMuted
    playerMuteDraw()
end sub

sub playerMuteDraw()
    name = "Mute"
    icon = "player-volume.png"
    if m.pcMuted = true
        name = "Unmute"
        icon = "player-muted.png"
    end if
    m.pcMuteIcon.uri = "pkg:/images/" + icon
    pgRename(m.pcMuteMark, name)
end sub

function pcFullRound(parent as Object, x as Float, y as Float, w as Float, h as Float, role as String, alpha as Integer, outline as Boolean) as Object
    poster = CreateObject("roSGNode", "Poster")
    name = "round"
    if outline then name = "round-outline"
    poster.uri = "pkg:/images/" + name + "-r25.9.png"
    poster.translation = [x, y]
    poster.width = w
    poster.height = h
    poster.blendColor = ThemeColor(role, alpha)
    ThemeSetRole(poster, role, alpha)
    parent.AppendChild(poster)
    return poster
end function

' Called from updatePlayerProgress with the playback state.
sub playerChromeUpdate(position as Dynamic, duration as Dynamic, fraction as Float)
    playerChromeBuild()
    m.pcThumb.translation = [70 + 1780 * fraction - 7.5, 928.5]
    m.pcTimeNow.text = formatPlaybackTime(position)
    m.pcTimeEnd.text = formatPlaybackTime(duration)
    sepX = 302.8 + m.pcTimeNow.boundingRect().width + 5.6
    m.pcTimeSep.translation = [sepX, 981.8]
    m.pcTimeEnd.translation = [sepX + 8.67, 981.8]
    m.pcPlay.uri = "pkg:/images/player-pause.png"
    m.pcPlayBg.id = "a11y|button|50|Pause"
    ' A held pause shows Play even while the pipeline re-buffers on the held frame.
    if m.video.state = "paused" or m.paritySeekHold = true
        m.pcPlay.uri = "pkg:/images/player-play.png"
        m.pcPlayBg.id = "a11y|button|50|Play"
    end if
    A11yStamp(m.pcPlayBg, true)
    m.pcQualityText.text = playerQualityButtonLabel()
    m.pcQualityMark.id = "hit|button|999|Quality: " + m.pcQualityText.text
    glyph = "HD"
    if m.qualityPref <> invalid and Left(m.qualityPref, 2) = "SD" then glyph = "SD"
    m.pcQualityGlyph.text = glyph
    n = m.playbackEpisodeList.Count()
    m.pcPrev.opacity = 0.28
    m.pcNext.opacity = 0.28
    if n > 0 and m.playbackEpisodeIndex > 0 then m.pcPrev.opacity = 1
    if n > 0 and m.playbackEpisodeIndex < n - 1 then m.pcNext.opacity = 1
    m.pcPrevMark.opacity = m.pcPrev.opacity
    subName = "Off"
    if m.pcSubSel <> invalid and m.pcSubSel <> ""
        subName = m.pcSubSel
        for each track in m.pcSubtitleTracks
            if track.id = m.pcSubSel then subName = track.label
        end for
    end if
    pgRename(m.pcSubsMark, "Subtitles: " + subName)
    audioName = ""
    if m.pcPlaybackInfo <> invalid and m.pcPlaybackInfo.audio_tracks <> invalid
        for each track in m.pcPlaybackInfo.audio_tracks
            if track.id = m.pcAudioSel then audioName = playerAudioLabel(track)
        end for
    end if
    pgRename(m.pcAudioMark, "Audio: " + audioName)
    items = 1
    if n > 1 then items = n
    plural = " items"
    if items = 1 then plural = " item"
    pgRename(m.pcQueueMark, "Playlist: " + items.ToStr() + plural)
    m.pcNextMark.opacity = m.pcNext.opacity
    playerChromeFocusDraw(fraction)
end sub

' The focusable controls, left to right (web order, audio first). The seek bar is a separate stop above them.
function playerChromeItems() as Object
    items = []
    n = m.playbackEpisodeList.Count()
    if n > 0 and m.playbackEpisodeIndex > 0 then items.Push({ id: "prev", x: 70, y: 958, w: 64, h: 64 })
    items.Push({ id: "play", x: 147.6, y: 958, w: 64, h: 64 })
    if n > 0 and m.playbackEpisodeIndex < n - 1 then items.Push({ id: "next", x: 225.2, y: 958, w: 64, h: 64 })
    items.Push({ id: "mute", x: 374.8, y: 958, w: 64, h: 64 })
    items.Push({ id: "audio", x: 1224, y: 958, w: 64, h: 64 })
    items.Push({ id: "subs", x: 1301.6, y: 958, w: 64, h: 64 })
    items.Push({ id: "queue", x: 1379.2, y: 958, w: 64, h: 64 })
    items.Push({ id: "quality", x: 1456.8, y: 962, w: 160.5, h: 56 })
    items.Push({ id: "info", x: 1630.8, y: 958, w: 64, h: 64 })
    return items
end function

' The top-right pair, reached with Up from the seek stop (web order: minimise, then close).
function playerChromeTopItems() as Object
    return [{ id: "minimise", x: 1678, y: 37.8, w: 124, h: 48 }, { id: "close", x: 1814, y: 37.8, w: 48, h: 48 }]
end function

' Ring on the focused control (web .player-btn:focus: the page focus ring); the seek stop enlarges the thumb instead.
sub playerChromeFocusDraw(fraction as Float)
    playerParityEmit(playerFocusLabel())
    ring = m.pcFocusRing
    big = m.pcFocus = "seek"
    ring.visible = false
    m.pcQualityBg.visible = m.pcFocus = "quality"
    ' Web: the seek thumb and the focus ring show only once the viewer drives the bar (hover or keyboard focus), not on a bar left idle.
    m.pcThumb.visible = big
    m.pcThumb.width = 15
    m.pcThumb.height = 15
    m.pcThumb.translation = [70 + 1780 * fraction - 7.5, 928.5]
    if big
        m.pcThumb.width = 24
        m.pcThumb.height = 24
        m.pcThumb.translation = [70 + 1780 * fraction - 12, 924]
        ring.translation = [67, 924]
        ring.width = 1786
        ring.height = 15
        ring.visible = not m.pcMenuOpen
        return
    end if
    items = playerChromeItems()
    for each top in playerChromeTopItems()
        items.Push(top)
    end for
    for each item in items
        if item.id = m.pcFocus
            ring.translation = [item.x - 4, item.y - 4]
            ring.width = item.w + 8
            ring.height = item.h + 8
            ring.visible = not m.pcMenuOpen and m.pcKeyed = true
            return
        end if
    end for
    m.pcFocus = "play"
end sub

' Key on the visible bar. Hidden bar: arrows seek and OK toggles, as before. Visible bar: left/right move between
' controls (or seek on the seek stop), up goes to the seek stop, down back to play, OK acts.
function playerChromeKey(key as String) as Boolean
    shown = m.playerControls.visible
    resetPlayerAutoHide()
    if key = "play"
        togglePlayPause()
        return true
    end if
    if not shown
        if key = "left" then seekPlayback(-10)
        if key = "right" then seekPlayback(10)
        if key = "OK" then togglePlayPause()
        return true
    end if
    m.pcKeyed = true
    if m.pcFocus = "seek"
        if key = "left" then seekPlayback(-10)
        if key = "right" then seekPlayback(10)
        if key = "down" then m.pcFocus = "play"
        if key = "up" then m.pcFocus = "minimise"
        if key = "OK" then togglePlayPause()
    else if m.pcFocus = "minimise" or m.pcFocus = "close"
        if key = "left" then m.pcFocus = "minimise"
        if key = "right" then m.pcFocus = "close"
        if key = "down" then m.pcFocus = "seek"
        if key = "OK" then finishPlayback("user_stopped")
    else if key = "up"
        m.pcFocus = "seek"
    else if key = "left" or key = "right"
        items = playerChromeItems()
        at = 0
        for i = 0 to items.Count() - 1
            if items[i].id = m.pcFocus then at = i
        end for
        if key = "left" and at > 0 then at -= 1
        if key = "right" and at < items.Count() - 1 then at += 1
        m.pcFocus = items[at].id
    else if key = "OK"
        playerChromeActivate(m.pcFocus)
    end if
    updatePlayerProgress()
    return true
end function

sub playerChromeActivate(id as String)
    if id = "play"
        togglePlayPause()
    else if id = "prev"
        playAdjacentEpisode(-1)
    else if id = "next"
        playAdjacentEpisode(1)
    else if id = "mute"
        playerToggleMute()
    else if id = "quality"
        playerMenuOpen()
    else
        playerPanelOpen(id)
    end if
end sub

' Web's quality button: the choice, then the stream's bitrate ("Original · 35.9 Mbps") once the player reports it.
function playerQualityButtonLabel() as String
    label = playerQualityLabel()
    bps = 0
    stream = m.video.streamInfo
    if stream <> invalid and stream.streamBitrate <> invalid and stream.streamBitrate > 500000 then bps = stream.streamBitrate
    ' Direct play reports no stream bitrate: web shows the chosen option's own (the source's for Original).
    data = m.pcPlaybackInfo
    if bps = 0 and data <> invalid and data.quality_options <> invalid
        want = "original"
        if m.qualityPref <> invalid and m.qualityPref <> "original" then want = ""
        for each option in data.quality_options
            if want <> "" and option.id = want and option.video_bitrate_bps <> invalid then bps = option.video_bitrate_bps
        end for
    end if
    if bps > 0 then label = label + " · " + (Int(bps / 100000 + 0.5) / 10).ToStr() + " Mbps"
    return label
end function

function playerQualityLabel() as String
    choice = m.qualityPref
    if choice = invalid or choice = "original" then return "Original"
    parts = choice.Split(":")
    if parts.Count() <> 2 then return "Original"
    return parts[0] + " · " + Int(QualityMaxBitrate(choice, 0) / 1000000).ToStr() + " Mbps"
end function

' ---------------------------------------------------------------------------
' Quality menu

sub playerMenuOpen()
    playerChromeBuild()
    m.pcPanel = "quality"
    m.pcMenuOpen = true
    m.pcMenuIndex = 0
    m.playerControls.visible = true
    m.playerAutoHideTimer.control = "stop"
    playerMenuRender()
end sub

sub playerMenuClose()
    m.pcMenuOpen = false
    m.pcPanel = ""
    m.pcMenu.visible = false
    m.pcRing.visible = false
    resetPlayerAutoHide()
end sub

' Menu cells in order: Original, then UHD/FHD/HD/SD rows by Low, Medium, High.
function playerMenuKeys() as Object
    keys = ["original"]
    for each name in ["UHD", "FHD", "HD", "SD"]
        for each col in ["Low", "Medium", "High"]
            keys.Push(name + ":" + col)
        end for
    end for
    return keys
end function

sub playerMenuRender()
    menu = m.pcMenu
    menu.removeChildrenIndex(menu.getChildCount(), 0)
    menu.visible = true
    pgRound(menu, 1074.8, 540, 620, 408, 18, "playerPanel")
    pgRound(menu, 1074.8, 540, 620, 408, 18, "playerTint", -1, true)
    pgLabel(menu, 1096, 556, 300, 14, "QUALITY", 9, 800, "playerMuted")
    selected = m.qualityPref
    if selected = invalid or selected = "" then selected = "original"
    rows = qualityRows()
    heads = ["Low", "Medium", "High"]
    cells = []
    pgRound(menu, 1084.6, 578.7, 600.4, 60, 12, "playerTint")
    if selected = "original" then pgRound(menu, 1084.6, 578.7, 600.4, 60, 12, "playerSelected")
    pgLabel(menu, 1095.5, 591.4, 400, 19, "Original", 12, 800, "playerInk")
    pgLabel(menu, 1095.5, 612, 400, 14, "Source quality", 9, 400, "playerMuted")
    if selected = "original" then pgIcon(menu, 1658, 599.8, 16, "check.png", "brand")
    cells.Push({ x: 1084.6, y: 578.7, w: 600.4, h: 60 })
    for c = 0 to 2
        pgLabel(menu, 1203.3 + c * 162.6, 650, 156.6, 14, UCase(heads[c]), 10, 800, "playerMuted", { horizAlign: "center" })
    end for
    for r = 0 to rows.Count() - 1
        y = 680.2 + 66 * r
        pgLabel(menu, 1088.6, y + 13, 100, 18, rows[r].name, 12, 800, "playerInk")
        pgLabel(menu, 1088.6, y + 33, 100, 14, rows[r].note, 9, 400, "playerMuted")
        for c = 0 to 2
            x = 1203.3 + c * 162.6
            key = rows[r].name + ":" + heads[c]
            pgRound(menu, x, y, 156.6, 60, 12, "playerTint")
            if selected = key then pgRound(menu, x, y, 156.6, 60, 12, "playerSelected")
            pgLabel(menu, x + 11, y + 12.7, 140, 19, rows[r].rates[c].ToStr() + " Mbps", 12, 800, "playerInk")
            pgLabel(menu, x + 11, y + 33.3, 140, 14, heads[c], 9, 400, "playerMuted")
            cells.Push({ x: x, y: y, w: 156.6, h: 60 })
        end for
    end for
    m.pcMenuCells = cells
    playerMenuRing()
end sub

sub playerMenuRing()
    cell = m.pcMenuCells[m.pcMenuIndex]
    if cell = invalid
        m.pcRing.visible = false
        return
    end if
    m.pcRing.translation = [cell.x - 3, cell.y - 3]
    m.pcRing.width = cell.w + 6
    m.pcRing.height = cell.h + 6
    m.pcRing.visible = true
    m.pcGroup.removeChild(m.pcRing)
    m.pcGroup.AppendChild(m.pcRing)
end sub

' Grid move: index 0 is the wide Original row; 1..12 are the 4 x 3 matrix.
function playerMenuKey(key as String) as Boolean
    if m.pcPanel <> "quality" then return playerPanelKey(key)
    i = m.pcMenuIndex
    if key = "back"
        playerMenuClose()
        return true
    else if key = "OK"
        keys = playerMenuKeys()
        m.qualityPref = keys[i]
        SaveQualityPreference(m.qualityPref)
        playerMenuClose()
        playerApplyQuality()
        return true
    end if
    if i = 0
        if key = "down" then m.pcMenuIndex = 1
    else
        col = (i - 1) mod 3
        row = Int((i - 1) / 3)
        if key = "left" and col > 0 then m.pcMenuIndex = i - 1
        if key = "right" and col < 2 then m.pcMenuIndex = i + 1
        if key = "up"
            if row = 0
                m.pcMenuIndex = 0
            else
                m.pcMenuIndex = i - 3
            end if
        end if
        if key = "down" and row < 3 then m.pcMenuIndex = i + 3
    end if
    playerMenuRing()
    return true
end function

' A new bitrate means a new playback session at the same position.
sub playerApplyQuality()
    if m.currentMediaFileId = invalid or m.currentMediaFileId = "" then return
    m.pendingChapterSeekMs = Int(m.video.position * 1000)
    requestPlayback(m.currentMediaFileId)
end sub

' ---------------------------------------------------------------------------
' Subtitles, queue and info panels (web .player-quality-menu, .player-playlist-drawer and the playback health panel)

' Subtitle sidecars from the playback response become the Video node's caption tracks, so the Roku player renders them.
function playerSubtitleContent(data as Object) as Object
    m.pcSubtitleTracks = []
    tracks = []
    if data.subtitle_tracks <> invalid
        for each track in data.subtitle_tracks
            lang = "und"
            if track.language <> invalid and track.language <> "" then lang = track.language
            tracks.Push({ Language: lang, TrackName: AbsoluteUrl(m.serverUrl, track.url), Description: track.label })
            m.pcSubtitleTracks.Push({ id: track.id, label: playerSubtitleLabel(track), url: AbsoluteUrl(m.serverUrl, track.url) })
        end for
    end if
    m.pcPlaybackInfo = data
    m.pcAudioSel = ""
    if data.selected_audio_track_id <> invalid then m.pcAudioSel = data.selected_audio_track_id
    return tracks
end function

' Applies the server's pick (or the viewer's earlier choice, kept across a quality restart) once playback starts.
sub playerSubtitleApply(data as Object)
    chosen = data.selected_subtitle_track_id
    if m.pcSubChosen <> invalid then chosen = m.pcSubChosen
    if chosen = invalid then chosen = ""
    playerSubtitleSelect(chosen, false)
end sub

sub playerSubtitleSelect(id as String, byViewer as Boolean)
    if byViewer then m.pcSubChosen = id
    m.pcSubSel = ""
    m.video.globalCaptionMode = "Off"
    for each track in m.pcSubtitleTracks
        if track.id = id
            m.pcSubSel = id
            m.video.subtitleTrack = track.url
            m.video.globalCaptionMode = "On"
        end if
    end for
end sub

sub playerPanelOpen(kind as String)
    playerChromeBuild()
    rows = []
    index = 0
    if kind = "audio"
        if m.pcPlaybackInfo <> invalid and m.pcPlaybackInfo.audio_tracks <> invalid
            for each track in m.pcPlaybackInfo.audio_tracks
                rows.Push({ id: track.id, label: playerAudioLabel(track), note: "", sel: track.id = m.pcAudioSel, stream: track.stream_index })
            end for
        end if
    else if kind = "subs"
        rows.Push({ id: "", label: "Off", note: "No subtitles", sel: m.pcSubSel = "" })
        for each track in m.pcSubtitleTracks
            rows.Push({ id: track.id, label: track.label, note: "", sel: m.pcSubSel = track.id })
        end for
    else if kind = "queue"
        count = m.playbackEpisodeList.Count()
        if count = 0
            rows.Push({ id: "0", label: endWorkTitle(), note: "", sel: true })
        else
            for i = 0 to count - 1
                info = playbackItemInfo(i)
                rows.Push({ id: i.ToStr(), label: info.title, note: info.code, sel: i = m.playbackEpisodeIndex })
            end for
        end if
    else
        rows = playerInfoRows()
    end if
    for i = 0 to rows.Count() - 1
        if rows[i].sel = true then index = i
    end for
    m.pcRows = rows
    m.pcPanel = kind
    m.pcMenuOpen = true
    m.pcMenuIndex = index
    m.pcPanelFirst = 0
    m.playerControls.visible = true
    m.playerAutoHideTimer.control = "stop"
    playerPanelRender()
end sub

function playerInfoRows() as Object
    data = m.pcPlaybackInfo
    rows = []
    if data = invalid then return rows
    mode = "Direct play"
    if data.mode = "hls" then mode = "Transcoded stream"
    rows.Push({ label: "Playback", note: mode, sel: false })
    rows.Push({ label: "Quality", note: playerQualityLabel(), sel: false })
    if data.mime_type <> invalid then rows.Push({ label: "Format", note: data.mime_type, sel: false })
    stream = m.video.streamInfo
    if stream <> invalid and stream.streamBitrate <> invalid and stream.streamBitrate > 500000
        rows.Push({ label: "Stream bitrate", note: (Int(stream.streamBitrate / 100000) / 10).ToStr() + " Mbps", sel: false })
    end if
    if stream <> invalid and stream.measuredBitrate <> invalid and stream.measuredBitrate > 0
        rows.Push({ label: "Connection", note: (Int(stream.measuredBitrate / 100000) / 10).ToStr() + " Mbps", sel: false })
    end if
    if m.video.videoFormat <> invalid and m.video.videoFormat <> "" then rows.Push({ label: "Video", note: m.video.videoFormat, sel: false })
    if m.video.audioFormat <> invalid and m.video.audioFormat <> "" then rows.Push({ label: "Audio", note: m.video.audioFormat, sel: false })
    subs = "Off"
    for each track in m.pcSubtitleTracks
        if track.id = m.pcSubSel then subs = track.label
    end for
    rows.Push({ label: "Subtitles", note: subs, sel: false })
    return rows
end function

sub playerPanelRender()
    menu = m.pcMenu
    menu.removeChildrenIndex(menu.getChildCount(), 0)
    menu.visible = true
    kind = m.pcPanel
    rows = m.pcRows
    selectable = kind <> "info"
    heading = "SUBTITLES"
    anchorRight = 1436.7
    width = 280
    rowH = 54
    if kind = "audio"
        heading = "AUDIO"
        anchorRight = 1359.1
        width = 340
    else if kind = "queue"
        heading = "UP NEXT"
        anchorRight = 1514.3
        width = 420
    else if kind = "info"
        heading = "PLAYBACK INFO"
        anchorRight = 1778.8
        width = 420
        rowH = 44
    end if
    first = m.pcPanelFirst
    if m.pcMenuIndex < first then first = m.pcMenuIndex
    if selectable and m.pcMenuIndex > first + 7 then first = m.pcMenuIndex - 7
    m.pcPanelFirst = first
    shown = rows.Count() - first
    if shown > 8 then shown = 8
    h = 17.6 + 28 + shown * rowH
    x = anchorRight - width
    y = 944 - h
    pgRound(menu, x, y, width, h, 18, "playerPanel")
    pgRound(menu, x, y, width, h, 18, "playerTint", -1, true)
    pgLabel(menu, x + 17, y + 16, width - 34, 14, heading, 9, 800, "playerMuted")
    cells = []
    for i = 0 to rows.Count() - 1
        cells.Push(invalid)
    end for
    for i = first to first + shown - 1
        row = rows[i]
        ry = y + 8.8 + 28 + (i - first) * rowH
        if selectable
            if row.sel = true then pgRound(menu, x + 8.8, ry, width - 17.6, rowH, 12, "playerSelected")
            if row.note <> ""
                pgLabel(menu, x + 20, ry + 8, width - 70, 19, row.label, 12, 800, "playerInk")
                pgLabel(menu, x + 20, ry + 29, width - 70, 14, row.note, 9, 400, "playerMuted")
            else
                pgLabel(menu, x + 20, ry + 17, width - 70, 19, row.label, 12, 800, "playerInk")
            end if
            if row.sel = true then pgIcon(menu, x + width - 38, ry + 19, 16, "check.png", "brand")
            cells[i] = { x: x + 8.8, y: ry, w: width - 17.6, h: rowH }
        else
            pgLabel(menu, x + 20, ry + 4, width - 40, 14, UCase(row.label), 9, 800, "playerMuted")
            pgLabel(menu, x + 20, ry + 20, width - 40, 19, row.note, 12, 800, "playerInk")
        end if
    end for
    m.pcMenuCells = cells
    if selectable then playerMenuRing() else m.pcRing.visible = false
    m.pcFocusRing.visible = false
    playerParityEmit(playerFocusLabel())
end sub

function playerPanelKey(key as String) as Boolean
    rows = m.pcRows
    if key = "back" or key = "left" or (key = "OK" and m.pcPanel = "info")
        playerMenuClose()
        return true
    else if key = "OK" and rows.Count() > 0
        row = rows[m.pcMenuIndex]
        kind = m.pcPanel
        playerMenuClose()
        if kind = "audio"
            ' Same as web: a replacement session at this position that maps the chosen stream.
            if row.id <> m.pcAudioSel
                m.audioStreamIndex = row.stream
                playerApplyQuality()
            end if
        else if kind = "subs"
            playerSubtitleSelect(row.id, true)
        else if kind = "queue" and m.playbackEpisodeList.Count() > 0
            at = row.id.ToInt()
            if at <> m.playbackEpisodeIndex then playAdjacentEpisode(at - m.playbackEpisodeIndex)
        end if
        return true
    else if key = "up" and m.pcMenuIndex > 0
        m.pcMenuIndex -= 1
    else if key = "down" and m.pcMenuIndex < rows.Count() - 1
        m.pcMenuIndex += 1
    end if
    playerPanelRender()
    return true
end function

' The focused control's accessible name, as the web's aria-labels read (lower case), for the parity suite's D-pad checks.
function playerFocusLabel() as String
    if m.pcMenuOpen = true and m.pcRows <> invalid and m.pcPanel <> "quality" and m.pcPanel <> "info" and m.pcRows.Count() > 0
        row = m.pcRows[m.pcMenuIndex]
        text = row.label + row.note
        if row.sel = true then text += "✓"
        return LCase(text)
    end if
    id = m.pcFocus
    if id = "seek" then return "seek"
    if id = "play"
        if m.video.state = "paused" then return "play"
        return "pause"
    end if
    if id = "minimise" then return "minimise"
    if id = "close" then return "close"
    if id = "prev" then return "previous episode"
    if id = "next" then return "next episode"
    if id = "mute"
        if m.pcMuted = true then return "unmute"
        return "mute"
    end if
    if id = "audio"
        label = ""
        if m.pcPlaybackInfo <> invalid and m.pcPlaybackInfo.audio_tracks <> invalid
            for each track in m.pcPlaybackInfo.audio_tracks
                if track.id = m.pcAudioSel then label = playerAudioLabel(track)
            end for
        end if
        return LCase("audio: " + label)
    end if
    if id = "subs"
        label = "off"
        for each track in m.pcSubtitleTracks
            if track.id = m.pcSubSel then label = track.label
        end for
        return LCase("subtitles: " + label)
    end if
    if id = "queue"
        n = m.playbackEpisodeList.Count()
        if n <= 1 then return "playlist: 1 item"
        return "playlist: " + n.ToStr() + " episodes"
    end if
    if id = "quality" then return LCase("quality: " + playerQualityLabel())
    return "playback health"
end function

sub playerParityEmit(label as String)
    if label = m.pcLastEmit then return
    m.pcLastEmit = label
    parityEmit("focus", label)
end sub

' ---------------------------------------------------------------------------
' Track labels, ported from the web's lib/trackLabels.ts: language name, distinguishing title, codec, channel layout, joined by " · ".

function playerLanguageName(code as Dynamic) as String
    if code = invalid then return ""
    c = LCase(code.Trim())
    if c = "" or c = "und" then return ""
    names = { eng: "English", spa: "Spanish", fra: "French", fre: "French", deu: "German", ger: "German", ita: "Italian", por: "Portuguese", jpn: "Japanese", kor: "Korean", zho: "Chinese", chi: "Chinese", hin: "Hindi", ara: "Arabic", tha: "Thai", rus: "Russian", nld: "Dutch", dut: "Dutch", swe: "Swedish", nor: "Norwegian", dan: "Danish", fin: "Finnish", pol: "Polish", tur: "Turkish", heb: "Hebrew", ell: "Greek", gre: "Greek", ces: "Czech", cze: "Czech", hun: "Hungarian", ron: "Romanian", rum: "Romanian", ukr: "Ukrainian", vie: "Vietnamese", ind: "Indonesian" }
    if names[c] <> invalid then return names[c]
    return c
end function

function playerTrackTitle(label as String, code as Dynamic, langName as String) as String
    title = label.Trim()
    low = LCase(title)
    if title = "" then return ""
    if code <> invalid and low = LCase(code.Trim()) then return ""
    if langName <> "" and Instr(1, low, LCase(langName)) > 0 then return ""
    r = CreateObject("roRegex", "^(audio|subtitles?)\s*[0-9]+$", "")
    if r.IsMatch(low) then return ""
    return title
end function

function playerJoin(parts as Object) as String
    out = ""
    for each part in parts
        if part <> "" then
            if out <> "" then out += " · "
            out += part
        end if
    end for
    return out
end function

function playerAudioLabel(track as Object) as String
    lang = playerLanguageName(track.language)
    codec = ""
    if track.codec_label <> invalid and track.codec_label.Trim() <> ""
        codec = track.codec_label.Trim()
    else if track.codec <> invalid
        c = LCase(track.codec.Trim())
        if c = "ac3" then codec = "AC3"
        if c = "eac3" then codec = "E-AC3"
        if c = "truehd" then codec = "TrueHD"
        if c = "opus" then codec = "Opus"
        if c = "vorbis" then codec = "Vorbis"
        if codec = "" and c <> "" then codec = UCase(c)
    end if
    layout = ""
    ch = track.channels
    if ch <> invalid
        layouts = { "1": "Mono", "2": "Stereo", "3": "2.1", "4": "4.0", "5": "5.0", "6": "5.1", "7": "6.1", "8": "7.1" }
        key = Int(ch).ToStr()
        if layouts[key] <> invalid
            layout = layouts[key]
        else if ch > 0
            layout = key + " ch"
        end if
    end if
    out = playerJoin([lang, playerTrackTitle(track.label, track.language, lang), codec, layout])
    if out = "" then return track.label
    return out
end function

function playerSubtitleLabel(track as Object) as String
    lang = playerLanguageName(track.language)
    forced = ""
    if track.forced = true then forced = "Forced"
    out = playerJoin([lang, playerTrackTitle(track.label, track.language, lang), forced])
    if out = "" then return track.label
    return out
end function
