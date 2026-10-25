sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    parityArtEnabled = false
    if type(args) = "roAssociativeArray" and args.parityArtReady = "1" then parityArtEnabled = true
    ' Parity-only frozen clock (launch with parityNow=<ISO 8601 UTC> and parityArtReady=1): the clock, Today and entry times then read as UTC.
    parityNowSeconds = 0
    if parityArtEnabled and args.parityNow <> invalid and args.parityNow <> ""
        pin = CreateObject("roDateTime")
        pin.FromISO8601String(args.parityNow)
        parityNowSeconds = pin.AsSeconds()
    end if
    screen.getGlobalNode().addFields({ themeMode: ResolvePairingTheme(LoadPairingThemePreference()), cardFocusOff: false, parityArtEnabled: parityArtEnabled, parityNowSeconds: parityNowSeconds })
    scene = screen.CreateScene("MainScene")
    ' ECP deep link (launch with contentId=<media file id>): signed-in devices play that file as soon as the profile is known.
    if type(args) = "roAssociativeArray" and args.contentId <> invalid and args.contentId <> "" then scene.deepLink = args.contentId
    ' Parity-only web route (launch with route=/movies/<work id> or /series/<work id> and parityArtReady=1): opens that title's detail.
    if parityArtEnabled and args.route <> invalid and args.route <> "" then scene.deepRoute = args.route
    screen.Show()
    scene.SetFocus(true)
    input = CreateObject("roInput")
    input.SetMessagePort(port)

    while true
        message = wait(0, port)
        if type(message) = "roSGScreenEvent" and message.IsScreenClosed()
            return
        else if type(message) = "roInputEvent"
            info = message.GetInfo()
            if parityArtEnabled and info <> invalid and info.paritySeek <> invalid then scene.paritySeek = Val(info.paritySeek)
        end if
    end while
end sub
