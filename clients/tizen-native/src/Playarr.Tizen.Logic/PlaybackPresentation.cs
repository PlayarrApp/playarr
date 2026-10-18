using System.Globalization;

namespace Playarr.Tizen.Logic;

public sealed record PlaybackQualityPresentation(string Badge, string Label);

public static class PlaybackPresentation
{
    public static PlaybackQualityPresentation Quality(string? id, string? label, int? height, long? bitrateBps)
    {
        var badge = height switch { 2160 => "UHD", 1080 => "FHD", 720 => "HD", 480 => "SD", _ => "HD" };
        var displayLabel = label ?? id ?? "Original";
        if (id == "original")
        {
            var mbps = bitrateBps is > 0 ? bitrateBps.Value / 1_000_000d : 0;
            displayLabel = mbps >= 0.05 ? string.Format(CultureInfo.InvariantCulture, "Original · {0:0.0} Mbps", mbps) : "Original";
        }
        return new PlaybackQualityPresentation(badge, displayLabel);
    }
}
