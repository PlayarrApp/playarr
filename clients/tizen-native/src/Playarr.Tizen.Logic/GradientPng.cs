using System.IO.Compression;
using System.Text;

namespace Playarr.Tizen.Logic;

/// <summary>
/// Renders a one-dimensional linear gradient as a small RGBA PNG (stretch it over any box). Stops are straight-alpha
/// colours at offsets 0..1 and interpolate like CSS in premultiplied space, so fading a colour to transparent does not
/// pass through grey.
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

    private static byte[] Encode(int w, int h, byte[] raw)
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
