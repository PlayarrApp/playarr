using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public sealed class SearchCaptionLayoutTests
{
    [Fact]
    public void CaptionWidthReducesTitleAndPreservesWebInsetsAndGap()
    {
        const float cardWidth = 327.2f;
        const float inset = 1.92f;
        const float gap = 9.6f;
        var shortCaption = SearchCaptionLayout.Create(cardWidth, inset, 25f, gap);
        var longCaption = SearchCaptionLayout.Create(cardWidth, inset, 70f, gap);

        Assert.Equal(inset, longCaption.TitleX);
        Assert.Equal(inset, shortCaption.TitleX);
        Assert.Equal(25f, shortCaption.CaptionWidth);
        Assert.Equal(70f, longCaption.CaptionWidth);
        Assert.Equal(gap, longCaption.CaptionX - (longCaption.TitleX + longCaption.TitleWidth), 4);
        Assert.Equal(gap, shortCaption.CaptionX - (shortCaption.TitleX + shortCaption.TitleWidth), 4);
        Assert.Equal(45f, shortCaption.TitleWidth - longCaption.TitleWidth, 4);
        Assert.Equal(cardWidth - inset, longCaption.CaptionX + longCaption.CaptionWidth, 4);
    }

    [Fact]
    public void NarrowCardsClampCaptionAndTitleWithoutNegativeWidths()
    {
        var layout = SearchCaptionLayout.Create(cardWidth: 20f, copyInset: 3f, captionWidth: 50f, gap: 9.6f);

        Assert.Equal(14f, layout.CaptionWidth);
        Assert.Equal(0f, layout.TitleWidth);
        Assert.Equal(3f, layout.CaptionX);
        Assert.Equal(17f, layout.CaptionX + layout.CaptionWidth);
    }
}
