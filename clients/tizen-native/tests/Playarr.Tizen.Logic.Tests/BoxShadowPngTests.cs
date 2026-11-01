using System.IO.Compression;
using Playarr.Tizen.Logic;
using Xunit;

public class BoxShadowPngTests
{
    private static byte[] Alpha(byte[] png, int w, int h)
    {
        // IDAT is a single zlib stream of rows, each a filter byte (0) then RGBA
        var at = 8; byte[]? data = null;
        while (at < png.Length)
        {
            var len = (png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3];
            var type = System.Text.Encoding.ASCII.GetString(png, at + 4, 4);
            if (type == "IDAT") data = png[(at + 8)..(at + 8 + len)];
            at += 12 + len;
        }
        using var z = new ZLibStream(new MemoryStream(data!), CompressionMode.Decompress); var raw = new MemoryStream(); z.CopyTo(raw);
        var b = raw.ToArray(); var a = new byte[w * h];
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) a[y * w + x] = b[y * (w * 4 + 1) + 1 + x * 4 + 3];
        return a;
    }

    [Fact]
    public void TheShadowNeverShowsInsideTheBoxAndFallsOffBelowIt()
    {
        var (png, w, h) = BoxShadowPng.Make(80, 200, 22, 42, 0, 14, new Rgba(0.22f, 0.15f, 0.13f, 0.1f));
        var m = BoxShadowPng.Margin(42, 0, 14);
        var a = Alpha(png, w, h);
        Assert.Equal(0, a[(m + 100) * w + m + 40]);                 // centre of the box
        var below = a[(m + 200 + 2) * w + m + 40]; var far = a[(m + 200 + 50) * w + m + 40];
        Assert.InRange(below, 10, 26);                                // at most the 10 % colour alpha (25.5 levels)
        Assert.True(far < below);
        Assert.True(a[(m + 100) * w + m - 3] > 0);                    // beside the box
        Assert.Equal(a[(m + 100) * w + m - 5], a[(m + 100) * w + m + 80 + 4]); // symmetric left and right (5 px out each side)
    }
}
