using Playarr.Tizen.Logic;
using Xunit;

namespace Playarr.Tizen.Logic.Tests;

public class PlaybackPresentationTests
{
    [Theory]
    [InlineData(2160, "UHD")]
    [InlineData(1080, "FHD")]
    [InlineData(720, "HD")]
    [InlineData(480, "SD")]
    [InlineData(null, "HD")]
    public void Quality_badge_uses_the_reported_height(int? height, string expected)
    {
        Assert.Equal(expected, PlaybackPresentation.Quality("original", "Original", height, null).Badge);
    }

    [Theory]
    [InlineData(24_300_000, "Original · 24.3 Mbps")]
    [InlineData(49_999, "Original")]
    [InlineData(0, "Original")]
    public void Original_quality_includes_only_a_meaningful_source_bitrate(long bitrate, string expected)
    {
        Assert.Equal(expected, PlaybackPresentation.Quality("original", "Original", null, bitrate).Label);
    }

    [Fact]
    public void Rendition_label_is_preserved_without_appending_a_second_bitrate()
    {
        Assert.Equal("1080p · 8 Mbps", PlaybackPresentation.Quality("1080p", "1080p · 8 Mbps", 1080, 8_000_000).Label);
    }

    [Fact]
    public void Original_bitrate_uses_invariant_decimal_formatting()
    {
        var previous = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = System.Globalization.CultureInfo.GetCultureInfo("fr-FR");
            Assert.Equal("Original · 24.3 Mbps", PlaybackPresentation.Quality("original", null, null, 24_300_000).Label);
        }
        finally { System.Globalization.CultureInfo.CurrentCulture = previous; }
    }
}
