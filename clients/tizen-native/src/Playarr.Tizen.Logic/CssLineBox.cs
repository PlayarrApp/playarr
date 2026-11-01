namespace Playarr.Tizen.Logic;

/// <summary>
/// The browser's single-line text box (Blink): the content area is the font's ascent and descent each rounded at the CSS size, and it sits in the
/// CSS line box at the half-leading floored (FontHeight::AddLeading). One rule for every label of the app; no per-size table.
/// </summary>
public static class CssLineBox
{
    /// <summary>Nunito Sans ascent 1.011 em and descent 0.353 em, each rounded.</summary>
    public static float Content(float size) => (float)Math.Round(1.011 * size) + (float)Math.Round(0.353 * size);

    /// <summary>Offset of the content area's top below the top of a CSS line box of height <paramref name="line"/>.</summary>
    public static float Top(float line, float size) => (float)Math.Floor((line - Content(size)) / 2f);
}
