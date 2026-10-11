namespace Playarr.Tizen.Logic;

/// <summary>sRGB colour, channels 0..1. Plain data so the tokens are testable without NUI.</summary>
public readonly record struct Rgba(float R, float G, float B, float A = 1f)
{
    public static Rgba Hex(uint rgb, float a = 1f) => new(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, a);
    public static Rgba Of(int r, int g, int b, float a = 1f) => new(r / 255f, g / 255f, b / 255f, a);
}

/// <summary>The web design tokens (clients/tv-web/web/src/styles/global.css :root and [data-theme=dark]). Web is the source of truth.</summary>
public sealed record PlayarrTheme(
    string Name, Rgba Bg, Rgba Surface, Rgba SurfaceStrong, Rgba SurfaceSoft,
    Rgba Ink, Rgba InkSoft, Rgba InkMuted, Rgba Line, Rgba LineStrong,
    Rgba Brand, Rgba BrandInk, Rgba Accent, Rgba OnAccent, Rgba Danger, Rgba Scrim, Rgba ShadowTint)
{
    public static readonly PlayarrTheme Dark = new("dark",
        Bg: Rgba.Hex(0x151315), Surface: Rgba.Hex(0x1b181b), SurfaceStrong: Rgba.Hex(0x211d21), SurfaceSoft: Rgba.Hex(0x312a30),
        Ink: Rgba.Hex(0xf4f0f1), InkSoft: Rgba.Hex(0xcdc1c6), InkMuted: Rgba.Hex(0xc2b5bb),
        Line: Rgba.Of(223, 220, 221, 0.11f), LineStrong: Rgba.Of(223, 220, 221, 0.23f),
        Brand: Rgba.Hex(0xcf3157), BrandInk: Rgba.Hex(0xeaa6b6), Accent: Rgba.Hex(0xdfdcdd), OnAccent: Rgba.Hex(0x211d21),
        Danger: Rgba.Hex(0xf1a4a8), Scrim: Rgba.Of(0, 0, 0, 0.5f), ShadowTint: Rgba.Of(56, 38, 33, 1f));

    public static readonly PlayarrTheme Light = new("light",
        Bg: Rgba.Hex(0xf5f3f2), Surface: Rgba.Hex(0xfbfaf9), SurfaceStrong: Rgba.Hex(0xffffff), SurfaceSoft: Rgba.Hex(0xdfdcdd),
        Ink: Rgba.Hex(0x382621), InkSoft: Rgba.Hex(0x443a40), InkMuted: Rgba.Hex(0x4d4248),
        Line: Rgba.Of(56, 38, 33, 0.14f), LineStrong: Rgba.Of(56, 38, 33, 0.28f),
        Brand: Rgba.Hex(0xcf3157), BrandInk: Rgba.Hex(0x821e36), Accent: Rgba.Hex(0x4d4248), OnAccent: Rgba.Hex(0xffffff),
        Danger: Rgba.Hex(0x722f34), Scrim: Rgba.Of(0, 0, 0, 0.5f), ShadowTint: Rgba.Of(56, 38, 33, 1f));

    public static PlayarrTheme ByName(string? name) => name == "light" ? Light : Dark;
}
