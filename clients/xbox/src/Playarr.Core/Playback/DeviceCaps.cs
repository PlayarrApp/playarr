using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Playarr.Core.Playback
{
    /// <summary>
    /// What this device really renders, as the playback negotiation's optional media-capability parameters
    /// (<c>hdr</c>, <c>dv_profiles</c>, <c>max_bit_depth</c>, <c>video_profiles</c>, <c>max_channels</c>,
    /// <c>passthrough</c>) plus the two per-axis force flags. Plain data: the application head reads the display and the
    /// audio route and passes the facts in, so the builder stays unit-testable off Windows.
    /// </summary>
    public sealed class DeviceCaps
    {
        /// <summary>HDR formats the decoder and the display both render: <c>hdr10</c>, <c>hlg</c>, <c>dolby_vision</c>. Empty means SDR only.</summary>
        public IReadOnlyList<string> Hdr { get; set; } = Array.Empty<string>();

        /// <summary>Dolby Vision profiles rendered natively. Profile 5 is only copied when listed.</summary>
        public IReadOnlyList<int> DvProfiles { get; set; } = Array.Empty<int>();

        public int MaxBitDepth { get; set; } = 8;

        public IReadOnlyList<string> VideoProfiles { get; set; } = Array.Empty<string>();

        public int? MaxChannels { get; set; }

        public IReadOnlyList<string> Passthrough { get; set; } = Array.Empty<string>();

        public bool ForceDirectVideo { get; set; }

        public bool ForceDirectAudio { get; set; }

        /// <summary>
        /// The Xbox app partition's real capabilities. <paramref name="displayHdr10"/> is whether the connected display is
        /// currently in an HDR10 advanced-colour mode. Dolby Vision is never reported: it is reachable only through the
        /// dedicated Dolby Vision app path, not a <c>MediaPlayerElement</c>. HEVC consoles decode Main 10 (10-bit); the
        /// original Xbox One decodes 8-bit H.264 only. Audio: AC-3/E-AC-3 decode to 5.1 and reach a receiver by pass-through.
        /// </summary>
        public static DeviceCaps ForXbox(XboxPlaybackProfile profile, bool displayHdr10, bool forceDirectVideo, bool forceDirectAudio)
        {
            var hevc = profile.SupportsVideoCodec("hevc");
            return new DeviceCaps
            {
                Hdr = hevc && displayHdr10 ? new[] { "hdr10" } : Array.Empty<string>(),
                MaxBitDepth = hevc ? 10 : 8,
                // Xbox Media Foundation supports H.264 High on every model, and HEVC
                // Main/Main 10 on models with HEVC decode. Keep the server's global
                // profile allowlist complete for the codecs this client advertises.
                VideoProfiles = hevc
                    ? new[] { "h264:baseline", "h264:constrained baseline", "h264:main", "h264:high", "hevc:main", "hevc:main 10" }
                    : new[] { "h264:baseline", "h264:constrained baseline", "h264:main", "h264:high" },
                MaxChannels = 6,
                Passthrough = new[] { "eac3", "ac3" },
                ForceDirectVideo = forceDirectVideo,
                ForceDirectAudio = forceDirectAudio,
            };
        }

        /// <summary>
        /// The query parameters. Sending <c>max_bit_depth</c> declares the video caps and <c>max_channels</c> the audio caps;
        /// <c>hdr</c> is always sent (empty when the device cannot render HDR) so the server tone-maps. Force flags are sent
        /// only when on.
        /// </summary>
        public IReadOnlyDictionary<string, string> ToQueryParameters()
        {
            var query = new Dictionary<string, string>
            {
                ["hdr"] = string.Join(",", Hdr),
                ["max_bit_depth"] = MaxBitDepth.ToString(CultureInfo.InvariantCulture),
            };
            if (DvProfiles.Count > 0)
            {
                query["dv_profiles"] = string.Join(",", DvProfiles.Select(p => p.ToString(CultureInfo.InvariantCulture)));
            }

            if (VideoProfiles.Count > 0)
            {
                query["video_profiles"] = string.Join(",", VideoProfiles);
            }

            if (MaxChannels is { } channels)
            {
                query["max_channels"] = channels.ToString(CultureInfo.InvariantCulture);
            }

            if (Passthrough.Count > 0)
            {
                query["passthrough"] = string.Join(",", Passthrough);
            }

            if (ForceDirectVideo)
            {
                query["force_direct_video"] = "true";
            }

            if (ForceDirectAudio)
            {
                query["force_direct_audio"] = "true";
            }

            return query;
        }
    }
}
