using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

public static class TizenClient
{
    /// <summary>Client identity sent to the link broker and the server (accepted since the broker and ClientPlatform enum gained it).</summary>
    public const string PlatformId = "tizen-native";

    public const string DeviceName = "Samsung TV";

    /// <summary>Design canvas: web TV's 1920x1080 layout.</summary>
    public const int DesignWidth = 1920, DesignHeight = 1080;
}
