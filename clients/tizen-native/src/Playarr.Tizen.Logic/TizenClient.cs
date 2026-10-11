using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

public static class TizenClient
{
    /// <summary>
    /// Client identity sent to the link broker and server. "web" until the server's ClientPlatform enum and the
    /// broker allow-list accept "tizen-native"; switch this one constant when they do.
    /// </summary>
    public const string PlatformId = "web";

    public const string DeviceName = "Samsung TV";

    /// <summary>Design canvas: web TV's 1920x1080 layout.</summary>
    public const int DesignWidth = 1920, DesignHeight = 1080;
}
