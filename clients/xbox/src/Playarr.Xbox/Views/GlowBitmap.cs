using System;
using System.Collections.Generic;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.UI.Xaml.Media.Imaging;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// A card's focus glow and shadow as one pre-composited bitmap. Stacked translucent borders are blended by the
    /// compositor and come out one level apart between runs; here the layers are blended once on the CPU (source over, in
    /// layer order), so the screen only ever draws one image. The geometry is computed once, at focus time.
    /// </summary>
    internal static class GlowBitmap
    {
        /// <summary>One layer: a filled or ring-stroked rounded rectangle, in art-relative layout units.</summary>
        internal readonly struct Layer
        {
            public Layer(double left, double top, double width, double height, double radius, double stroke, byte alpha, byte red, byte green, byte blue)
            {
                Left = left;
                Top = top;
                Width = width;
                Height = height;
                Radius = radius;
                Stroke = stroke;
                Alpha = alpha;
                Red = red;
                Green = green;
                Blue = blue;
            }

            public double Left { get; }
            public double Top { get; }
            public double Width { get; }
            public double Height { get; }
            public double Radius { get; }
            /// <summary>Stroke thickness inside the box, or 0 for a filled box.</summary>
            public double Stroke { get; }
            public byte Alpha { get; }
            public byte Red { get; }
            public byte Green { get; }
            public byte Blue { get; }
        }

        private static readonly Dictionary<string, WriteableBitmap> Cache = new Dictionary<string, WriteableBitmap>();

        /// <summary>Renders <paramref name="layers"/> into a bitmap whose pixel (pad, pad) is the art's top-left corner.</summary>
        internal static WriteableBitmap Render(string key, IReadOnlyList<Layer> layers, int width, int height, int pad)
        {
            if (Cache.TryGetValue(key, out var cached))
            {
                return cached;
            }

            var bitmap = new WriteableBitmap(width, height);
            var accR = new float[width * height];
            var accG = new float[width * height];
            var accB = new float[width * height];
            var accA = new float[width * height];
            foreach (var layer in layers)
            {
                var x0 = Math.Max(0, (int)Math.Floor(layer.Left + pad) - 1);
                var y0 = Math.Max(0, (int)Math.Floor(layer.Top + pad) - 1);
                var x1 = Math.Min(width, (int)Math.Ceiling(layer.Left + layer.Width + pad) + 1);
                var y1 = Math.Min(height, (int)Math.Ceiling(layer.Top + layer.Height + pad) + 1);
                var a = layer.Alpha / 255f;
                var r = layer.Red / 255f * a;
                var g = layer.Green / 255f * a;
                var b = layer.Blue / 255f * a;
                var innerRadius = Math.Max(0, layer.Radius - layer.Stroke);
                for (var y = y0; y < y1; y++)
                {
                    for (var x = x0; x < x1; x++)
                    {
                        var px = x + 0.5 - pad;
                        var py = y + 0.5 - pad;
                        var cover = Coverage(px, py, layer.Left, layer.Top, layer.Width, layer.Height, layer.Radius);
                        if (layer.Stroke > 0)
                        {
                            cover -= Coverage(px, py, layer.Left + layer.Stroke, layer.Top + layer.Stroke, layer.Width - 2 * layer.Stroke, layer.Height - 2 * layer.Stroke, innerRadius);
                        }

                        if (cover <= 0)
                        {
                            continue;
                        }

                        var c = (float)cover;
                        var i = y * width + x;
                        var keep = 1 - a * c;
                        accR[i] = r * c + accR[i] * keep;
                        accG[i] = g * c + accG[i] * keep;
                        accB[i] = b * c + accB[i] * keep;
                        accA[i] = a * c + accA[i] * keep;
                    }
                }
            }

            var bytes = new byte[width * height * 4];
            for (var i = 0; i < width * height; i++)
            {
                bytes[i * 4] = Quantise(accB[i]);
                bytes[i * 4 + 1] = Quantise(accG[i]);
                bytes[i * 4 + 2] = Quantise(accR[i]);
                bytes[i * 4 + 3] = Quantise(accA[i]);
            }

            bytes.CopyTo(0, bitmap.PixelBuffer, 0u, bytes.Length);
            bitmap.Invalidate();
            Cache[key] = bitmap;
            return bitmap;
        }

        /// <summary>
        /// A rectangle painted with the bitmap at 1:1. A rectangle (not an Image) so the layout export, which reads an Image
        /// as a picture, treats the glow as the paint it is.
        /// </summary>
        internal static Windows.UI.Xaml.Shapes.Rectangle Plate(WriteableBitmap bitmap) => new Windows.UI.Xaml.Shapes.Rectangle
        {
            Width = bitmap.PixelWidth,
            Height = bitmap.PixelHeight,
            Fill = new Windows.UI.Xaml.Media.ImageBrush { ImageSource = bitmap, Stretch = Windows.UI.Xaml.Media.Stretch.Fill },
            IsHitTestVisible = false,
        };

        private static byte Quantise(float v) => (byte)Math.Max(0, Math.Min(255, (int)Math.Floor(v * 255f + 0.5f)));

        /// <summary>Anti-aliased coverage of the pixel centre by a rounded rectangle (signed distance, one pixel wide edge).</summary>
        private static double Coverage(double px, double py, double left, double top, double width, double height, double radius)
        {
            if (width <= 0 || height <= 0)
            {
                return 0;
            }

            var hx = width / 2;
            var hy = height / 2;
            var r = Math.Min(radius, Math.Min(hx, hy));
            var qx = Math.Abs(px - (left + hx)) - (hx - r);
            var qy = Math.Abs(py - (top + hy)) - (hy - r);
            var ox = Math.Max(qx, 0);
            var oy = Math.Max(qy, 0);
            var sd = Math.Sqrt(ox * ox + oy * oy) + Math.Min(Math.Max(qx, qy), 0) - r;
            return Math.Max(0, Math.Min(1, 0.5 - sd));
        }
    }
}
