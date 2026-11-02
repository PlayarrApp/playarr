using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public class RailFrostTests
{
    private static byte[] Asset(string theme, int width) => File.ReadAllBytes(Path.Combine(AppContext.BaseDirectory, "gradients", $"rail-frost-{theme}-{width}.png"));

    [Theory]
    [InlineData("dark", 1190)]
    [InlineData("dark", 1248)]
    [InlineData("light", 1190)]
    [InlineData("light", 1248)]
    public void DecodesTheWebAssetsOnePixelPerCssPixel(string theme, int width)
    {
        var (w, rgba) = RailFrost.Decode(Asset(theme, width));
        Assert.Equal(width, w);
        Assert.Equal(width * 4, rgba.Length);
        // the strip fades in from almost nothing at the panel's left edge to the solid frost colour at the right edge
        Assert.True(rgba[3] <= 2);
        Assert.True(rgba[^1] >= 254);
        for (var i = 1; i < w; i++) Assert.True(rgba[i * 4 + 3] >= rgba[(i - 1) * 4 + 3]);
    }

    [Fact]
    public void PanelOriginsMatchTheWebRailAndDirectoryPanel()
    {
        Assert.Equal(730, RailFrost.Origin(1190));
        Assert.Equal(672, RailFrost.Origin(1248));
    }

    [Fact]
    public void OpaqueCompositesPremultipliedWithHalvesRoundedUp()
    {
        var (_, rgba) = RailFrost.Decode(Asset("dark", 1190));
        var under = (27, 24, 27);
        var (w, px) = RailFrost.Decode(RailFrost.Opaque(rgba, 300, 400, under));
        Assert.Equal(100, w);
        for (var i = 0; i < w; i++)
        {
            var o = (300 + i) * 4; int a = rgba[o + 3];
            Assert.Equal((int)Math.Floor(rgba[o] * a / 255.0 + 0.5) + (int)Math.Floor(under.Item1 * (255 - a) / 255.0 + 0.5), px[i * 4]);
            Assert.Equal((int)Math.Floor(rgba[o + 1] * a / 255.0 + 0.5) + (int)Math.Floor(under.Item2 * (255 - a) / 255.0 + 0.5), px[i * 4 + 1]);
            Assert.Equal(255, px[i * 4 + 3]);
        }
    }

    [Fact]
    public void OpaqueIsExactlyTheFrostWhereTheStripIsSolid()
    {
        var (w, rgba) = RailFrost.Decode(Asset("light", 1248));
        var (_, px) = RailFrost.Decode(RailFrost.Opaque(rgba, w - 1, w, (251, 250, 249)));
        Assert.Equal(new byte[] { rgba[(w - 1) * 4], rgba[(w - 1) * 4 + 1], rgba[(w - 1) * 4 + 2], 255 }, px);
    }

    [Fact]
    public void TranslucentKeepsTheAssetPixelsUnchanged()
    {
        var (_, rgba) = RailFrost.Decode(Asset("dark", 1248));
        var (w, px) = RailFrost.Decode(RailFrost.Translucent(rgba, 10, 361));
        Assert.Equal(351, w);
        Assert.Equal(rgba.AsSpan(40, 351 * 4).ToArray(), px);
    }

    [Fact]
    public void ColourAtTheSolidEdgeIsTheFrostColour()
    {
        var (w, rgba) = RailFrost.Decode(Asset("dark", 1190));
        var c = RailFrost.ColourAt(rgba, w - 1, (27, 24, 27));
        Assert.Equal(rgba[(w - 1) * 4] / 255f, c.R, 3);
        Assert.Equal(1f, c.A);
    }
}
