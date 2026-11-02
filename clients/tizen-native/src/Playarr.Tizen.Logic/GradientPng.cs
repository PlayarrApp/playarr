using System.IO.Compression;
using System.Text;

namespace Playarr.Tizen.Logic;

/// <summary>
/// Renders CSS-like linear and radial gradients as small RGBA PNGs. Linear stops use straight-alpha colours and
/// premultiplied interpolation, so fading a colour to transparent does not pass through grey.
/// </summary>
public static class GradientPng
{
    public static byte[] Make(bool horizontal, IReadOnlyList<(float At, Rgba Color)> stops, int length = 256)
    {
        var w = horizontal ? length : 1;
        var h = horizontal ? 1 : length;
        var raw = new byte[(w * 4 + 1) * h];
        for (var i = 0; i < length; i++)
        {
            var c = Sample(stops, i / (float)(length - 1));
            var o = horizontal ? 1 + i * 4 : i * (w * 4 + 1) + 1;
            raw[o] = (byte)Math.Round(c.R * 255); raw[o + 1] = (byte)Math.Round(c.G * 255);
            raw[o + 2] = (byte)Math.Round(c.B * 255); raw[o + 3] = (byte)Math.Round(c.A * 255);
        }
        return Encode(w, h, raw);
    }

    /// <summary>Renders an angled CSS-style gradient into a target-sized PNG so its angle survives image scaling.</summary>
    public static byte[] MakeDiagonal(IReadOnlyList<(float At, Rgba Color)> stops, int width, int height, float degrees)
    {
        if (width < 1) throw new ArgumentOutOfRangeException(nameof(width));
        if (height < 1) throw new ArgumentOutOfRangeException(nameof(height));
        if (!float.IsFinite(degrees)) throw new ArgumentOutOfRangeException(nameof(degrees));

        var radians = degrees * Math.PI / 180.0;
        var dx = Math.Sin(radians);
        var dy = -Math.Cos(radians);
        var projections = new[] { 0.0, (width - 1) * dx, (height - 1) * dy, (width - 1) * dx + (height - 1) * dy };
        var min = projections.Min();
        var range = projections.Max() - min;
        var raw = new byte[(width * 4 + 1) * height];
        for (var y = 0; y < height; y++)
        {
            var row = y * (width * 4 + 1);
            for (var x = 0; x < width; x++)
            {
                var projection = x * dx + y * dy;
                var t = range <= 0 ? 0f : (float)((projection - min) / range);
                var c = Sample(stops, t);
                var offset = row + 1 + x * 4;
                raw[offset] = (byte)Math.Round(c.R * 255);
                raw[offset + 1] = (byte)Math.Round(c.G * 255);
                raw[offset + 2] = (byte)Math.Round(c.B * 255);
                raw[offset + 3] = (byte)Math.Round(c.A * 255);
            }
        }
        return Encode(width, height, raw);
    }

    /// <summary>Renders a CSS-style radial fade to transparent, sized relative to the farthest corner.</summary>
    public static byte[] MakeRadial(int width, int height, Rgba color, float centerX, float centerY, float radiusFraction)
    {
        if (width < 1) throw new ArgumentOutOfRangeException(nameof(width));
        if (height < 1) throw new ArgumentOutOfRangeException(nameof(height));
        if (!float.IsFinite(centerX) || centerX < 0 || centerX > 1) throw new ArgumentOutOfRangeException(nameof(centerX));
        if (!float.IsFinite(centerY) || centerY < 0 || centerY > 1) throw new ArgumentOutOfRangeException(nameof(centerY));
        if (!float.IsFinite(radiusFraction) || radiusFraction <= 0) throw new ArgumentOutOfRangeException(nameof(radiusFraction));

        var cx = centerX * (width - 1);
        var cy = centerY * (height - 1);
        var farthestCorner = new[]
        {
            Math.Sqrt(cx * cx + cy * cy),
            Math.Sqrt((width - 1 - cx) * (width - 1 - cx) + cy * cy),
            Math.Sqrt(cx * cx + (height - 1 - cy) * (height - 1 - cy)),
            Math.Sqrt((width - 1 - cx) * (width - 1 - cx) + (height - 1 - cy) * (height - 1 - cy)),
        }.Max();
        var radius = Math.Max(1, farthestCorner * radiusFraction);
        var raw = new byte[(width * 4 + 1) * height];
        for (var y = 0; y < height; y++)
        {
            var row = y * (width * 4 + 1);
            for (var x = 0; x < width; x++)
            {
                var distance = Math.Sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / radius;
                var alpha = (byte)Math.Round(color.A * Math.Clamp(1 - distance, 0, 1) * 255);
                var offset = row + 1 + x * 4;
                raw[offset] = (byte)Math.Round(color.R * 255);
                raw[offset + 1] = (byte)Math.Round(color.G * 255);
                raw[offset + 2] = (byte)Math.Round(color.B * 255);
                raw[offset + 3] = alpha;
            }
        }
        return Encode(width, height, raw);
    }

