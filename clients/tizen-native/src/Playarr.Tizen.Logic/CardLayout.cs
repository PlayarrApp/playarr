namespace Playarr.Tizen.Logic;

/// <summary>
/// Web poster-card geometry (page-layout.css --card-*): the Library grid column is the canonical card. The rail is 1033.4 px wide at 1920x1080,
/// split into 3 columns (thumbnails) or 5 (covers), plus one column for artwork size small, minus one for large. Measured from web with
/// each Home view and Artwork size setting.
/// </summary>
public readonly record struct CardLayout(bool Cover, string Size)
{
    public const float RailSpan = 1033.4f, HomeGap = 24.9f, CaptionH = 29.4f, StageArtH = 184f;

    public int Columns => (Cover ? 5 : 3) + (Size == "small" ? 1 : Size == "large" ? -1 : 0);
    public float ColumnGap => Cover ? 19.2f : 25.9f;
    public float RowGap => Cover ? 32.4f : 27f;
    public float Width => (RailSpan - (Columns - 1) * ColumnGap) / Columns;
    public float ArtHeight => Cover ? Width * 1.5f : Width * 9f / 16f;
    public float CardHeight => ArtHeight + CaptionH;
    /// <summary>Library grid: column pitch and row pitch.</summary>
    public float LibraryPitchX => Width + ColumnGap;
    public float LibraryPitchY => CardHeight + RowGap;
    /// <summary>Home rails: card pitch, rail pitch (web 365.9 at the default) and the focused rail heading offset (the focused card stays centred on the same line).</summary>
    public float HomePitchX => Width + HomeGap;
    public float HomeRailPitch => 365.9f + (ArtHeight - StageArtH);
    public float HomeHeadingShift => -(ArtHeight - StageArtH) / 2f;

    public static CardLayout From(string homeView, string artworkSize) => new(homeView == "cover", artworkSize is "small" or "large" ? artworkSize : "medium");
    public static CardLayout Library(bool cover, string artworkSize) => new(cover, artworkSize is "small" or "large" ? artworkSize : "medium");
}
