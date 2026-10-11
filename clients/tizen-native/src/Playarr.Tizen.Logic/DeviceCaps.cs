using System.Globalization;

namespace Playarr.Tizen.Logic;

/// <summary>
/// What this device can really decode and output, reported to the server on every playback negotiation (rows 20.10092/20.10093,
/// scratch media-caps CLIENT-NOTES). Unknown fields stay null and are omitted so the server leaves them unconstrained.
/// </summary>
public sealed record DeviceCaps(
    IReadOnlyList<string> Containers,
    IReadOnlyList<string> VideoCodecs,
    IReadOnlyList<string> AudioCodecs,
    int? MaxBitDepth = null,
    IReadOnlyList<string>? Hdr = null,
    IReadOnlyList<int>? DvProfiles = null,
    IReadOnlyList<string>? VideoProfiles = null,
    int? MaxWidth = null, int? MaxHeight = null, int? MaxFps = null,
    int? MaxChannels = null,
    IReadOnlyList<string>? Passthrough = null)
{
    /// <summary>The query parameters of GET /api/v1/playback/{id}. The Force flags are per axis, default off, and only sent when on.</summary>
    public IReadOnlyDictionary<string, string> ToQuery(bool forceDirectVideo = false, bool forceDirectAudio = false)
    {
        var q = new Dictionary<string, string>
        {
            ["containers"] = string.Join(",", Containers),
            ["video_codecs"] = string.Join(",", VideoCodecs),
            ["audio_codecs"] = string.Join(",", AudioCodecs),
        };
        if (MaxBitDepth is { } depth)
        {
            q["max_bit_depth"] = depth.ToString(CultureInfo.InvariantCulture);
            // a device that cannot show HDR still declares its bit depth with an empty hdr list so the server tone-maps
            q["hdr"] = Hdr is null ? "" : string.Join(",", Hdr);
        }
        else if (Hdr is { Count: > 0 }) q["hdr"] = string.Join(",", Hdr);
        if (DvProfiles is { Count: > 0 }) q["dv_profiles"] = string.Join(",", DvProfiles);
        if (VideoProfiles is { Count: > 0 }) q["video_profiles"] = string.Join(",", VideoProfiles);
        if (MaxWidth is { } w) q["max_width"] = w.ToString(CultureInfo.InvariantCulture);
        if (MaxHeight is { } h) q["max_height"] = h.ToString(CultureInfo.InvariantCulture);
        if (MaxFps is { } f) q["max_fps"] = f.ToString(CultureInfo.InvariantCulture);
        if (MaxChannels is { } c) q["max_channels"] = c.ToString(CultureInfo.InvariantCulture);
        if (Passthrough is { Count: > 0 }) q["passthrough"] = string.Join(",", Passthrough);
        if (forceDirectVideo) q["force_direct_video"] = "true";
        if (forceDirectAudio) q["force_direct_audio"] = "true";
        return q;
    }

    /// <summary>
    /// A Samsung Tizen TV's decoders (H.264, HEVC Main 10, VP9; AAC, MP3, AC-3, E-AC-3 in mp4, mkv and ts), 10-bit, 4K at 60 fps, stereo
    /// output unless the TV reports more, no HDR claim (it is not detectable here, so the server tone-maps).
    /// </summary>
    public static DeviceCaps Tv(int maxChannels = 2) => new(
        new[] { "mp4", "mkv", "ts", "mp3", "m4a" }, new[] { "h264", "hevc", "vp9" }, new[] { "aac", "mp3", "ac3", "eac3" },
        MaxBitDepth: 10, Hdr: Array.Empty<string>(), VideoProfiles: new[] { "hevc:main 10" },
        MaxWidth: 3840, MaxHeight: 2160, MaxFps: 60, MaxChannels: maxChannels);

    /// <summary>The emulator decodes in software with a small codec set: claim only what the web Tizen shell does (H.264, AAC, MP3).</summary>
    public static DeviceCaps Emulator() => new(new[] { "mp4", "mp3", "m4a" }, new[] { "h264" }, new[] { "aac", "mp3" },
        MaxBitDepth: 8, Hdr: Array.Empty<string>(), MaxWidth: 1920, MaxHeight: 1080, MaxFps: 30, MaxChannels: 2);
}

/// <summary>The server refuses a negotiation it cannot satisfy (e.g. 422 unsupported_colour_format): show the message, never retry.</summary>
public sealed class PlaybackRefusedException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