    /// <summary>
    /// A horizontal CSS linear gradient (premultiplied stops, straight colour <paramref name="frost"/> at the given alphas) pre-composited over the opaque page
    /// colour <paramref name="page"/>: the gradient value at each pixel centre, (x + 0.5 - origin) / width, is composited in floating point and rounded to
    /// 8 bits with Skia's 8 x 8 ordered dither (SkRasterPipeline dither stage: with Y = y ^ x, M = (Y&amp;1)&lt;&lt;5 | (x&amp;1)&lt;&lt;4 | (Y&amp;2)&lt;&lt;2 | (x&amp;2)&lt;&lt;1 |
    /// (Y&amp;4)&gt;&gt;1 | (x&amp;4)&gt;&gt;2, offset M/64 - 63/128). The matrix is indexed by coordinates local to the gradient's layer, whose left edge is floor(origin); the
    /// dither is added before rounding, exactly as Skia does, with no phase or sign fitted to pixels (a flat-page Chromium 151 capture agrees on 92.8 % of the
    /// channel bytes; the earlier fitted 2 x 2 table reached 93.9 %). The result is fully opaque, so it is only valid where nothing but
    /// the flat page lies underneath. Columns run from <paramref name="firstColumn"/> to the right edge of a 1920 px wide design.
    /// </summary>
    public static byte[] MakeDitheredPanel(IReadOnlyList<(float At, float Alpha)> stops, (float R, float G, float B) frost, (int R, int G, int B) page, float origin, float width, int firstColumn, int height, int designWidth = 1920)
    {
        var w = designWidth - firstColumn;
        var raw = new byte[(w * 4 + 1) * height];
        var alphas = new double[w];
        var layerX = (int)Math.Floor(origin);
        for (var i = 0; i < w; i++)
        {
            var t = (firstColumn + i + 0.5 - origin) / width;
            alphas[i] = AlphaAt(stops, t);
        }
        for (var y = 0; y < height; y++)
        {
            var row = y * (w * 4 + 1);
            for (var i = 0; i < w; i++)
            {
                var a = alphas[i]; var x = firstColumn + i - layerX;
                var o = row + 1 + i * 4;
                var d = SkiaDither(x & 7, y & 7);
                raw[o] = Dither(frost.R, page.R, a, d); raw[o + 1] = Dither(frost.G, page.G, a, d); raw[o + 2] = Dither(frost.B, page.B, a, d); raw[o + 3] = 255;
            }
        }
        return Encode(w, height, raw);
    }

    /// <summary>Skia's ordered-dither offset for layer-local pixel (x, y), both reduced to 0..7: M / 64 - 63 / 128.</summary>
    private static double SkiaDither(int x, int y)
    {
        var yy = y ^ x;
        var m = ((yy & 1) << 5) | ((x & 1) << 4) | ((yy & 2) << 2) | ((x & 2) << 1) | ((yy & 4) >> 1) | ((x & 4) >> 2);
        return m / 64.0 - 63.0 / 128.0;
    }

    private static byte Dither(double frost, int page, double a, double dither)
    {
        var v = (frost * a + page / 255.0 * (1 - a)) * 255.0;
        return (byte)Math.Clamp(Math.Floor(v + 0.5 + dither), 0, 255);
    }

    private static double AlphaAt(IReadOnlyList<(float At, float Alpha)> stops, double t)
    {
        if (t <= stops[0].At) return stops[0].Alpha;
        for (var i = 1; i < stops.Count; i++)
            if (t <= stops[i].At) return stops[i - 1].Alpha + (stops[i].Alpha - stops[i - 1].Alpha) * (t - stops[i - 1].At) / (stops[i].At - stops[i - 1].At);
        return stops[^1].Alpha;
    }

