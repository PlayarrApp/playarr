sub Main(args as Dynamic)
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)

    parityArtEnabled = false
    if type(args) = "roAssociativeArray" and args.parityArtReady = "1" then parityArtEnabled = true
    ' Parity captures freeze the clock with launch parameter parityNow=<ISO instant>; empty means the real clock.
    parityNow = ""
    if type(args) = "roAssociativeArray" and args.parityNow <> invalid then parityNow = args.parityNow
    screen.getGlobalNode().addFields({ themeMode: ResolvePairingTheme(LoadPairingThemePreference()), cardFocusOff: false, parityArtEnabled: parityArtEnabled, parityNow: parityNow })
    scene = screen.CreateScene("MainScene")
    ' ECP deep link (launch with contentId=<media file id>): signed-in devices play that file as soon as the profile is known.
    if type(args) = "roAssociativeArray" and args.contentId <> invalid and args.contentId <> "" then scene.deepLink = args.contentId
    screen.Show()
    scene.SetFocus(true)

    while true
        message = wait(0, port)
        if type(message) = "roSGScreenEvent" and message.IsScreenClosed()
            return
        end if
    end while
end sub
