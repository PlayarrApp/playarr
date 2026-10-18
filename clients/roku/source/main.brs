sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    parityArtEnabled = false
    if type(args) = "roAssociativeArray" and args.parityArtReady = "1" then parityArtEnabled = true
    screen.getGlobalNode().addFields({ themeMode: ResolvePairingTheme(LoadPairingThemePreference()), cardFocusOff: false, parityArtEnabled: parityArtEnabled })
    scene = screen.CreateScene("MainScene")
    ' ECP deep link (launch with contentId=<media file id>): signed-in devices play that file as soon as the profile is known.
    if type(args) = "roAssociativeArray" and args.contentId <> invalid and args.contentId <> "" then scene.deepLink = args.contentId
    ' Parity-only web route (launch with route=/movies/<work id> or /series/<work id> and parityArtReady=1): opens that title's detail.
    if parityArtEnabled and args.route <> invalid and args.route <> "" then scene.deepRoute = args.route
    screen.Show()
    scene.SetFocus(true)

    while true
        message = wait(0, port)
        if type(message) = "roSGScreenEvent" and message.IsScreenClosed()
            return
        end if
    end while
end sub
