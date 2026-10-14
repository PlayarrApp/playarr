using Playarr.Xbox.Views;
using Xunit;

namespace Playarr.Core.Tests
{
    public class BackdropPixelFilterTests
    {
        [Fact]
        public void GrayscaleUsesLuminanceForKnownPrimaryColour()
        {
            var pixel = new byte[] { 0, 0, 255, 255 };

            BackdropPixelFilter.Apply(pixel, contrast: 1, brightness: 1);

            Assert.Equal(new byte[] { 54, 54, 54, 255 }, pixel);
        }

        [Fact]
        public void ContrastRunsBeforeBrightnessLikeTheWebFilterChain()
        {
            var pixel = new byte[] { 64, 64, 64, 255 };

            BackdropPixelFilter.Apply(pixel, contrast: 0.82, brightness: 0.6);

            Assert.Equal(new byte[] { 45, 45, 45, 255 }, pixel);
        }

        [Fact]
        public void FilterClampsValuesAtBothEnds()
        {
            var pixels = new byte[] { 0, 0, 0, 255, 255, 255, 255, 255 };

            BackdropPixelFilter.Apply(pixels, contrast: 3, brightness: 3);

            Assert.Equal(new byte[] { 0, 0, 0, 255, 255, 255, 255, 255 }, pixels);
        }

        [Fact]
        public void OutputIsPremultipliedWhileAlphaIsPreserved()
        {
            var pixels = new byte[] { 255, 0, 0, 128, 255, 255, 255, 0 };

            BackdropPixelFilter.Apply(pixels, contrast: 1, brightness: 1);

            Assert.Equal(new byte[] { 9, 9, 9, 128, 0, 0, 0, 0 }, pixels);
        }
    }
}
