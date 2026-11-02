using System.IO.Compression;

namespace Playarr.Tizen.Logic;

/// <summary>
/// The web's rail frost (global.css .tv-rail-surface, .tv-library-grid-panel): a pre-rendered 1 px high RGBA strip, one pixel per CSS pixel, drawn at
/// the panel's left edge over whatever lies beneath. This reads the very same asset and composites it premultiplied, as the browser does, with no
/// dither (see <c>Over</c>).
/// </summary>
public static class RailFrost
{
    /// <summary>Left edge of the panel at 1920 px: the strip is 1190 px (.tv-rail-surface) or 1248 px (.tv-library-grid-panel, 65 %) wide.</summary>
    public static int Origin(int stripWidth, int designWidth = 1920) => designWidth - stripWidth;

    /// <summary>Decodes a 1 px high, 8-bit RGBA PNG into its width and straight-alpha pixels (4 bytes each).</summary>
    public static (int Width, byte[] Rgba) Decode(byte[] png)
    {
        if (png.Length < 33 || png[0] != 0x89 || png[1] != 0x50) throw new InvalidDataException("not a PNG");
        int w = 0, h = 0; var idat = new MemoryStream();
        for (var i = 8; i + 8 <= png.Length;)
        {
            var len = (png[i] << 24) | (png[i + 1] << 16) | (png[i + 2] << 8) | png[i + 3];
            var type = System.Text.Encoding.ASCII.GetString(png, i + 4, 4);
            if (type == "IHDR")
            {
                w = (png[i + 8] << 24) | (png[i + 9] << 16) | (png[i + 10] << 8) | png[i + 11];
                h = (png[i + 12] << 24) | (png[i + 13] << 16) | (png[i + 14] << 8) | png[i + 15];
                if (png[i + 16] != 8 || png[i + 17] != 6 || png[i + 20] != 0) throw new InvalidDataException("expected 8-bit RGBA, not interlaced");
            }
            else if (type == "IDAT") idat.Write(png, i + 8, len);
            i += 12 + len;
        }
        if (h != 1 || w < 1) throw new InvalidDataException("expected a 1 px high strip");
        idat.Position = 2; // zlib header
        using var z = new DeflateStream(idat, CompressionMode.Decompress);
        var raw = new byte[1 + w * 4]; var n = 0;
        while (n < raw.Length) { var r = z.Read(raw, n, raw.Length - n); if (r == 0) break; n += r; }
        if (n != raw.Length) throw new InvalidDataException("short image data");
        var px = new byte[w * 4];
        for (var i = 0; i < px.Length; i++)
        {
            int left = i >= 4 ? px[i - 4] : 0, cur = raw[1 + i];
            px[i] = (byte)(raw[0] switch
            {
                0 => cur, // None
                1 => cur + left, // Sub
                2 => cur, // Up: the row above is all zero
                3 => cur + (left >> 1), // Average with an all-zero row above
                4 => cur + left, // Paeth with a zero row above always picks the left pixel
                _ => throw new InvalidDataException("bad filter"),
            });
        }
        return (w, px);
    }

    /// <summary>
    /// Premultiplied source-over on 8-bit channels, the plain definition: the strip colour is premultiplied (round(c * a / 255)), the backdrop keeps
    /// round(baseValue * (255 - a) / 255), and the two add. No rule is chosen from reference pixels.
    /// </summary>
    private static int Over(int c, int a, int baseValue) =>
        (int)Math.Floor(c * a / 255.0 + 0.5) + (int)Math.Floor(baseValue * (255 - a) / 255.0 + 0.5);

    /// <summary>
    /// Columns [<paramref name="from"/>, <paramref name="to"/>) of the strip (strip-local) composited over the flat opaque colour
    /// <paramref name="under"/>, as a 1 px high opaque PNG.
    /// </summary>
    public static byte[] Opaque(byte[] rgba, int from, int to, (int R, int G, int B) under)
    {
        var w = to - from; var raw = new byte[1 + w * 4];
        for (var i = 0; i < w; i++)
        {
            var o = (from + i) * 4; int a = rgba[o + 3];
            raw[1 + i * 4] = (byte)Math.Clamp(Over(rgba[o], a, under.R), 0, 255);
            raw[2 + i * 4] = (byte)Math.Clamp(Over(rgba[o + 1], a, under.G), 0, 255);
            raw[3 + i * 4] = (byte)Math.Clamp(Over(rgba[o + 2], a, under.B), 0, 255);
            raw[4 + i * 4] = 255;
        }
        return GradientPng.Encode(w, 1, raw);
    }

    /// <summary>Columns [<paramref name="from"/>, <paramref name="to"/>) of the strip unchanged (straight alpha), for the band where artwork lies beneath.</summary>
    public static byte[] Translucent(byte[] rgba, int from, int to)
    {
        var w = to - from; var raw = new byte[1 + w * 4];
        Array.Copy(rgba, from * 4, raw, 1, w * 4);
        return GradientPng.Encode(w, 1, raw);
    }

    /// <summary>The panel colour at strip column <paramref name="column"/> over <paramref name="under"/>.</summary>
    public static Rgba ColourAt(byte[] rgba, int column, (int R, int G, int B) under)
    {
        var o = column * 4; int a = rgba[o + 3];
        return new Rgba(Over(rgba[o], a, under.R) / 255f, Over(rgba[o + 1], a, under.G) / 255f, Over(rgba[o + 2], a, under.B) / 255f, 1f);
    }
}
