namespace Playarr.Tizen.Logic;

/// <summary>Allocates a Search card's caption row like the web's two-column title and kind layout.</summary>
public readonly record struct SearchCaptionLayout(float TitleX, float TitleWidth, float CaptionX, float CaptionWidth)
{
    public static SearchCaptionLayout Create(float cardWidth, float copyInset, float captionWidth, float gap)
    {
        var innerWidth = Math.Max(0, cardWidth - copyInset * 2);
        var visibleCaptionWidth = Math.Clamp(captionWidth, 0, innerWidth);
        var titleWidth = Math.Max(0, innerWidth - visibleCaptionWidth - gap);
        return new SearchCaptionLayout(copyInset, titleWidth, copyInset + innerWidth - visibleCaptionWidth, visibleCaptionWidth);
    }
}
