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
}
