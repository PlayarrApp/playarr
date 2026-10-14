using System;

namespace Playarr.Xbox.Views
{
    /// <summary>
    /// Applies the web backdrop filter order (grayscale, contrast, brightness) to straight-alpha BGRA pixels,
    /// then converts the result to premultiplied-alpha BGRA for a WriteableBitmap pixel buffer.
    /// </summary>
    public static class BackdropPixelFilter
    {
        public static void Apply(byte[] pixels, double contrast, double brightness)
        {
            if (pixels == null)
            {
                throw new ArgumentNullException(nameof(pixels));
            }

            if (pixels.Length % 4 != 0)
            {
                throw new ArgumentException("BGRA pixel data must contain complete four-byte pixels.", nameof(pixels));
            }

            for (var offset = 0; offset < pixels.Length; offset += 4)
            {
                var alpha = pixels[offset + 3];
                if (alpha == 0)
                {
                    pixels[offset] = 0;
                    pixels[offset + 1] = 0;
                    pixels[offset + 2] = 0;
                    continue;
                }

                var blue = pixels[offset] / 255.0;
                var green = pixels[offset + 1] / 255.0;
                var red = pixels[offset + 2] / 255.0;
                var grey = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
                var contrasted = Clamp((grey - 0.5) * contrast + 0.5);
                var filtered = ToByte(Clamp(contrasted * brightness) * 255.0);
                var premultiplied = (byte)((filtered * alpha + 127) / 255);
                pixels[offset] = premultiplied;
                pixels[offset + 1] = premultiplied;
                pixels[offset + 2] = premultiplied;
            }
        }

        private static double Clamp(double value) => Math.Max(0, Math.Min(1, value));

        private static byte ToByte(double value) => (byte)Math.Round(value, MidpointRounding.AwayFromZero);
    }
}
