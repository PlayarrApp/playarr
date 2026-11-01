using Playarr.Tizen.Logic;
using Xunit;

public class CssLineBoxTests
{
    [Theory]
    [InlineData(17.28f, 18f, 24f)]   // round(17.47)=17 + round(6.1)=6 -> 23
    [InlineData(12.8f, 13f, 18f)]    // 13 + 5 = 18
    [InlineData(33.6f, 34f, 12f)]    // 34 + 12 = 46
    public void ContentAreaIsRoundedAscentPlusRoundedDescent(float size, float _, float __)
    {
        Assert.Equal((float)Math.Round(1.011 * size) + (float)Math.Round(0.353 * size), CssLineBox.Content(size));
    }

    [Fact]
    public void HalfLeadingIsFlooredNotRounded()
    {
        // line 24, content 23 -> leading 1 -> floor(0.5) = 0 (not 1)
        Assert.Equal(0f, CssLineBox.Top(24f, 17.28f));
        // line 30, content 23 -> leading 7 -> floor(3.5) = 3
        Assert.Equal(3f, CssLineBox.Top(30f, 17.28f));
        // a line shorter than the content area: negative leading floors away from zero (-0.5 -> -1)
        Assert.Equal(-1f, CssLineBox.Top(22f, 17.28f));
    }
}
