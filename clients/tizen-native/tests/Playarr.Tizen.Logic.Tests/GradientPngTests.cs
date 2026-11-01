using System.IO.Compression;
using Playarr.Tizen.Logic;
using Xunit;

public class GradientPngTests
{
    private static readonly Rgba Surface = new(0.1f, 0.2f, 0.3f);

    [Fact]
    public void FadingToTransparentKeepsTheColourAndInterpolatesAlpha()
    {
        var stops = new[] { (0f, Surface), (1f, new Rgba(0.1f, 0.2f, 0.3f, 0f)) };
        var mid = GradientPng.Sample(stops, 0.5f);
        Assert.Equal(0.5f, mid.A, 3);
        Assert.Equal(0.2f, mid.G, 3);
    }

    [Fact]
    public void FullyTransparentStopTakesTheColourOfTheOtherEnd()
    {
        var stops = new[] { (0f, new Rgba(0, 0, 0, 0)), (1f, Surface) };
        var c = GradientPng.Sample(stops, 0.5f);
        Assert.Equal(0.3f, c.B, 3);
    }

    [Fact]
    public void PngIsWellFormedAndDecodesToTheExpectedPixels()
    {
        var png = GradientPng.Make(true, new[] { (0f, new Rgba(1, 0, 0)), (1f, new Rgba(0, 0, 1)) }, 16);
        Assert.Equal(new byte[] { 0x89, 0x50, 0x4E, 0x47 }, png[..4]);
        // IHDR width 16, height 1
        Assert.Equal(16, (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]);
        Assert.Equal(1, png[23]);
        // find IDAT and inflate
        var idat = Array.IndexOf(png, (byte)'I', 33);
        var len = (png[idat - 4] << 24) | (png[idat - 3] << 16) | (png[idat - 2] << 8) | png[idat - 1];
        using var z = new DeflateStream(new MemoryStream(png, idat + 4 + 2, len - 2), CompressionMode.Decompress);
        var raw = new byte[1 + 16 * 4]; var n = 0; while (n < raw.Length) { var r = z.Read(raw, n, raw.Length - n); if (r == 0) break; n += r; }
        Assert.Equal(raw.Length, n);
        Assert.Equal(255, raw[1]);       // first pixel red
        Assert.Equal(255, raw[1 + 15 * 4 + 2]); // last pixel blue
    }

    [Fact]
    public void Diagonal135GradientRunsFromTopLeftToBottomRight()
    {
        const int width = 3, height = 3;
        var png = GradientPng.MakeDiagonal(
            new[] { (0f, new Rgba(1, 0, 0)), (1f, new Rgba(0, 0, 1)) }, width, height, 135);
        Assert.Equal(width, (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19]);
        Assert.Equal(height, (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23]);
        var idat = Array.IndexOf(png, (byte)'I', 33);
        var length = (png[idat - 4] << 24) | (png[idat - 3] << 16) | (png[idat - 2] << 8) | png[idat - 1];
        using var z = new DeflateStream(new MemoryStream(png, idat + 4 + 2, length - 2), CompressionMode.Decompress);
        var raw = new byte[(width * 4 + 1) * height];
        var read = 0;
        while (read < raw.Length)
        {
            var count = z.Read(raw, read, raw.Length - read);
            if (count == 0) break;
            read += count;
        }

        Assert.Equal(raw.Length, read);
        Assert.Equal(255, raw[1]);
        var middle = height / 2 * (width * 4 + 1) + 1 + width / 2 * 4;
        Assert.InRange(raw[middle], 120, 135);
        var last = (height - 1) * (width * 4 + 1) + 1 + (width - 1) * 4;
        Assert.Equal(255, raw[last + 2]);
    }

    [Fact]
    public void RadialGradientStartsAtItsColourAndFadesToTransparentAtTheConfiguredRadius()
    {
        const int width = 101, height = 101;
        var png = GradientPng.MakeRadial(width, height, new Rgba(1, 0.5f, 0.25f, 0.34f), 0.5f, 0.5f, 0.42f);
        var idat = Array.IndexOf(png, (byte)'I', 33);
        var length = (png[idat - 4] << 24) | (png[idat - 3] << 16) | (png[idat - 2] << 8) | png[idat - 1];
        using var z = new DeflateStream(new MemoryStream(png, idat + 4 + 2, length - 2), CompressionMode.Decompress);
        var raw = new byte[(width * 4 + 1) * height];
        var read = 0;
        while (read < raw.Length)
        {
            var count = z.Read(raw, read, raw.Length - read);
            if (count == 0) break;
            read += count;
        }

        Assert.Equal(raw.Length, read);
        var center = 50 * (width * 4 + 1) + 1 + 50 * 4;
        Assert.Equal(255, raw[center]);
        Assert.Equal(128, raw[center + 1]);
        Assert.Equal(64, raw[center + 2]);
        Assert.Equal(87, raw[center + 3]);
        var outsideRadius = 50 * (width * 4 + 1) + 1 + 92 * 4;
        Assert.Equal(0, raw[outsideRadius + 3]);
    }

    private static byte[] Inflate(byte[] png, int size)
    {
        var idat = Array.IndexOf(png, (byte)'I', 33);
        var len = (png[idat - 4] << 24) | (png[idat - 3] << 16) | (png[idat - 2] << 8) | png[idat - 1];
        using var z = new DeflateStream(new MemoryStream(png, idat + 4 + 2, len - 2), CompressionMode.Decompress);
        var raw = new byte[size]; var n = 0; while (n < raw.Length) { var r = z.Read(raw, n, raw.Length - n); if (r == 0) break; n += r; }
        return raw;
    }

    [Fact]
    public void DitheredPanelIsOpaqueAndExactAtItsEnds()
    {
        // alpha 0 is exactly the page colour, alpha 1 exactly the frost colour (40.04 rounds down at every dither level but 1/8)
        var png = GradientPng.MakeDitheredPanel(new[] { (0f, 0f), (1f, 1f) }, (0.15702f, 0.136157f, 0.155294f), (27, 24, 27), 1000, 1000, 1000, 2, 1920);
        var w = 920; var raw = Inflate(png, (w * 4 + 1) * 2);
        Assert.Equal(27, raw[1]); Assert.Equal(24, raw[2]); Assert.Equal(27, raw[3]); Assert.Equal(255, raw[4]);
        var last = 1 + (w - 1) * 4;
        Assert.InRange(raw[last], 39, 41); Assert.Equal(255, raw[last + 3]);
    }

    [Fact]
    public void DitheredPanelVariesOnlyByOneLevelBetweenNeighbours()
    {
        var png = GradientPng.MakeDitheredPanel(new[] { (0f, 0f), (1f, 1f) }, (0.15702f, 0.136157f, 0.155294f), (27, 24, 27), 0, 1920, 1000, 2, 1920);
        var w = 920; var raw = Inflate(png, (w * 4 + 1) * 2);
        for (var i = 1; i < w; i++) Assert.InRange(Math.Abs(raw[1 + i * 4] - raw[1 + (i - 1) * 4]), 0, 1);
    }
}
