' DeviceCaps.brs
'
' The real video and audio capabilities of this Roku, as the server's playback negotiation wants them (rows 20.10092 and 20.10093,
' CLIENT-NOTES.md): codecs, bit depth, HDR and Dolby Vision profiles, picture size and rate, output channels and passthrough.
' Anything the device cannot answer is left out, so the server treats it as unconstrained.

function DeviceMediaCaps() as Object
    di = CreateObject("roDeviceInfo")
    caps = {
        videoCodecs: ["h264"]
        videoProfiles: []
        hdr: []
        dvProfiles: []
        maxBitDepth: 8
        maxWidth: 1920
        maxHeight: 1080
        maxFps: 30
        maxChannels: 2
        passthrough: []
    }
    ' Video decoders: CanDecodeVideo answers per codec and profile.
    if DeviceCanDecode(di, { Codec: "hevc", Profile: "main 10", Level: "5.1" })
        caps.videoCodecs.Push("hevc")
        caps.videoProfiles.Push("hevc:main 10")
        caps.maxBitDepth = 10
    else if DeviceCanDecode(di, { Codec: "hevc", Profile: "main", Level: "4.1" })
        caps.videoCodecs.Push("hevc")
        caps.videoProfiles.Push("hevc:main")
    end if
    if DeviceCanDecode(di, { Codec: "vp9", Profile: "profile 0" }) then caps.videoCodecs.Push("vp9")
    if DeviceCanDecode(di, { Codec: "av1", Profile: "main" }) then caps.videoCodecs.Push("av1")

    ' Output size and rate from the current video mode ("1080p60", "2160p60", "720p").
    mode = invalid
    if FindMemberFunction(di, "GetVideoMode") <> invalid then mode = di.GetVideoMode()
    if mode <> invalid and type(mode) = "roString"
        height = Val(mode)
        if height >= 2160
            caps.maxWidth = 3840
            caps.maxHeight = 2160
        else if height >= 1080
            caps.maxWidth = 1920
            caps.maxHeight = 1080
        else if height > 0
            caps.maxWidth = 1280
            caps.maxHeight = 720
        end if
        p = Instr(1, mode, "p")
        if p > 0
            fps = Val(Mid(mode, p + 1))
            if fps >= 24 then caps.maxFps = Int(fps)
        end if
    end if

    ' HDR: only what the display accepts and the 10-bit decoder can render.
    display = invalid
    if FindMemberFunction(di, "GetDisplayProperties") <> invalid then display = di.GetDisplayProperties()
    if display <> invalid and type(display) = "roAssociativeArray" and caps.maxBitDepth >= 10
        if display.Hdr10 = true then caps.hdr.Push("hdr10")
        if display.Hlg = true then caps.hdr.Push("hlg")
        if display.DolbyVision = true
            caps.hdr.Push("dolby_vision")
            ' Profile 8 (the HDR10-compatible one) plays on every Dolby Vision Roku; profile 5 is not claimed.
            caps.dvProfiles.Push("8")
        end if
    end if

    ' Audio: channel layout of the output and the codecs it can take as they are.
    layout = invalid
    if FindMemberFunction(di, "GetAudioOutputChannel") <> invalid then layout = di.GetAudioOutputChannel()
    if layout <> invalid and type(layout) = "roString"
        if Instr(1, layout, "7.1") > 0
            caps.maxChannels = 8
        else if Instr(1, layout, "5.1") > 0
            caps.maxChannels = 6
        end if
    end if
    decoders = invalid
    if FindMemberFunction(di, "GetAudioDecoders") <> invalid then decoders = di.GetAudioDecoders()
    if decoders <> invalid
        names = {}
        if type(decoders) = "roAssociativeArray"
            for each key in decoders
                names[LCase(key)] = true
            end for
        else if type(decoders) = "roArray"
            for each entry in decoders
                if type(entry) = "roAssociativeArray" and entry.DecoderName <> invalid then names[LCase(entry.DecoderName)] = true
                if type(entry) = "roAssociativeArray" and entry.Codec <> invalid then names[LCase(entry.Codec)] = true
            end for
        end if
        for each codec in ["eac3", "ac3", "dts", "truehd"]
            if names[codec] = true then caps.passthrough.Push(codec)
        end for
        if names["dolby digital plus"] = true and names["eac3"] <> true then caps.passthrough.Push("eac3")
        if names["dolby digital"] = true and names["ac3"] <> true then caps.passthrough.Push("ac3")
    end if
    return caps
end function

function DeviceCanDecode(di as Object, options as Object) as Boolean
    if FindMemberFunction(di, "CanDecodeVideo") = invalid then return false
    result = di.CanDecodeVideo(options)
    return type(result) = "roAssociativeArray" and result.result = true
end function

function DeviceCodecList(caps as Object) as String
    return JoinList(caps.videoCodecs, ",")
end function

function JoinList(items as Object, separator as String) as String
    text = ""
    for each item in items
        if text <> "" then text = text + separator
        text = text + item
    end for
    return text
end function

' Query fields the playback request adds: caps (video when bit depth or HDR is known, audio when channels are) and the two force flags.
function DeviceCapsQuery(caps as Object, forceVideo as Boolean, forceAudio as Boolean) as String
    q = "&video_codecs=" + UrlEncode(DeviceCodecList(caps))
    q = q + "&hdr=" + UrlEncode(JoinList(caps.hdr, ","))
    if caps.dvProfiles.Count() > 0 then q = q + "&dv_profiles=" + UrlEncode(JoinList(caps.dvProfiles, ","))
    q = q + "&max_bit_depth=" + caps.maxBitDepth.ToStr()
    if caps.videoProfiles.Count() > 0 then q = q + "&video_profiles=" + UrlEncode(JoinList(caps.videoProfiles, ","))
    q = q + "&max_width=" + caps.maxWidth.ToStr() + "&max_height=" + caps.maxHeight.ToStr() + "&max_fps=" + caps.maxFps.ToStr()
    q = q + "&max_channels=" + caps.maxChannels.ToStr()
    if caps.passthrough.Count() > 0 then q = q + "&passthrough=" + UrlEncode(JoinList(caps.passthrough, ","))
    if forceVideo then q = q + "&force_direct_video=true"
    if forceAudio then q = q + "&force_direct_audio=true"
    return q
end function
