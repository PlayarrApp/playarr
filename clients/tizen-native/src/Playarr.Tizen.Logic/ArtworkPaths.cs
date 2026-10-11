using Playarr.Core.Models;

namespace Playarr.Tizen.Logic;

/// <summary>
/// Server-side artwork: web never loads a provider URL directly, it asks GET /api/v1/artwork/work/{id}/{kind}?w=&amp;v= (resized,
/// cached, authenticated). Port of lib/artwork.tsx (default widths and the FNV-1a version of the source URL).
/// </summary>
public static class ArtworkPaths
{
    public static int DefaultWidth(ImageKind kind) => kind switch
    {
        ImageKind.Poster => 360,
        ImageKind.Thumb => 540,
        ImageKind.Logo => 540,
        ImageKind.Banner => 780,
        ImageKind.Backdrop => 780,
        _ => 540,
    };

    public static string Version(string sourceUrl)
    {
        var hash = 0x811c9dc5u;
        foreach (var c in sourceUrl) { hash ^= c; hash = unchecked(hash * 0x01000193u); }
        return hash.ToString("x8");
    }

    public static string Wire(ImageKind kind) => kind switch
    {
        ImageKind.Poster => "poster", ImageKind.Backdrop => "backdrop", ImageKind.Banner => "banner",
        ImageKind.Logo => "logo", ImageKind.Thumb => "thumb", _ => "poster",
    };

    public static string? Path(Work w, ImageKind kind, int? width = null)
    {
        var img = w.Image(kind);
        return img is null ? null : $"/api/v1/artwork/work/{w.Id:D}/{Wire(kind)}?w={width ?? DefaultWidth(kind)}&v={Version(img.Url)}";
    }

    /// <summary>The first available of the kinds, in order.</summary>
    public static string? First(Work w, params ImageKind[] kinds)
    {
        foreach (var k in kinds) if (Path(w, k) is { } p) return p;
        return null;
    }
}
