namespace Playarr.Tizen.Logic;

/// <summary>
/// A CSS <c>box-shadow</c> as the browser paints it: the rounded box shifted by the offset, blurred with a Gaussian of sigma blur/2, and clipped out
/// of the border box itself (a shadow never shows through the box). NUI's own BoxShadow paints under the whole box, so a translucent fill would let
/// it through; this renders the ring around the box as a PNG instead.
/// </summary>
public static class BoxShadowPng
{
    /// <summary>Pixels of margin around the box the image covers: three sigma of the blur plus the offset.</summary>
    public static int Margin(float blur, float dx, float dy) => (int)Math.Ceiling(blur / 2f * 3f + Math.Max(Math.Abs(dx), Math.Abs(dy))) + 1;

    /// <summary>
    /// Renders the shadow ring of a rounded box of <paramref name="w"/> x <paramref name="h"/> whose top-left is at (margin + fx, margin + fy) in the image
    /// (fx, fy are the fractional parts of the box origin, so a box on a 1/64 px position keeps its sub-pixel edges). The image is
    /// (ceil(w + fx) + 2 margin) x (ceil(h + fy) + 2 margin).
    /// </summary>
    public static (byte[] Png, int Width, int Height) Make(float w, float h, float radius, float blur, float dx, float dy, Rgba color, float fx = 0, float fy = 0)
    {
        var m = Margin(blur, dx, dy);
        var iw = (int)Math.Ceiling(w + fx) + 2 * m; var ih = (int)Math.Ceiling(h + fy) + 2 * m;
        var r = Math.Min(radius, Math.Min(w, h) / 2f);
        var box = Coverage(iw, ih, m + fx, m + fy, w, h, r);
        var src = Coverage(iw, ih, m + fx + dx, m + fy + dy, w, h, r);
        var sigma = blur / 2f;
        var half = (int)Math.Ceiling(sigma * 3); var k = new float[2 * half + 1]; var sum = 0f;
        for (var i = -half; i <= half; i++) { k[i + half] = (float)Math.Exp(-(i * i) / (2.0 * sigma * sigma)); sum += k[i + half]; }
        for (var i = 0; i < k.Length; i++) k[i] /= sum;
        var tmp = new float[iw * ih]; var blurred = new float[iw * ih];
        for (var y = 0; y < ih; y++)
            for (var x = 0; x < iw; x++)
            {
                float a = 0;
                for (var i = -half; i <= half; i++) { var xx = x + i; if (xx >= 0 && xx < iw) a += src[y * iw + xx] * k[i + half]; }
                tmp[y * iw + x] = a;
            }
        for (var y = 0; y < ih; y++)
            for (var x = 0; x < iw; x++)
            {
                float a = 0;
                for (var i = -half; i <= half; i++) { var yy = y + i; if (yy >= 0 && yy < ih) a += tmp[yy * iw + x] * k[i + half]; }
                blurred[y * iw + x] = a;
            }
        var raw = new byte[(iw * 4 + 1) * ih];
        for (var y = 0; y < ih; y++)
            for (var x = 0; x < iw; x++)
            {
                var a = blurred[y * iw + x] * (1 - box[y * iw + x]) * color.A;
                var o = y * (iw * 4 + 1) + 1 + x * 4;
                raw[o] = (byte)Math.Round(color.R * 255); raw[o + 1] = (byte)Math.Round(color.G * 255); raw[o + 2] = (byte)Math.Round(color.B * 255);
                raw[o + 3] = (byte)Math.Round(Math.Clamp(a, 0, 1) * 255);
            }
        return (GradientPng.Encode(iw, ih, raw), iw, ih);
    }

    /// <summary>Anti-aliased coverage (4x4 samples per pixel) of a rounded rectangle.</summary>
    private static float[] Coverage(int iw, int ih, float x0, float y0, float w, float h, float r)
    {
        var c = new float[iw * ih];
        var x1 = x0 + w; var y1 = y0 + h;
        var xs = Math.Max(0, (int)Math.Floor(x0)); var xe = Math.Min(iw - 1, (int)Math.Ceiling(x1));
        var ys = Math.Max(0, (int)Math.Floor(y0)); var ye = Math.Min(ih - 1, (int)Math.Ceiling(y1));
        for (var y = ys; y <= ye; y++)
            for (var x = xs; x <= xe; x++)
            {
                var n = 0;
                for (var sy = 0; sy < 4; sy++)
                    for (var sx = 0; sx < 4; sx++)
                        if (Inside(x + (sx + 0.5f) / 4f, y + (sy + 0.5f) / 4f, x0, y0, x1, y1, r)) n++;
                c[y * iw + x] = n / 16f;
            }
        return c;
    }

    private static bool Inside(float px, float py, float x0, float y0, float x1, float y1, float r)
    {
        if (px < x0 || px > x1 || py < y0 || py > y1) return false;
        var cx = px < x0 + r ? x0 + r : px > x1 - r ? x1 - r : px;
        var cy = py < y0 + r ? y0 + r : py > y1 - r ? y1 - r : py;
        var ddx = px - cx; var ddy = py - cy;
        return ddx * ddx + ddy * ddy <= r * r;
    }
}
