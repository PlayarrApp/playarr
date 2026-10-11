using Playarr.Tizen.Logic;
using Xunit;

public class FocusAndKeyTests
{
    // Rail A (y=0): three cards. Rail B (y=300): cards at x=1000 and x=1400, as if scrolled far right.
    private static readonly Box[] Layout =
    {
        new(0, 0, 300, 200), new(350, 0, 300, 200), new(700, 0, 300, 200),
        new(1000, 300, 300, 200), new(1400, 300, 300, 200),
    };

    [Fact]
    public void DownLandsOnTheCardVisuallyBeneathNotTheSameIndex()
    {
        Assert.Equal(3, GeometricFocus.Next(Layout, 2, RemoteKey.Down)); // centre 850 is closest to 1150, not index 2
    }

    [Fact]
    public void UpPicksNearestCentreInTheRowAbove()
    {
        Assert.Equal(2, GeometricFocus.Next(Layout, 3, RemoteKey.Up));
        Assert.Equal(2, GeometricFocus.Next(Layout, 4, RemoteKey.Up));
    }

    [Fact]
    public void LeftAndRightStayInTheRowAndStopAtTheEnds()
    {
        Assert.Equal(1, GeometricFocus.Next(Layout, 0, RemoteKey.Right));
        Assert.Equal(-1, GeometricFocus.Next(Layout, 2, RemoteKey.Right));
        Assert.Equal(-1, GeometricFocus.Next(Layout, 0, RemoteKey.Left));
        Assert.Equal(-1, GeometricFocus.Next(Layout, 4, RemoteKey.Down));
    }

    [Fact]
    public void NoFocusYetStartsAtTheFirstItem() => Assert.Equal(0, GeometricFocus.Next(Layout, -1, RemoteKey.Down));

    [Theory]
    [InlineData("Return", RemoteKey.Select)]
    [InlineData("XF86Back", RemoteKey.Back)]
    [InlineData("Escape", RemoteKey.Back)]
    [InlineData("XF86AudioPlay", RemoteKey.Play)]
    [InlineData("F13", RemoteKey.None)]
    [InlineData(null, RemoteKey.None)]
    public void KeysMap(string? name, RemoteKey expected) => Assert.Equal(expected, RemoteKeys.FromName(name));
}