    internal static byte[] Encode(int w, int h, byte[] raw)
    {
        using var png = new MemoryStream();
        png.Write(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A });
        var ihdr = new byte[13];
        BigEndian(ihdr, 0, (uint)w); BigEndian(ihdr, 4, (uint)h); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
        Chunk(png, "IHDR", ihdr);
        using var z = new MemoryStream();
        z.WriteByte(0x78); z.WriteByte(0x9C);
        using (var d = new DeflateStream(z, CompressionLevel.Optimal, leaveOpen: true)) d.Write(raw);
        var adler = Adler32(raw); var tail = new byte[4]; BigEndian(tail, 0, adler); z.Write(tail);
        Chunk(png, "IDAT", z.ToArray());
        Chunk(png, "IEND", Array.Empty<byte>());
        return png.ToArray();
    }

    /// <summary>
    /// The details panel's scrim (web .details-panel::before): a horizontal gradient transparent, scrim at 22%, scrim at 80%, transparent,
    /// multiplied by a vertical mask that is clear at the top and bottom 10%.
    /// </summary>
    public static byte[] PanelScrim(Rgba scrim, int w = 128, int h = 64)
    {
        var stops = new[] { (0f, new Rgba(scrim.R, scrim.G, scrim.B, 0)), (0.22f, scrim), (0.8f, scrim), (1f, new Rgba(scrim.R, scrim.G, scrim.B, 0)) };
        var raw = new byte[(w * 4 + 1) * h];
        for (var y = 0; y < h; y++)
        {
            var fy = y / (float)(h - 1);
            var v = fy < 0.1f ? fy / 0.1f : fy > 0.9f ? (1 - fy) / 0.1f : 1f;
            for (var x = 0; x < w; x++)
            {
                var c = Sample(stops, x / (float)(w - 1));
                var o = y * (w * 4 + 1) + 1 + x * 4;
                raw[o] = (byte)Math.Round(c.R * 255); raw[o + 1] = (byte)Math.Round(c.G * 255); raw[o + 2] = (byte)Math.Round(c.B * 255);
                raw[o + 3] = (byte)Math.Round(c.A * v * 255);
            }
        }
        return Encode(w, h, raw);
    }

    public static Rgba Sample(IReadOnlyList<(float At, Rgba Color)> stops, float t)
    {
        if (t <= stops[0].At) return stops[0].Color;
        for (var i = 1; i < stops.Count; i++)
        {
            if (t > stops[i].At) continue;
            var (a0, c0) = stops[i - 1]; var (a1, c1) = stops[i];
            var f = a1 <= a0 ? 1f : (t - a0) / (a1 - a0);
            var alpha = c0.A + (c1.A - c0.A) * f;
            if (alpha <= 0) return new Rgba(c1.R, c1.G, c1.B, 0);
            float Mix(float x0, float x1) => (x0 * c0.A * (1 - f) + x1 * c1.A * f) / alpha;
            return new Rgba(Mix(c0.R, c1.R), Mix(c0.G, c1.G), Mix(c0.B, c1.B), alpha);
        }
        return stops[^1].Color;
    }

    private static void BigEndian(byte[] b, int o, uint v) { b[o] = (byte)(v >> 24); b[o + 1] = (byte)(v >> 16); b[o + 2] = (byte)(v >> 8); b[o + 3] = (byte)v; }

    private static void Chunk(Stream s, string type, byte[] data)
    {
        var len = new byte[4]; BigEndian(len, 0, (uint)data.Length); s.Write(len);
        var body = new byte[4 + data.Length]; Encoding.ASCII.GetBytes(type).CopyTo(body, 0); data.CopyTo(body, 4); s.Write(body);
        var crc = new byte[4]; BigEndian(crc, 0, Crc32(body)); s.Write(crc);
    }

    private static uint Crc32(byte[] data)
    {
        var crc = 0xFFFFFFFFu;
        foreach (var b in data) { crc ^= b; for (var k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1; }
        return ~crc;
    }

    private static uint Adler32(byte[] data)
    {
        uint a = 1, b = 0;
        foreach (var x in data) { a = (a + x) % 65521; b = (b + a) % 65521; }
        return (b << 16) | a;
    }
}
